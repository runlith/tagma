import { Clock, Effect, FileSystem, type PlatformError } from 'effect';
import { ToolFailed } from '@runlith/agent/tool';
import type { ResolvedToolOptions } from './workspace';
import { changeOf, type ChangeTarget, type WorkspaceChange, type WriteProvenance } from '@runlith/files/change';
import { replaced, sameEntry, type Entry, type Standing, stillStanding } from '@runlith/files/replace';
import { Git } from '@runlith/git/Git';
import { troubleOf } from '@runlith/git/repository';
import { normalizedAt } from '@runlith/git/working';
import { basename, dirname, resolve } from 'node:path';
import { IntakeRefused } from './WorkspaceChanges';
import { bytesDigest } from '@runlith/files/content';
import type { Refusal } from './refusals';

const movedSince = (path: string): ToolFailed =>
  new ToolFailed({
    reason: `${path} changed after it was read, so nothing was written. Read it again and redo the change.`,
    code: 'file-changed' satisfies Refusal,
  });

const refusedBy = (cause: IntakeRefused): ToolFailed =>
  new ToolFailed({ reason: `The change record could not take the write at ${cause.path}: ${cause.reason}. Nothing was written.` });

const refused = <E>(failure: E | IntakeRefused): E | ToolFailed => (failure instanceof IntakeRefused ? refusedBy(failure) : failure);

export type Recorded = { readonly kept: boolean; readonly pending: string | null };

export function inTurn<A, E, R>(
  resolved: ResolvedToolOptions,
  path: string,
  work: Effect.Effect<A, E, R>,
  target: ChangeTarget = 'resource',
): Effect.Effect<A, E | ToolFailed, R> {
  return inTurns(resolved, [path], work, target);
}

export function inTurns<A, E, R>(
  resolved: ResolvedToolOptions,
  paths: readonly string[],
  work: Effect.Effect<A, E, R>,
  target: ChangeTarget = 'entry',
): Effect.Effect<A, E | ToolFailed, R> {
  const turn = resolved.changes?.turn;
  if (turn === undefined) return work;
  return Effect.mapError(
    turn(
      paths.map((path) => resolve(resolved.cwd, path)),
      work,
      target,
    ),
    refused,
  );
}

export function inBasis<A, E, R>(
  resolved: ResolvedToolOptions,
  paths: readonly string[],
  work: Effect.Effect<A, E, R>,
): Effect.Effect<A, E | ToolFailed, R> {
  const basis = resolved.changes?.basis;
  return basis === undefined ? work : Effect.mapError(basis(paths, work), refused);
}

export function landing<E, R>(
  resolved: ResolvedToolOptions,
  changes: readonly WorkspaceChange[],
  write: Effect.Effect<boolean, E, R>,
): Effect.Effect<Recorded, E | ToolFailed, R> {
  const named = changes[changes.length - 1]?.path ?? '';
  const sink = resolved.changes;
  if (sink === undefined) {
    return Effect.flatMap(write, (written) => (written ? Effect.succeed({ kept: true, pending: null }) : Effect.fail(movedSince(named))));
  }
  return sink.land(changes, write).pipe(
    Effect.mapError(refused),
    Effect.flatMap((landed) =>
      landed._tag === 'moved'
        ? Effect.fail(movedSince(named))
        : Effect.succeed(landed._tag === 'written' ? { kept: landed.kept, pending: null } : { kept: true, pending: landed.reason }),
    ),
  );
}

export function landingEach<E, R>(
  resolved: ResolvedToolOptions,
  changes: readonly WorkspaceChange[],
  write: Effect.Effect<readonly boolean[], E, R>,
): Effect.Effect<readonly (Recorded | null)[], E | ToolFailed, R> {
  const sink = resolved.changes;
  if (sink === undefined) return Effect.map(write, (written) => written.map((one) => (one ? { kept: true, pending: null } : null)));
  return sink.landEach(changes, write).pipe(
    Effect.mapError(refused),
    Effect.map((landed) =>
      landed.map((one) =>
        one._tag === 'moved' ? null : one._tag === 'written' ? { kept: one.kept, pending: null } : { kept: true, pending: one.reason },
      ),
    ),
  );
}

export const deletionOf = Effect.fnUntraced(function* (resolved: ResolvedToolOptions, path: string, standing: Standing, before: string) {
  const normalized = yield* normalizedOf(resolved, path, { standing, before, after: '' });
  return changeOf('delete', path, standing, before, '', normalized, new Date(yield* Clock.currentTimeMillis));
});

