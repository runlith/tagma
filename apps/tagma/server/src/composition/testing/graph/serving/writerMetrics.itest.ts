import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { CostLedger, costLedgerLayer, rootCost } from '@runlith/performance/CostLedger';
import { Context, Effect } from 'effect';
import { eq } from 'drizzle-orm';
import { GraphStore } from '../../../../platform/contract/service/store.js';
import { Blocks } from '../../../../graph/contract/service/blocks.js';
import { BlockNames } from '../../../../graph/contract/service/acts.js';
import { InstalledCatalogs, Tags } from '../../../../graph/contract/service/vocabulary.js';
import type { ServedGraph } from '../../../../graph/contract/service/serving.js';
import { CatalogGraph } from '../../../../graph/vocabulary/install.js';
import { block } from '../../../../graph/store/tables.js';
import { signedBy } from '../../../../invocation/testing/call.js';
import { servingLayer, withServing } from './fixture.js';

const stale = Effect.fnUntraced(function* (served: ServedGraph, projectId: number, revision: string) {
  const catalogs = Context.get(served.context, InstalledCatalogs);
  const catalog = (yield* catalogs.read(projectId)).find((row) => row.id === 'software-development');
  if (catalog?.release === undefined) return yield* Effect.die('the served project has no released software catalog');
  const names = Context.get(served.context, BlockNames);
  const blocks = Context.get(served.context, Blocks);
  const row = yield* blocks.blockById(yield* names.idOfName(catalog.name));
  yield* Context.get(served.context, GraphStore)
    .db.update(block)
    .set({ fields: { ...row.fields, release: { ...catalog.release, revision } } })
    .where(eq(block.id, row.id));
  yield* Context.get(served.context, Tags).forget(projectId);
  return catalog.release.revision;
});

layer(servingLayer, { excludeTestServices: true })('writer telemetry across graph contexts', (it) => {
  it.effect('a reopened stale mirror and its catalog writer retain process observations and each invoking root', () =>
    withServing(({ pool, served: initial, projectId }) =>
      Effect.gen(function* () {
        const writers = Context.get(initial.context, GraphStore).processes.writerMetrics;
        const ledger = yield* CostLedger.pipe(Effect.provide(costLedgerLayer({ capacity: 2 })));
        const expected = yield* stale(initial, projectId, 'earlier-opening');
        yield* pool.release(initial);
        const served = yield* rootCost('opening', pool.resolve({ projectId }), 'opening-root').pipe(
          Effect.provideService(CostLedger, ledger),
        );
        const opened = writers.units({ rootId: 'opening-root', operation: 'Projects.ensureVocabulary', limit: 4 });
        const installed = Context.get(served.context, InstalledCatalogs);
        expect((yield* installed.read(projectId)).find((row) => row.id === 'software-development')?.release?.revision).toBe(expected);
        yield* stale(served, projectId, 'earlier-invocation');
        const catalog = Context.get(served.context, CatalogGraph);
        if (catalog === null) return yield* Effect.die('the served project has no catalog writer');
        const install = signedBy({ harness: 'test', key: 'writer-catalog' })(
          Effect.flatMap(catalog(projectId), (write) => write(['software-development'])),
        ).pipe(Effect.provide(served.context));
        yield* rootCost('installing', install, 'install-root').pipe(Effect.provideService(CostLedger, ledger));
        expect((yield* installed.read(projectId)).find((row) => row.id === 'software-development')?.release?.revision).toBe(expected);
        const invoked = writers.units({ rootId: 'install-root', operation: 'Catalog.install', limit: 4 });
        expect(opened.rows).toHaveLength(1);
        expect(invoked.rows).toHaveLength(1);
        for (const row of [...opened.rows, ...invoked.rows]) {
          expect(row.acquired).toBe(true);
          expect(row.commitReturnedAt).toBeGreaterThan(0);
          expect(row.holdMs).toBeGreaterThan(0);
        }
        expect(writers.metrics({ operation: 'Projects.ensureVocabulary', limit: 1 }).rows[0]!.count).toBeGreaterThan(0);
        expect(writers.metrics({ operation: 'Catalog.install', limit: 1 }).rows[0]!.count).toBeGreaterThan(0);
      }),
    ),
  );
});
