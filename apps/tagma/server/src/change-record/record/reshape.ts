import type { Rewrites } from './rewrites.js';
import { Clock, Effect, FileSystem } from 'effect';
import type { WorkspaceChange } from '@runlith/files/change';
import type { Landed } from '@runlith/agent-tools/WorkspaceChanges';
import { contentDigest } from '@runlith/files/content';
import { workspaceChangeHunk } from '@runlith/files/hunk';
import type { TextAt } from '@runlith/git/entries';
import { mergeFileAt } from '@runlith/git/merge';
import { workingBlobTextsAt } from '@runlith/git/working';
import { actingGit, configuredGit } from '../../platform/git/ownGit.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { checkoutAt } from '../../workspace/roots/proof.js';
import type { CheckoutPaths } from '../../workspace/contract/service/checkoutPaths.js';
import type { ChangeCheckout, ChangeRecord } from '../contract/service/record.js';
import type { RunFilesFailure } from '../contract/service/runFiles.js';
import { LineWrites } from '../contract/service/lineWrites.js';
import type {
  Reshaped,
  ReshapeHolder,
  ReshapeInput,
  ReshapeKept,
  ReshapeMode,
  ReshapeOutcome,
  ReshapeOwing,
  ReshapeRead,
} from '../contract/wire/reshape.js';
import type { Walks } from '../lines/walks.js';
import type { RetireStore } from '../retire/store.js';
import { READING_CAPTURE } from '../threadFiles/failures.js';
import { working } from '../threadFiles/sides.js';
import type { CommandWrites } from './commands.js';
import { checkedPath } from './runFiles.js';

const AT_ONCE = 3;

const EXECUTABLE = 0o100;

const merged = (path: string): ReshapeOutcome => ({ _tag: 'merged', path });

type ProvedCheckout = ChangeCheckout & { readonly checkout: string };

type Side = { readonly text: string | null } | { readonly binary: true } | { readonly unread: string };

const sideOf = (blob: string | null, text: TextAt | undefined): Side => {
  if (blob === null) return { text: null };
  if (text === undefined) return { unread: `the blob reader answered nothing for ${blob}` };
  if (text._tag === 'Failure') return { unread: text.failure.message };
  if (text.success === null) return { unread: `${blob} is not in the object store` };
  return text.success.includes('\0') ? { binary: true } : { text: text.success };
};

const readOf = (before: Side, after: Side, disk: Side): ReshapeRead => {
  for (const side of [before, after, disk]) if ('unread' in side) return { kind: 'unread', cause: side.unread };
  if ('binary' in before || 'binary' in after || 'binary' in disk) return { kind: 'binary' };
  return {
    kind: 'text',
    before: 'text' in before ? before.text : null,
    after: 'text' in after ? after.text : null,
    disk: 'text' in disk ? disk.text : null,
  };
};

