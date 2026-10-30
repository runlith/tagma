import { Clock, Cause, Context, Effect } from 'effect';
import { eq } from 'drizzle-orm';
import { access, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { MachineStore } from '../../platform/contract/service/store.js';
import { stored } from '../../platform/store/crossing.js';
import { recordFacts } from '../../thread-record/facts.js';
import type { HarnessFailure } from '../contract/service/failure.js';
import { restStamps } from '../rest.js';
import { threadRolloutCursor, threadRolloutHome } from '../store/journal.js';
import { ROLLOUT_SUFFIX, openRollout, rolloutStateOf, rolloutThreadId } from './rolloutForms.js';
import { replayThreadRollout, rolloutBase } from './replay.js';
import type { RolloutUnreadable } from './rolloutFile.js';
import type { RolloutSyncRefused } from './export.js';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import { ThreadEntryKinds } from '@runlith/agent/transcript/kinds';
import type { RolloutContext } from './rolloutContext.js';
import type { RolloutForms } from './rolloutForming.js';

const exists = (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false,
  );

export const rolloutReconciling = (
  ctx: RolloutContext,
  forms: RolloutForms,
  written: (threadId: string, path: string) => Effect.Effect<void, RolloutSyncRefused | RolloutUnreadable | StoreFailure>,
) => {
  const { records, floor, projection, parts, inJournal, graph } = ctx;

  return Effect.fnUntraced(function* (): Effect.fn.Return<number, HarnessFailure> {
    const home = ctx.home;
    if (home === undefined) return 0;
    const store = Context.get(graph, MachineStore);
    const imported = yield* stored('rollout-replay')(
      store.db.select({ path: threadRolloutHome.path }).from(threadRolloutHome).where(eq(threadRolloutHome.path, home)).get(),
    );
    const recorded = stored('rollout-replay')(
      store.db
        .insert(threadRolloutHome)
        .values({ path: home, importedAt: new Date(yield* Clock.currentTimeMillis) })
        .onConflictDoNothing(),
    );
    if (!(yield* Effect.promise(() => exists(home)))) {
      if (imported === undefined) yield* recorded;
      return 0;
    }
    const pending = yield* floor.pendingRollouts();
    const settle = (threadId: string, path: string, cursor?: typeof threadRolloutCursor.$inferSelect): Effect.Effect<number> =>
      inJournal(
        threadId,
        Effect.andThen(
          forms.formedHere(threadId, path),
          projection.run({ threadId, path }, cursor).pipe(
            Effect.map(({ projected }) => projected),
            Effect.tap(() => floor.unmark(threadId)),
            Effect.catchTag('ThreadProjectionRefused', (failure) =>
              Effect.gen(function* () {
                yield* floor.remark({ threadId, path });
                console.error(`[tagma] rollout reconciliation failed for ${path}`, failure.message);
                yield* projection
                  .record(failure)
                  .pipe(
                    Effect.catchCause((cause) =>
                      Effect.sync(() => console.error(`[tagma] the refusal for ${threadId} could not be recorded`, Cause.squash(cause))),
                    ),
                  );
                return 0;
              }),
            ),
          ),
        ),
      ).pipe(
        Effect.catchCause((cause) =>
          floor.remark({ threadId, path }).pipe(
            Effect.map(() => {
              console.error(`[tagma] rollout reconciliation failed for ${path}`, Cause.squash(cause));
              return 0;
            }),
          ),
        ),
      );
    const read = new Map<string, string | null>();
    const sourceOf = Effect.fnUntraced(function* (sourceId: string) {
      const known = read.get(sourceId);
      if (known !== undefined) return known === null ? [] : [[sourceId, known] as const];
      let found: string | null = null;
      for (const projectDir of yield* Effect.promise(() => readdir(home, { withFileTypes: true }))) {
        if (!projectDir.isDirectory()) continue;
        const path = join(home, projectDir.name, `${sourceId}${ROLLOUT_SUFFIX}`);
        if ((yield* rolloutStateOf(path)) === null) continue;
        yield* forms.formedOpen(sourceId, path);
        found = path;
        break;
      }
      read.set(sourceId, found);
      return found === null ? [] : [[sourceId, found] as const];
    });
    const bring = (threadId: string, path: string): Effect.Effect<number> =>
      inJournal(
        threadId,
        forms
          .formedHere(threadId, path)
          .pipe(
            Effect.andThen(openRollout(path)),
            Effect.andThen(rolloutBase(path, parts.native.folds).pipe(Effect.provideService(ThreadEntryKinds, ctx.kinds))),
          ),
      )
        .pipe(
          Effect.flatMap((base) => Effect.forEach(new Set(base.map((layer) => layer.sourceId)), sourceOf)),
          Effect.flatMap((found) =>
            inJournal(
              threadId,
              replayThreadRollout({ path, parts, records, sources: new Map(found.flat()) }).pipe(
                Effect.provideService(MachineStore, store),
                Effect.provideService(ThreadEntryKinds, ctx.kinds),
                Effect.tap(({ inherited }) => (inherited === 0 ? Effect.void : written(threadId, path))),
                Effect.tap(() => floor.unmark(threadId)),
              ),
            ),
          ),
        )
        .pipe(
          Effect.as(1),
          Effect.catchCause((cause) =>
            floor.remark({ threadId, path }).pipe(
              Effect.map(() => {
                console.error(`[tagma] rollout replay failed for ${path}`, Cause.squash(cause));
                return 0;
              }),
            ),
          ),
        );
    let moved = 0;
    if (imported !== undefined) {
      for (const { threadId, path } of pending) {
        if ((yield* rolloutStateOf(path)) === null) {
          yield* floor.unmark(threadId);
          continue;
        }
        const row = yield* stored('rollout-replay')(
          store.db
            .select({ evictedAt: restStamps.restedAt })
            .from(recordFacts)
            .innerJoin(restStamps, eq(restStamps.id, recordFacts.id))
            .where(eq(recordFacts.id, threadId))
            .get(),
        );
        if (row === undefined) {
          moved += yield* bring(threadId, path);
          continue;
        }
        if (row.evictedAt !== null) {
          yield* floor.unmark(threadId);
          continue;
        }
        const cursor = yield* stored('rollout-replay')(
          store.db.select().from(threadRolloutCursor).where(eq(threadRolloutCursor.threadId, threadId)).get(),
        );
        moved += yield* settle(threadId, path, cursor);
      }
      return moved;
    }
    const held = yield* stored('rollout-replay')(
      store.db
        .select({ threadId: recordFacts.id, evictedAt: restStamps.restedAt })
        .from(recordFacts)
        .innerJoin(restStamps, eq(restStamps.id, recordFacts.id)),
    );
    const standing = new Set(held.map((row) => row.threadId));
    const rested = new Set(held.flatMap((row) => (row.evictedAt === null ? [] : [row.threadId])));
    const cursors = new Map(
      (yield* stored('rollout-replay')(store.db.select().from(threadRolloutCursor))).map((row) => [row.threadId, row] as const),
    );
    for (const projectDir of yield* Effect.promise(() => readdir(home, { withFileTypes: true }))) {
      if (!projectDir.isDirectory()) continue;
      const named = new Set<string>();
      for (const file of yield* Effect.promise(() => readdir(join(home, projectDir.name)))) {
        const threadId = rolloutThreadId(file);
        if (threadId !== null) named.add(threadId);
      }
      for (const threadId of named) {
        const path = join(home, projectDir.name, `${threadId}${ROLLOUT_SUFFIX}`);
        if (!standing.has(threadId)) moved += yield* bring(threadId, path);
        else if (!rested.has(threadId)) moved += yield* settle(threadId, path, cursors.get(threadId));
      }
    }
    yield* recorded;
    return moved;
  });
};
