import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { eq } from 'drizzle-orm';
import { Clock, Effect } from 'effect';
import { builtinRegistry } from '../providerCatalog.js';
import { ProviderRegistry } from '../../../providers/contract/service/registry.js';
import { acpTestSeat } from '../../../external-harnesses/testing/seats.js';
import { sessionStoreOver } from '../../../external-harnesses/testing/floor.js';
import { terminalArgv } from '../../../external-harnesses/testing/doubles.js';
import { SCOPED_RUN, threadRunStore } from '../../../native-harness/testing/doubles.js';
import { thread, threadDirectoryStore, modelChanges } from '../../../threads/testing/doubles.js';
import { threadStoreFixture } from '../threadStoreFixture.js';
import { ENTRY_KINDS } from '../../manifest.js';

layer(builtinRegistry, { excludeTestServices: true })('thread lifecycle readings', (it) => {
  it.effect('a native and an acp run stall by one rule, and the stalled filter selects both', () =>
    Effect.gen(function* () {
      const demo = yield* threadStoreFixture;
      const { db, units, records, store, threads, projectId, context } = demo;
      const catalog = yield* (yield* ProviderRegistry).catalog;
      const sessions = yield* sessionStoreOver(db, units, threads.spells, records, yield* Effect.provide(modelChanges(), context));
      const runs = yield* Effect.provide(
        threadRunStore({
          kinds: ENTRY_KINDS,
          records,
          ownerId: 'operator',
          scope: SCOPED_RUN(),
          lifecycle: {
            started: (id, at, unit) => threads.spells.begin(id, at, unit),
            settled: (id, unit) => threads.spells.end(id, unit),
          },
        }),
        context,
      );
      const born = (acp: boolean) =>
        units.write('lifeReads.born', (unit) =>
          Effect.gen(function* () {
            const row = yield* store.insert({ ownerId: 'operator', agentId: acp ? 'harness' : 'tagma' }, unit);
            yield* threads.rows.attachFacet(
              { threadId: row.id, projectId, harness: acp ? acpTestSeat('claude-code', 'tagma', undefined) : undefined },
              unit,
            );
            return row.id;
          }),
        );
      const native = yield* born(false);
      const acp = yield* born(true);
      const healthy = yield* born(false);
      const opened = yield* sessions.open(acp, '', 'operator', terminalArgv(catalog.models, ''));
      yield* sessions.change(acp, (facet) =>
        Effect.succeed({ facet: { ...facet, session: { ...opened, state: 'running' as const } }, value: undefined }),
      );
      for (const id of [native, acp, healthy])
        yield* runs.createRun({
          startFrom: { id, ownerId: 'operator', account: null, provider: 'openai-oauth', model: 'test', reasoning: null, switches: {} },
          kind: 'turn',
          approval: { mode: 'trust', interactive: false },
          progress: { stage: 'running', message: null },
        });
      const quiet = new Date((yield* Clock.currentTimeMillis) - 120 * 60_000);
      for (const id of [native, acp]) yield* db.update(thread()).set({ updatedAt: quiet }).where(eq(thread().id, id));
      const directory = yield* Effect.provide(threadDirectoryStore(ENTRY_KINDS), context);
      const rows = (yield* directory.list({ principal: 'operator', from: native, limit: 10 })).rows;
      const stalledSince = (id: string) => rows.find((row) => row.threadId === id)?.run?.stalledSince ?? null;
      expect(stalledSince(native)?.getTime()).toBe(quiet.getTime());
      expect(stalledSince(acp)?.getTime()).toBe(quiet.getTime());
      expect(stalledSince(healthy)).toBeNull();
      const selected = yield* threads.list.list('operator', projectId, {
        view: 'live',
        state: { kind: 'stalled', now: new Date(yield* Clock.currentTimeMillis) },
      });
      expect(selected.rows.map((row) => row.id).sort()).toEqual([native, acp].sort());
      expect(selected.rows.map((row) => row.life)).toEqual(['stalled', 'stalled']);
    }),
  );
});
