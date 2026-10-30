import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { sql } from 'drizzle-orm';
import { chain } from '../../../platform/store/chain.js';
import { terminalKernel } from '../../../external-harnesses/testing/doubles.js';
import { harnessPresentation } from '../../../external-harnesses/contract/service/table.js';
import { builtinHarness } from '../../../external-harnesses/testing/builtin.js';
import { harnessFacet } from '../../../threads/contract/wire/harness/types.js';
import { threadStoreFixture } from '../threadStoreFixture.js';
import { fixtureMigrations } from '../migrations.js';

const migration = chain(fixtureMigrations).find((step) => step.name === '20261030160000_harness_presentation');

it.live(
  'a thread stored before harnesses carried their presentation lists with its label, mark and icon',
  Effect.fnUntraced(function* () {
    expect(migration, 'the harness presentation migration is not shipped').toBeDefined();
    const demo = yield* threadStoreFixture;
    const { store, threads } = demo;
    const id = yield* demo.units
      .write('harnessPresentation.born', (unit) =>
        Effect.gen(function* () {
          const created = yield* store.insert({ ownerId: 'operator', agentId: 'harness' }, unit);
          yield* threads.rows.attachFacet(
            {
              threadId: created.id,
              projectId: demo.projectId,
              harness: {
                facet: harnessFacet('cursor', harnessPresentation(builtinHarness('cursor'))),
                kernel: terminalKernel(builtinHarness('cursor'), undefined, false, {}),
              },
            },
            unit,
          );
          return created.id;
        }),
      )
      .pipe(Effect.orDie);
    yield* demo.db.run(sql`update external_session set facet = json_remove(facet, '$.presentation') where id = ${id}`).pipe(Effect.orDie);
    for (const statement of migration!.sql) yield* demo.db.run(sql.raw(statement)).pipe(Effect.orDie);
    const { rows } = yield* threads.list
      .list('operator', { id: demo.projectId, projects: [demo.projectId] }, { view: 'live' })
      .pipe(Effect.orDie);
    const presentation = rows.find((row) => row.id === id)?.harness?.presentation;
    expect(presentation).toMatchObject({ label: 'Cursor', iconProvider: null, hosted: true, sharedSessions: false });
    expect(presentation?.mark).toStartWith('<svg');
  }),
);
