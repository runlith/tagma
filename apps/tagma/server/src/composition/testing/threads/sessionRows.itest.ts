import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { sql } from 'drizzle-orm';
import { Effect } from 'effect';
import { TestClock } from 'effect/testing';
import { harnessFacet } from '../../../threads/contract/wire/harness/types.js';
import { harnessPresentation } from '../../../external-harnesses/contract/service/table.js';
import { builtinHarness } from '../../../external-harnesses/testing/builtin.js';
import { modelChanges } from '../../../threads/testing/doubles.js';
import { sessionRowsOver } from '../../../external-harnesses/testing/floor.js';
import { describeSessionStore } from '../../../external-harnesses/testing/sessionConformance.js';
import { HarnessSessionStore, terminalKernel } from '../../../external-harnesses/testing/doubles.js';
import { threadStoreFixture } from '../threadStoreFixture.js';

const fixture = Effect.fnUntraced(function* () {
  const demo = yield* threadStoreFixture;
  const rows = yield* sessionRowsOver(
    demo.db,
    demo.units,
    demo.threads.spells,
    demo.records,
    yield* Effect.provide(modelChanges(), demo.context),
  );
  const id = yield* demo.units.write('testing.sessionRows', (unit) =>
    Effect.gen(function* () {
      const thread = yield* demo.store.insert({ ownerId: 'operator', agentId: 'harness' }, unit);
      yield* demo.threads.rows.attachFacet(
        {
          threadId: thread.id,
          projectId: demo.projectId,
          harness: {
            facet: harnessFacet('claude-code', harnessPresentation(builtinHarness('claude-code'))),
            kernel: terminalKernel(builtinHarness('claude-code'), undefined, false, {}),
          },
        },
        unit,
      );
      return thread.id;
    }),
  );
  const revision = () =>
    demo.units.read((unit) =>
      Effect.map(
        unit.run(demo.db.get<{ revision: number }>(sql`select change_rev as revision from native_thread_rev where thread_id = ${id}`)),
        (row) => row?.revision ?? 0,
      ),
    );
  return { store: new HarnessSessionStore(rows, () => Effect.void), rows, id, revision };
});

describeSessionStore('SQL', fixture, it.effect);

it.effect('a lease beat leaves the thread change revision where it stood and a facet change advances it', () =>
  Effect.gen(function* () {
    const { store, id, revision } = yield* fixture();
    yield* store.open(id, '', 'first', () => Effect.succeed(null));
    const opened = yield* revision();
    yield* TestClock.adjust(1_000);
    expect(yield* store.beat('first', 'terminal', [id])).toContain(id);
    expect(yield* revision()).toBe(opened);
    yield* store.change(id, (facet) => Effect.succeed({ facet: { ...facet, sessionKey: 'changed' }, value: undefined }));
    expect(yield* revision()).toBeGreaterThan(opened);
  }),
);
