import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { harnessFacet } from '../../../threads/contract/wire/harness/types.js';
import { harnessPresentation } from '../../../external-harnesses/contract/service/table.js';
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
            facet: harnessFacet('claude-code', harnessPresentation('claude-code')),
            kernel: terminalKernel('claude-code', undefined, false, {}),
          },
        },
        unit,
      );
      return thread.id;
    }),
  );
  return { store: new HarnessSessionStore(rows, () => Effect.void), rows, id };
});

describeSessionStore('SQL', fixture, it.effect);