export function reshapeOver(
  record: ChangeRecord['Service'],
  commands: CommandWrites,
  rewrites: Rewrites,
  places: CheckoutPaths['Service'],
  graphDirectory: string,
  walks: Walks,
  debts: RetireStore,
) {
  const land = Effect.fn('ChangeRecord.reshapeLand')(function* (
    checkout: ProvedCheckout,
    holder: ReshapeHolder,
    path: string,
    from: string | null,
    to: string | null,
    writes: LineWrites['Service'],
    mode: ReshapeMode | undefined,
    owing: ReshapeOwing | undefined,
  ): Effect.fn.Return<ReshapeOutcome, RunFilesFailure, FileSystem.FileSystem> {
    const key = checkout.checkout;
    const clock = yield* Clock.Clock;
    const publishing = (): (() => void) =>
      holder._tag === 'unheld' ? commands.unowned(key, path, contentDigest(to ?? ''), clock.currentTimeMillisUnsafe()) : () => undefined;
    const hunk = workspaceChangeHunk(from ?? '', to ?? '');
    const change: WorkspaceChange = {
      path: `${checkout.root}/${path}`,
      origin: to === null ? 'delete' : 'write',
      before: contentDigest(from ?? ''),
      after: contentDigest(to ?? ''),
      beforeText: from ?? '',
      afterText: to ?? '',
      at: new Date(yield* Clock.currentTimeMillis),
      hunk,
    };
    const write = writes.replace({ root: checkout.root, path, before: from, after: to, publishing, mode }, Effect.succeed(true));
    const outcome: Landed =
      holder._tag === 'held' && from !== to
        ? yield* record.land({ work: holder.work }, [change], write)
        : (yield* write)
          ? { _tag: 'written', kept: true }
          : { _tag: 'moved' };
    if (outcome._tag === 'moved') return { _tag: 'kept', path, why: 'moved', owed: false };
    if (to !== null) rewrites.rewrote(key, path, contentDigest(to), owing?.commit ?? null);
    return outcome._tag === 'written' && outcome.kept ? merged(path) : { _tag: 'unrecorded', path };
  });
  const merge = Effect.fn('ChangeRecord.reshapeOne')(function* (
    checkout: ProvedCheckout,
    holder: ReshapeHolder,
    one: ReshapeInput,
    writes: LineWrites['Service'],
    owing: ReshapeOwing | undefined,
  ): Effect.fn.Return<ReshapeOutcome | ReshapeKept, RunFilesFailure, FileSystem.FileSystem> {
    const { path, mode, read } = one;
    if (read.kind !== 'text') return 'unreadable';
    const { before, after, disk: text } = read;
    const files = yield* FileSystem.FileSystem;
    const info = mode === undefined || text === null ? undefined : yield* Effect.result(files.stat(`${checkout.root}/${path}`));
    if (info?._tag === 'Failure')
      yield* Effect.logWarning('a reshaped path keeps its mode: the working file could not be read', {
        path,
        reason: info.failure.message,
      });
    const modeDue = info?._tag === 'Success' && ((Number(info.success.mode) & EXECUTABLE) !== 0) !== (mode === '100755');
    const standing = (now: string): Effect.Effect<ReshapeOutcome, RunFilesFailure, FileSystem.FileSystem> =>
      modeDue ? land(checkout, holder, path, now, now, writes, mode, owing) : Effect.succeed(merged(path));
    if (before === null) {
      if (after === null) return merged(path);
      if (text === null) return yield* land(checkout, holder, path, null, after, writes, mode, owing);
      return text === after ? yield* standing(text) : 'conflict';
    }
    if (after === null) {
      if (text === null) return merged(path);
      return text === before ? yield* land(checkout, holder, path, text, null, writes, undefined, owing) : 'conflict';
    }
    if (text === null) return 'moved';
    if (text === after) return yield* standing(text);
    let next = after;
    if (text !== before) {
      const attempt = yield* Effect.result(
        mergeFileAt(
          actingGit(checkout.git, 'reshape-merge'),
          checkout.root,
          { ours: text, base: before, theirs: after },
          { capture: READING_CAPTURE },
        ),
      );
      if (attempt._tag === 'Failure') {
        yield* Effect.logWarning('a reshaped path is not merged: git could not merge its three texts', {
          path,
          reason: attempt.failure.message,
        });
        return 'unreadable';
      }
      if (attempt.success.conflicts > 0) return 'conflict';
      next = attempt.success.text;
    }
    if (next === text) return yield* standing(text);
    return yield* land(checkout, holder, path, text, next, writes, mode, owing);
  });
  const reshapeOne = Effect.fn('ChangeRecord.reshapeKept')(function* (
    checkout: ProvedCheckout,
    holder: ReshapeHolder,
    one: ReshapeInput,
    writes: LineWrites['Service'],
    owing: ReshapeOwing | undefined,
  ): Effect.fn.Return<ReshapeOutcome, RunFilesFailure, FileSystem.FileSystem> {
    const outcome = yield* merge(checkout, holder, one, writes, owing);
    if (typeof outcome !== 'string') {
      if (outcome._tag !== 'kept' || holder._tag !== 'unheld' || owing === undefined) return outcome;
    }
    const why = typeof outcome === 'string' ? outcome : outcome.why;
    if (holder._tag !== 'unheld' || owing === undefined || one.read.kind !== 'text')
      return { _tag: 'kept', path: one.path, why, owed: false };
    const windows = yield* Effect.result(walks.windows(one.read.before ?? '', one.read.after ?? ''));
    if (windows._tag === 'Failure')
      yield* Effect.logWarning('a kept reshape owes no commit step: its line windows could not be walked', {
        path: one.path,
        reason: windows.failure.message,
      });
    const owed = windows._tag === 'Success' && windows.success !== null;
    if (windows._tag === 'Success' && windows.success !== null)
      yield* debts.owe({
        checkout: checkout.checkout,
        path: one.path,
        commit: owing.commit,
        source: owing.source,
        before: one.before,
        after: one.after,
        reason: why,
        windows: windows.success,
      });
    return { _tag: 'kept', path: one.path, why, owed };
  });
  const proved = (checkout: ChangeCheckout): Effect.Effect<ProvedCheckout, RunFilesFailure> => {
    const unproven = (reason: string) =>
      new GateRefusal('root-unproven', `no write can be keyed to the selected checkout or recorded: ${reason}`, [
        'use a proved checkout of the session’s project',
      ]);
    if (checkout.origin === null) return Effect.fail(unproven('it has no proved origin'));
    return Effect.map(
      Effect.mapError(checkoutAt(places, checkout.projectId, checkout.root), (failure) => unproven(failure.reason)),
      (placed) => ({ ...checkout, checkout: placed }),
    );
  };
  const reshapeRead = Effect.fn('ChangeRecord.reshapeRead')(function* (
    checkout: ChangeCheckout,
    reshaped: readonly Reshaped[],
  ): Effect.fn.Return<readonly ReshapeInput[], RunFilesFailure, FileSystem.FileSystem> {
    const named = reshaped.filter((one) => checkedPath(checkout, graphDirectory, one.path));
    const asked = named.flatMap((one) => [one.before, one.after].flatMap((blob) => (blob === null ? [] : [{ blob, path: one.path }])));
    const texts =
      asked.length === 0
        ? []
        : yield* workingBlobTextsAt(configuredGit(checkout.git, 'reshape-blobs'), checkout.root, asked, { capture: READING_CAPTURE });
    const files = yield* FileSystem.FileSystem;
    const inputs: ReshapeInput[] = [];
    let next = 0;
    for (const one of reshaped) {
      if (!checkedPath(checkout, graphDirectory, one.path)) {
        inputs.push({ ...one, read: { kind: 'outside' } });
        continue;
      }
      const before = sideOf(one.before, one.before === null ? undefined : texts[next++]);
      const after = sideOf(one.after, one.after === null ? undefined : texts[next++]);
      const read = yield* Effect.result(working(files, checkout.root, one.path));
      const disk: Side =
        read._tag === 'Failure'
          ? { unread: read.failure.message }
          : read.success?.includes('\0') === true
            ? { binary: true }
            : { text: read.success };
      inputs.push({ ...one, read: readOf(before, after, disk) });
    }
    return inputs;
  });
  const reshape = Effect.fn('ChangeRecord.reshape')(function* (
    checkout: ChangeCheckout,
    inputs: readonly ReshapeInput[],
    holder: ReshapeHolder,
    owing?: ReshapeOwing,
  ): Effect.fn.Return<readonly ReshapeOutcome[], RunFilesFailure, FileSystem.FileSystem | LineWrites> {
    const at = yield* proved(checkout);
    const writes = yield* LineWrites;
    return yield* Effect.forEach(
      inputs,
      (one) => record.turn(checkout.projectId, [`${checkout.root}/${one.path}`], reshapeOne(at, holder, one, writes, owing)),
      { concurrency: AT_ONCE },
    );
  });
  return { reshape, reshapeRead };
}
