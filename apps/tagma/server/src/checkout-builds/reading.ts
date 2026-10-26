import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Clock, Effect, Schema, Stream } from 'effect';
import { Git } from '@runlith/git/Git';
import { troubleOf } from '@runlith/git/repository';
import { statusAt } from '@runlith/git/status';
import { changedIn, gitText, treeFingerprint, type TreeReading } from '../platform/git/readings.js';
import { SourceChanges } from './contract/service/changes.js';
import type { NextIssue } from '../installation/contract/wire/next.js';
import type { Revision } from '../installation/contract/wire/layout.js';
import type { CheckoutFrame, CheckoutRuns, CheckoutState } from './record.js';

export type RunningRevision = Revision & { readonly tree: string | null };

const INSTANCE = crypto.randomUUID();

const packageSchema = Schema.fromJsonString(Schema.Struct({ scripts: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)) }));

const carriesBuildScript = Effect.fn('CheckoutReading.buildScript')(function* (path: string) {
  const text = yield* Effect.result(
    Effect.tryPromise({ try: () => readFile(join(path, 'package.json'), 'utf8'), catch: (cause) => cause }),
  );
  if (text._tag === 'Failure') {
    if ((text.failure as NodeJS.ErrnoException).code === 'ENOENT') return false;
    return yield* Effect.fail<NextIssue>({
      code: 'source-unreadable',
      reason: String(text.failure),
      unblock: [`${path}/package.json — restore access to the build declaration`],
    });
  }
  const parsed = Schema.decodeUnknownResult(packageSchema)(text.success);
  if (parsed._tag === 'Failure')
    return yield* Effect.fail<NextIssue>({
      code: 'source-unreadable',
      reason: String(parsed.failure),
      unblock: [`${path}/package.json — repair the build declaration`],
    });
  return typeof parsed.success.scripts?.['tagma:build'] === 'string';
});

const manifestMoved = (paths: Iterable<string> | null): boolean => {
  if (paths === null) return true;
  for (const path of paths) if (path === 'package.json') return true;
  return false;
};

const runsOf = (running: RunningRevision | null, same: boolean | null, tree: TreeReading): CheckoutRuns | null => {
  if (running === null || same === null) return null;
  if (!same) return 'other-commit';
  if (!running.dirty) return tree.changed === 0 ? 'tree' : 'head';
  if (tree.changed === 0) return 'other-edits';
  if (running.tree === null || tree.fingerprint === null) return 'unmeasured-edits';
  return running.tree === tree.fingerprint ? 'tree' : 'other-edits';
};

type Distance = { readonly same: boolean | null; readonly ahead: number | null };

export const makeCheckoutReading = Effect.fnUntraced(function* (input: {
  readonly path: string | undefined;
  readonly running: RunningRevision | null;
}) {
  const { path, running } = input;
  const git = yield* Git;
  const source = yield* SourceChanges;
  let revision = 0;
  let epoch = 0;
  let history = 0;
  let manifest = 0;
  let measured = -1;
  let watching = false;
  let current: CheckoutFrame | null = null;
  let inflight: Effect.Effect<CheckoutFrame> | null = null;
  let declaration: { readonly epoch: number; readonly available: boolean } | null = null;
  let metadata: {
    readonly epoch: number;
    readonly full: string | null;
    readonly short: string | null;
    readonly subject: string | null;
  } | null = null;
  let distance: { readonly epoch: number; readonly head: string | null; readonly value: Distance } | null = null;

  const statusOf = Effect.fnUntraced(
    function* (at: string, stamp: number) {
      const status = yield* statusAt(git, at, { untracked: 'all' });
      const full = status.branch.head;
      if (metadata?.epoch !== stamp || metadata.full !== full) {
        const line = full === null ? null : yield* gitText(git, at, ['log', '-1', '--format=%h%x00%s', full]);
        const [short = '', subject = ''] = (line ?? '').replace(/\n$/, '').split('\0');
        metadata = {
          epoch: stamp,
          full,
          short: short === '' ? null : short,
          subject: subject.trim() === '' ? null : subject.trim(),
        };
      }
      let apart: Distance;
      if (distance?.epoch === stamp && distance.head === full) apart = distance.value;
      else {
        const theirs =
          running === null || full === null
            ? null
            : yield* gitText(git, at, ['rev-parse', '--verify', '--quiet', `${running.head}^{commit}`]);
        const same = running === null || full === null ? null : theirs !== null && full === theirs.trim();
        const counted =
          same === false && theirs !== null ? yield* gitText(git, at, ['rev-list', '--count', `${theirs.trim()}..${full}`]) : null;
        const ahead = same === true ? 0 : counted === null ? Number.NaN : Number(counted.trim());
        apart = { same, ahead: Number.isInteger(ahead) ? ahead : null };
        distance = { epoch: stamp, head: full, value: apart };
      }
      const changed = changedIn(status);
      const fingerprint = changed > 0 && running?.dirty === true ? yield* treeFingerprint(git, at, status) : null;
      return {
        path: at,
        head: metadata.short,
        subject: metadata.subject,
        dirty: changed > 0,
        changed,
        tree: fingerprint,
        ahead: apart.ahead,
        runs: runsOf(running, apart.same, { changed, fingerprint }),
      } satisfies CheckoutState;
    },
    (effect, at) =>
      Effect.mapError(effect, (failure): NextIssue => ({
        code: 'source-unreadable',
        reason: `${at}: ${troubleOf(failure)}`,
        unblock: [`${at} — read the checkout yourself; this server could not take its status`],
      })),
  );

  const checkout = Effect.fnUntraced(function* () {
    if (path === undefined) return null;
    const stamp = manifest;
    if (declaration?.epoch !== stamp) declaration = { epoch: stamp, available: yield* carriesBuildScript(path) };
    if (!declaration.available) return null;
    return yield* statusOf(path, history);
  });

  const measure = Effect.fn('CheckoutReading.measure')(function* () {
    const started = epoch;
    const outcome = yield* Effect.result(checkout());
    const frame: CheckoutFrame = {
      instance: INSTANCE,
      pid: process.pid,
      revision: ++revision,
      readAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
      watched: watching,
      issue: outcome._tag === 'Failure' ? outcome.failure : null,
      checkout: outcome._tag === 'Success' ? outcome.success : (current?.checkout ?? null),
    };
    current = frame;
    measured = started;
    return frame;
  });

  const read: Effect.Effect<CheckoutFrame> = Effect.gen(function* () {
    if (path === undefined && current !== null) return current;
    if (!watching && inflight === null) {
      epoch += 1;
      history += 1;
      manifest += 1;
    }
    if (measured === epoch && current !== null && current.issue === null) return current;
    if (inflight === null) {
      const joined: Effect.Effect<CheckoutFrame> = yield* Effect.cached(
        measure().pipe(
          Effect.ensuring(
            Effect.sync(() => {
              if (inflight === joined) inflight = null;
            }),
          ),
        ),
      );
      inflight = joined;
    }
    const frame = yield* inflight;
    return measured === epoch ? frame : yield* read;
  });

  const changes: Stream.Stream<CheckoutFrame, NextIssue> = Stream.unwrap(
    Effect.gen(function* () {
      if (path === undefined) return Stream.concat(Stream.fromEffect(read), Stream.never);
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          watching = false;
        }),
      );
      return source.watch(path).pipe(
        Stream.mapEffect((shift) => {
          epoch += 1;
          watching = shift.watched;
          if (shift.history) history += 1;
          if (manifestMoved(shift.paths)) manifest += 1;
          return read;
        }),
      );
    }),
  );

  return { read, changes };
});