export type TextChange = {
  readonly standing: Standing;
  readonly before: string;
  readonly after: string;
  readonly resource?: string;
  readonly selected?: Entry;
};

export function recording(
  resolved: ResolvedToolOptions,
  origin: WriteProvenance,
  path: string,
  texts: TextChange,
): Effect.Effect<Recorded, PlatformError.PlatformError | ToolFailed, FileSystem.FileSystem> {
  return Effect.flatMap(normalizedOf(resolved, path, texts), (normalized) =>
    Effect.flatMap(Clock.currentTimeMillis, (at) =>
      landing(
        resolved,
        [changeOf(origin, path, texts.standing, texts.before, texts.after, normalized, new Date(at))],
        replaced(path, texts.standing, origin === 'delete' ? null : texts.after, { resource: texts.resource, selected: texts.selected }),
      ),
    ),
  );
}

export function recordingBytes(
  resolved: ResolvedToolOptions,
  path: string,
  before: Uint8Array | undefined,
  after: Uint8Array,
  resource?: string,
): Effect.Effect<Recorded, PlatformError.PlatformError | ToolFailed, FileSystem.FileSystem> {
  const standing: Standing = before === undefined ? { absent: true } : { bytes: before };
  return Effect.flatMap(Clock.currentTimeMillis, (at) =>
    landing(
      resolved,
      [{ origin: 'write', path, at: new Date(at), before: bytesDigest(before ?? new Uint8Array()), after: bytesDigest(after) }],
      replaced(path, standing, after, { resource }),
    ),
  );
}

export const recordingMove = Effect.fn('WorkspaceChanges.recordingMove')(function* (
  resolved: ResolvedToolOptions,
  from: string,
  to: string,
  source: { readonly bytes: Uint8Array; readonly text: string },
): Effect.fn.Return<Recorded, PlatformError.PlatformError | ToolFailed, FileSystem.FileSystem> {
  const at = new Date(yield* Clock.currentTimeMillis);
  const moved = changeOf('write', to, { absent: true }, '', source.text, false, at);
  const write = Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    if (!(yield* stillStanding(from, { bytes: source.bytes }))) return false;
    if (!(yield* stillStanding(to, { absent: true }))) {
      if (!(yield* sameEntry(from, to))) return false;
      yield* fs.rename(from, to);
      return true;
    }
    yield* fs.makeDirectory(dirname(to), { recursive: true });
    const linked = yield* Effect.result(fs.link(from, to));
    if (linked._tag === 'Failure') {
      if (linked.failure.reason._tag === 'AlreadyExists') return false;
      return yield* linked.failure;
    }
    yield* fs.remove(from);
    return true;
  });
  return yield* landing(
    resolved,
    [changeOf('delete', from, { bytes: source.bytes }, source.text, '', false, at), { ...moved, target: 'entry', movedFrom: from }],
    write,
  );
});

const normalizedOf = Effect.fnUntraced(function* (
  resolved: ResolvedToolOptions,
  path: string,
  texts: TextChange,
): Effect.fn.Return<boolean, ToolFailed> {
  const git = resolved.world.git;
  const changes = resolved.changes;
  if (changes === undefined || !(texts.before.includes('\r') || texts.after.includes('\r'))) return false;
  if (changes.normalized !== undefined) {
    const prepared = yield* changes.normalized(path).pipe(Effect.mapError(refusedBy));
    if (prepared !== undefined) return prepared;
  }
  if (git === undefined) return false;
  if (changes.records !== undefined && (yield* changes.records([path]).pipe(Effect.mapError(refusedBy)))[0] !== true) return false;
  const name = basename(path);
  return yield* Effect.flatMap(Git, (service) => normalizedAt(service, dirname(path), [name])).pipe(
    Effect.provide(git),
    Effect.map((ends) => ends.has(name)),
    Effect.mapError(
      (failure) =>
        new ToolFailed({ reason: `Line-ending normalization at ${path} could not be read: ${troubleOf(failure)}. Nothing was written.` }),
    ),
  );
});

export function recordedSentence(recorded: Recorded): string {
  if (recorded.pending !== null) {
    return ` The file is written; its change record row stands as an intent the next start confirms, because confirming it failed: ${recorded.pending}.`;
  }
  return recorded.kept ? '' : ' The change record kept no row for this path.';
}
