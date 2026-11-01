import { randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { Effect } from 'effect';
import { ThreadEntryKinds } from '@runlith/agent/transcript/kinds';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits, type WriteUnit } from '../../platform/contract/service/units.js';
import { writes, type WriteSet } from '../../platform/contract/service/writes.js';
import { moveFile, removeFile } from '../../platform/durable/files.js';
import { threadSourceIntent } from '../store/journal.js';
import { RolloutUnreadable } from './rolloutFile.js';
import { compressedRollout, rolloutStateOf } from './rolloutForms.js';
import type { SourcePublication } from './sourceFiles.js';

export type SourceReplacement = Effect.Success<ReturnType<typeof makeSourceReplacement>>;
type ReplacementInput = {
  readonly threadId: string;
  readonly canonical: string;
  readonly staged: string;
  readonly target: 'plain' | 'compressed';
  readonly digest: string;
};

const intents = writes('ThreadRollout.replacementIntent', [threadSourceIntent]);

export const makeSourceReplacement = Effect.fnUntraced(function* (publication: SourcePublication, home: string | undefined) {
  const { db } = yield* MachineStore;
  const units = yield* MachineUnits;
  const kinds = yield* ThreadEntryKinds;
  const pending = new Map(
    (yield* units.read((unit) =>
      unit.run(db.select({ id: threadSourceIntent.threadId, place: threadSourceIntent.place }).from(threadSourceIntent)),
    )).map((row) => [row.id, row.place]),
  );
  const io = (path: string, cause: unknown) =>
    new RolloutUnreadable({
      reason: 'io',
      path,
      message: cause instanceof Error ? cause.message : String(cause),
    });
  const canonicalAt = (place: string): Effect.Effect<string, RolloutUnreadable> => {
    const parts = place.split('/');
    if (home === undefined || parts.some((part) => part === '.' || part === '..' || !/^[A-Za-z0-9._-]+$/.test(part)))
      return Effect.fail(io(place, 'the replacement intent has no valid journal place'));
    return Effect.succeed(resolve(home, ...parts));
  };
  const placeOf = (canonical: string): Effect.Effect<string, RolloutUnreadable> => {
    if (home === undefined) return Effect.fail(io(canonical, 'the journal home is unavailable'));
    const place = relative(home, canonical);
    if (place === '' || isAbsolute(place) || place === '..' || place.startsWith(`..${sep}`))
      return Effect.fail(io(canonical, 'the journal is outside its home'));
    return Effect.succeed(place.split(sep).join('/'));
  };
  const exists = (path: string) =>
    Effect.tryPromise({
      try: () =>
        access(path).then(
          () => true,
          (cause: NodeJS.ErrnoException) => {
            if (cause.code === 'ENOENT') return false;
            throw cause;
          },
        ),
      catch: (cause) => io(path, cause),
    });
  const hash = (path: string) =>
    publication.digest(path).pipe(
      Effect.provideService(ThreadEntryKinds, kinds),
      Effect.mapError((cause) => (cause instanceof RolloutUnreadable ? cause : io(path, cause.message))),
    );
  const move = (from: string, to: string) =>
    moveFile(from, to).pipe(
      Effect.mapError((cause) => io(to, cause.reason)),
      Effect.flatMap((durability) => (durability === 'full' ? Effect.void : Effect.fail(io(to, 'a full flush is unavailable')))),
    );
  const remove = (path: string) => removeFile(path).pipe(Effect.mapError((cause) => io(path, cause.reason)));
  const named = (canonical: string, form: 'plain' | 'compressed') => (form === 'plain' ? canonical : compressedRollout(canonical));
  const intentOf = (threadId: string) =>
    units.read((unit) => unit.run(db.select().from(threadSourceIntent).where(eq(threadSourceIntent.threadId, threadId)).get()));

  const settle = Effect.fn('ThreadRollout.replacement.settle')(function* (threadId: string, canonical: string) {
    const intent = yield* intentOf(threadId);
    if (intent === undefined) {
      pending.delete(threadId);
      return;
    }
    pending.set(threadId, intent.place);
    if ((yield* canonicalAt(intent.place)) !== resolve(canonical))
      return yield* io(canonical, 'the replacement intent names a different journal place');
    if (!/^\.[A-Za-z0-9._-]+$/.test(intent.stage) || !/^[0-9a-f-]{36}$/.test(intent.operation))
      return yield* io(canonical, 'the replacement intent does not name a valid staged file');
    const staged = `${canonical}${intent.stage}`;
    const backup = `${canonical}.source-backup-${intent.operation}`;
    const target = named(canonical, intent.target);
    const previous = intent.previous === null ? null : named(canonical, intent.previous);
    const saved = yield* exists(backup);
    const targetExists = yield* exists(target);
    const stagedExists = yield* exists(staged);
    if (stagedExists && (yield* hash(staged)) !== intent.digest)
      return yield* io(staged, 'the staged rollout no longer matches its replacement intent');
    if (saved) {
      if (intent.previous === null || intent.previousDigest === null || (yield* hash(backup)) !== intent.previousDigest)
        return yield* io(backup, 'the saved rollout no longer matches its replacement intent');
      if (targetExists && (yield* hash(target)) !== intent.digest)
        return yield* io(target, 'the replacement target changed before its intent settled');
    } else if (previous !== null) {
      if (!(yield* exists(previous)) || intent.previousDigest === null || (yield* hash(previous)) !== intent.previousDigest)
        return yield* io(previous, 'the prior rollout is missing or changed during replacement');
      if (target !== previous && targetExists) return yield* io(target, 'another rollout occupies the replacement target');
    } else if (targetExists && (yield* hash(target)) !== intent.digest) {
      return yield* io(target, 'another rollout occupies the replacement target');
    }
    if (saved) {
      if (targetExists) yield* remove(target);
      yield* move(backup, previous!);
    } else if (previous === null && targetExists) yield* remove(target);
    if (stagedExists) yield* remove(staged);
    yield* units.write(intents, (unit) =>
      unit.run(
        db
          .delete(threadSourceIntent)
          .where(and(eq(threadSourceIntent.threadId, threadId), eq(threadSourceIntent.operation, intent.operation))),
      ),
    );
    pending.delete(threadId);
  });

  const replace = Effect.fnUntraced(function* <A, E>(
    input: ReplacementInput,
    operation: WriteSet,
    commit: (unit: WriteUnit<'machine'>) => Effect.Effect<A, E>,
  ) {
    if ((yield* intentOf(input.threadId)) !== undefined)
      return yield* io(input.canonical, 'an earlier replacement must settle before a new one is staged');
    const place = yield* placeOf(input.canonical);
    yield* canonicalAt(place);
    if (!input.staged.startsWith(input.canonical)) return yield* io(input.staged, 'the staged rollout is outside its journal');
    const suffix = input.staged.slice(input.canonical.length);
    if (!/^\.[A-Za-z0-9._-]+$/.test(suffix)) return yield* io(input.staged, 'the staged rollout has an invalid name');
    if ((yield* hash(input.staged)) !== input.digest) return yield* io(input.staged, 'the staged rollout changed before publication');
    const current = yield* rolloutStateOf(input.canonical);
    const previous = current?.form ?? null;
    const previousDigest = current === null ? null : yield* hash(current.path);
    const operationId = randomUUID();
    const target = named(input.canonical, input.target);
    const backup = `${input.canonical}.source-backup-${operationId}`;
    if (current !== null && target !== current.path && (yield* exists(target)))
      return yield* io(target, 'another rollout occupies the replacement target');
    pending.set(input.threadId, place);
    yield* units.write(intents, (unit) =>
      unit.run(
        db.insert(threadSourceIntent).values({
          threadId: input.threadId,
          operation: operationId,
          place,
          stage: suffix,
          digest: input.digest,
          previous,
          previousDigest,
          target: input.target,
        }),
      ),
    );
    return yield* Effect.gen(function* () {
      if (current !== null) yield* move(current.path, backup);
      yield* move(input.staged, target);
      const value = yield* units.write(writes(operation.operation, [threadSourceIntent], operation), (unit) =>
        Effect.gen(function* () {
          const result = yield* commit(unit);
          yield* unit.run(
            db
              .delete(threadSourceIntent)
              .where(and(eq(threadSourceIntent.threadId, input.threadId), eq(threadSourceIntent.operation, operationId))),
          );
          return result;
        }),
      );
      pending.delete(input.threadId);
      yield* remove(backup).pipe(
        Effect.catchCause((cause) => Effect.logError(`The old rollout of ${input.threadId} could not be removed`, cause)),
      );
      return value;
    }).pipe(
      Effect.onError(() =>
        settle(input.threadId, input.canonical).pipe(
          Effect.catchCause((cause) => Effect.logError(`The replacement of ${input.threadId} could not settle`, cause)),
        ),
      ),
    );
  });

  const recover = Effect.fnUntraced(function* (threadId: string) {
    const place = pending.get(threadId);
    if (place === undefined) return;
    yield* settle(threadId, yield* canonicalAt(place));
  });

  return { pending: (threadId: string) => pending.has(threadId), pendingIds: () => [...pending.keys()], settle, recover, replace };
});
