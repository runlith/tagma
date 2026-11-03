import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { and, eq } from 'drizzle-orm';
import { Context, Effect } from 'effect';
import { Blocks } from '../../../../graph/contract/service/blocks.js';
import { InstalledCatalogs, Tags } from '../../../../graph/contract/service/vocabulary.js';
import { shippedSteps } from '../../../../graph/steps/sequence.js';
import { rowsStepKey } from '../../../../graph/contract/wire/storage.js';
import { localTypeId, shippedTypeId } from '../../../../graph/contract/wire/tags/identity.js';
import { block, meta } from '../../../../graph/store/tables.js';
import { ensureVocabulary } from '../../../../graph/serving/birth.js';
import { graphPool, machineGraphOf } from '../../../../graph/testing/doubles.js';
import { signedBy } from '../../../../invocation/testing/call.js';
import { testSessionIdentity } from '../../../../platform/testing/identity.js';
import { setting } from '../../../../settings/store/table.js';
import { withDemo } from '../../graphFixture.js';
import { fixtureGraphMigrations } from '../../migrations.js';
import { SHIPPED_CATALOGS } from '../../settings.js';
import { installNotes } from '../tree/notesFixture.js';
import { servingLayer } from './fixture.js';

layer(servingLayer, { excludeTestServices: true })('machine vocabulary order', (it) => {
  it.effect('only current rows receive catalogs before legacy rows switch, advance and install in their mirror', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const { graph, projectId: unknown } = demo;
        const { db } = graph.graphStore;
        const legacy = demo.project('repo');
        const global = yield* graph.projects.global();
        if (global === undefined) return yield* Effect.die('the fixture has no global graph');
        const steps = shippedSteps;
        const sequence = steps.after(null);
        const prior = sequence[sequence.findIndex((step) => step.id === '20261020160000_knowledge_names') - 1]?.id;
        if (prior === undefined) return yield* Effect.die('the fixture has no graph step before knowledge names');
        yield* installNotes(legacy.id);
        const legacyRoot = (yield* graph.blocks.rootBlockOf(legacy.id)).id;
        const person = yield* graph.blocks.create({ projectId: legacy.id, parentId: legacyRoot, tags: ['person'], title: 'Ada' });
        const personName = yield* demo.nameOf(person.id);
        const meeting = yield* graph.blocks.create({
          projectId: legacy.id,
          parentId: legacyRoot,
          tags: ['meeting'],
          title: 'planning',
          fields: { held: '2026-10-20', attendees: [personName] },
        });
        const note = yield* graph.blocks.create({
          projectId: legacy.id,
          parentId: legacyRoot,
          tags: ['note'],
          title: 'a thought',
          body: 'kept',
        });
        const before = yield* db.select().from(block).where(eq(block.projectId, legacy.id)).orderBy(block.id);
        const noteType = before.find((row) => row.tags.includes('tag') && row.fields.id === 'note');
        const catalog = before.find((row) => row.tags.includes('catalog') && row.fields.id === 'notes');
        if (noteType === undefined || catalog === undefined) return yield* Effect.die('the fixture has no notes declarations');
        const current = yield* graph.projectLifecycle.create({
          name: 'current',
          rootPath: yield* demo.fixture.directory('current'),
          catalogs: [],
        });
        yield* db
          .update(meta)
          .set({ value: prior })
          .where(eq(meta.key, rowsStepKey(legacy.id)));
        yield* db.delete(meta).where(eq(meta.key, rowsStepKey(unknown)));
        yield* db
          .update(meta)
          .set({ value: 'a-step-of-a-newer-release' })
          .where(eq(meta.key, rowsStepKey(global.id)));
        yield* graph.settings.write({ scope: 'user', key: SHIPPED_CATALOGS.key.id, value: ['knowledge'] });
        yield* db
          .update(setting)
          .set({ value: '["knowledge"]' })
          .where(and(eq(setting.key, SHIPPED_CATALOGS.key.id), eq(setting.projectId, current.id)));

        expect(yield* ensureVocabulary('machine')).toEqual([current.id]);
        expect(yield* db.select().from(block).where(eq(block.projectId, legacy.id)).orderBy(block.id)).toEqual(before);
        expect((yield* graph.blocks.blockById(note.id)).body).toBe('kept');
        expect((yield* (yield* InstalledCatalogs).read(current.id)).map((row) => row.id).sort()).toEqual(['core', 'knowledge']);
        yield* db
          .update(meta)
          .set({ value: steps.last })
          .where(eq(meta.key, rowsStepKey(global.id)));
        expect((yield* ensureVocabulary('machine')).sort()).toEqual([global.id, current.id].sort());
        expect((yield* (yield* InstalledCatalogs).read(global.id)).map((row) => row.id)).toContain('knowledge');

        const pool = yield* Effect.acquireRelease(
          graphPool({
            machine: machineGraphOf(demo.context),
            sourcePath: legacy.root,
            identity: testSessionIdentity,
            migrations: fixtureGraphMigrations,
          }),
          (pool) => pool.dispose(),
        );
        const served = yield* pool.resolve({ projectId: legacy.id });
        yield* signedBy({ harness: 'test', key: 'boot-vocabulary' })(
          Effect.gen(function* () {
            const catalogs = yield* (yield* InstalledCatalogs).read(legacy.id);
            const installed = catalogs.find((row) => row.id === 'knowledge');
            expect(catalogs.map((row) => row.id).sort()).toEqual(['core', 'knowledge', 'software-development', 'work']);
            expect(installed?.name).toBe(yield* demo.nameOf(catalog.id));
            const blocks = yield* Blocks;
            const table = yield* (yield* Tags).of(legacy.id);
            expect(table.unreadable).toEqual([]);
            expect(table.identities.typeOf('person')?.id).toBe(shippedTypeId('knowledge', 'person'));
            expect(table.identities.typeOf('note')?.id).toBe(localTypeId(noteType.uuid.replaceAll('-', '').toLowerCase()));
            expect((yield* blocks.blockById(meeting.id)).fields).toEqual({ held: '2026-10-20', attendees: [personName] });
            yield* blocks.update({ id: note.id, body: 'still editable' });
            expect((yield* blocks.blockById(note.id)).body).toBe('still editable');
          }).pipe(Effect.provide(served.context)),
        );
      }),
    ),
  );
});
