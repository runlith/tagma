import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { and, eq, inArray } from 'drizzle-orm';
import { Effect } from 'effect';
import { coreLibrary } from '../../../../catalogs/contract/wire/coreLibrary.js';
import { softwareDevelopment } from '../../../../catalogs/contract/wire/softwareDevelopment.js';
import { InstalledCatalogs } from '../../../../graph/contract/service/vocabulary.js';
import { EXPLANATION } from '../../../../graph/contract/wire/tags/explanation.js';
import { CORE_LIBRARY, fieldIdOf, shippedTypeId } from '../../../../graph/contract/wire/tags/identity.js';
import { ensureVocabulary } from '../../../../graph/serving/birth.js';
import { block, blockTag } from '../../../../graph/store/tables.js';
import { softwareDevelopmentNames } from '../../../../graph/steps/softwareDevelopmentNames.js';
import { TagIndex } from '../../../../graph/vocabulary/tagIndex.js';
import { BEHAVIOUR_REGISTRY } from '../../../manifest.js';
import { demoGraphLayer, withDemo } from '../../graphFixture.js';
import { SHIPPED_CATALOGS } from '../../settings.js';
import { installNotes } from './notesFixture.js';

type Raw = Record<string, unknown>;

const WAS = 'code-project';
const NOW = softwareDevelopment.id;
const MOVED = ['proposal', 'reflection', 'view'];
const EARLIER = 'A #note explains what the code cannot.';
const EARLIER_VIEW = 'A #view saves a selection.';

const olderText = (text: string, carried: boolean): string => {
  let out = text
    .replaceAll(`"library":"${NOW}","export":"explanation"`, `"library":"${WAS}","export":"note"`)
    .replaceAll(shippedTypeId(NOW, 'explanation'), shippedTypeId(WAS, 'note'))
    .replaceAll(`shipped:${NOW}/`, `shipped:${WAS}/`)
    .replaceAll(`"library":"${NOW}"`, `"library":"${WAS}"`);
  for (const one of MOVED) {
    out = out.replaceAll(`"library":"${CORE_LIBRARY}","export":"${one}"`, `"library":"${WAS}","export":"${one}"`);
    if (carried) out = out.replaceAll(shippedTypeId(CORE_LIBRARY, one), shippedTypeId(WAS, one));
  }
  return out;
};

const older = (value: unknown, carried: boolean): Raw => JSON.parse(olderText(JSON.stringify(value), carried)) as Raw;

const olderKey = (tag: string): string => (tag === 'note' ? 'notes.note' : tag === 'explanation' ? 'note' : tag);

layer(demoGraphLayer(), { excludeTestServices: true })('software-development names', (it) => {
  it.effect('a code-project graph takes the new catalog, #explanation and core ids once, and installation accepts it', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const { graph, projectId } = demo;
        const { db } = graph.graphStore;
        yield* graph.settings.write({ scope: 'project', projectId, key: SHIPPED_CATALOGS.key.id, value: [NOW] });
        yield* installNotes(projectId);
        const explained = yield* graph.blocks.create({ projectId, tags: ['explanation'], title: 'the cursor only moves forward' });
        const noted = yield* graph.blocks.create({ projectId, tags: ['note'], title: 'a thought' });
        const task = yield* graph.blocks.create({ projectId, tags: ['task'], title: 'open work' });
        const reflection = yield* graph.blocks.create({
          projectId,
          contract: 'core/reflection',
          title: 'a refusal',
          fields: { command: 'read', expected: 'an answer', actual: 'a refusal' },
        });
        const status = fieldIdOf(shippedTypeId(NOW, 'task'), 'status');
        const sort = { by: 'created', order: 'asc' } as const;
        const work = yield* graph.blocks.create({
          projectId,
          contract: 'core/selection',
          title: 'open work',
          fields: { query: { tags: [shippedTypeId(NOW, 'task')], fields: { [status]: 'open' }, sort } },
        });
        const sightings = yield* graph.blocks.create({
          projectId,
          contract: 'core/selection',
          title: 'sightings',
          fields: { query: { tags: [shippedTypeId(CORE_LIBRARY, 'reflection')], sort } },
        });
        const chosen = yield* graph.blocks.create({
          projectId,
          contract: 'core/selection',
          title: 'chosen work',
          fields: { query: { selector: { kind: 'exact', types: [shippedTypeId(NOW, 'task')] }, sort } },
        });
        const memo = yield* graph.blocks.create({
          projectId,
          tags: ['tag'],
          title: '#memo',
          fields: { id: 'memo', extends: 'explanation', fields: { about: { type: 'ref', tag: 'explanation' } } },
        });
        const memoFields = (yield* graph.blocks.blockById(memo.id)).fields;
        const deferredQuery = { tags: [shippedTypeId(NOW, 'task')], sort };
        const proposal = yield* graph.blocks.create({
          projectId,
          contract: 'core/amendment',
          amendsId: work.id,
          title: 'deferred views',
          fields: {
            ops: [
              { op: 'create', tags: [shippedTypeId(CORE_LIBRARY, 'view')], title: 'deferred view', fields: { query: deferredQuery } },
              {
                op: 'update',
                id: yield* demo.nameOf(sightings.id),
                fields: { [fieldIdOf(shippedTypeId(CORE_LIBRARY, 'view'), 'query')]: deferredQuery },
              },
            ],
          },
        });
        const deferred = (yield* graph.blocks.blockById(proposal.id)).fields;
        const own = yield* graph.blocks.blockById(work.id);
        for (const row of yield* db.select().from(block).where(eq(block.projectId, projectId))) {
          const vocabulary = row.tags.includes('tag') || row.tags.includes('catalog');
          const fields = older(row.fields, !vocabulary);
          let title = row.title;
          let body = row.body;
          if (row.tags.includes('catalog') && fields.id === NOW) {
            const release = fields.release as Raw;
            fields.id = WAS;
            title = WAS;
            fields.release = {
              ...release,
              revision: 'earlier',
              tags: (release.tags as Raw[]).map((tag) => (tag.id === 'explanation' ? { ...tag, id: 'note', prompt: EARLIER } : tag)),
            };
          }
          if (row.tags.includes('catalog') && fields.id === CORE_LIBRARY) {
            fields.release = {
              ...(fields.release as Raw),
              transfers: MOVED.map((one) => ({ export: one, was: { library: WAS, export: one } })),
            };
          }
          if (row.tags.includes('tag') && (fields.id === 'note' || fields.id === 'explanation')) {
            fields.id = olderKey(fields.id);
            title = `#${fields.id}`;
            if (fields.id === 'note') body = EARLIER;
          }
          yield* db
            .update(block)
            .set({ fields, title, body, tags: vocabulary ? row.tags : row.tags.map(olderKey) })
            .where(eq(block.id, row.id));
        }
        const standing = yield* db.select().from(block).where(eq(block.projectId, projectId));
        const listed = (id: string) => standing.find((row) => row.tags.includes('catalog') && row.fields.id === id);
        const core = listed(CORE_LIBRARY);
        const was = listed(WAS);
        const view = standing.find((row) => row.tags.includes('tag') && row.fields.id === 'view');
        if (core === undefined || was === undefined || view === undefined) return yield* Effect.die('the fixture installs no #view');
        const coreRelease = core.fields.release as Raw;
        const wasRelease = was.fields.release as Raw;
        const viewBase = { ...(coreRelease.tags as Raw[]).find((tag) => tag.id === 'view'), prompt: EARLIER_VIEW };
        const viewMember = (core.fields.tags as string[]).find((name) => view.uuid.replaceAll('-', '').endsWith(name));
        if (viewMember === undefined) return yield* Effect.die('the core library lists no #view');
        yield* db
          .update(block)
          .set({
            fields: {
              ...core.fields,
              tags: (core.fields.tags as string[]).filter((name) => name !== viewMember),
              release: { ...coreRelease, tags: (coreRelease.tags as Raw[]).filter((tag) => tag.id !== 'view') },
            },
          })
          .where(eq(block.id, core.id));
        yield* db
          .update(block)
          .set({
            fields: {
              ...was.fields,
              tags: [...(was.fields.tags as string[]), viewMember],
              release: { ...wasRelease, tags: [...(wasRelease.tags as Raw[]), viewBase] },
            },
          })
          .where(eq(block.id, was.id));
        const { identity: _recorded, ...unrecorded } = view.fields;
        yield* db.update(block).set({ body: EARLIER_VIEW, fields: unrecorded }).where(eq(block.id, view.id));
        const mine = standing.map((row) => row.id);
        for (const row of yield* db.select().from(blockTag).where(inArray(blockTag.blockId, mine))) {
          yield* db
            .update(blockTag)
            .set({ tag: olderKey(row.tag), typeId: row.typeId === null ? null : olderText(row.typeId, true) })
            .where(and(eq(blockTag.blockId, row.blockId), eq(blockTag.tag, row.tag)));
        }
        yield* graph.tags.forget(projectId);
        const earlier = yield* demo.table();
        expect(earlier.identities.typeOf('note')?.id).toBe(shippedTypeId(WAS, 'note'));
        expect(earlier.identities.typeOf('view')?.id).toBe(shippedTypeId(WAS, 'view'));
        expect(earlier.identities.typeOf('notes.note')?.id).toBe(shippedTypeId('notes', 'note'));
        const selected = (id: number) =>
          Effect.map(graph.reading.show(id, 0), (page) => (page.results?.items ?? []).map((row) => row.name));
        expect(yield* selected(work.id)).toEqual([yield* demo.nameOf(task.id)]);

        const project = yield* graph.projects.byId(projectId);
        yield* softwareDevelopmentNames(project);
        const once = yield* db.select().from(block).where(eq(block.projectId, projectId)).orderBy(block.id);
        yield* softwareDevelopmentNames(project);
        expect(yield* db.select().from(block).where(eq(block.projectId, projectId)).orderBy(block.id)).toEqual(once);

        const table = yield* demo.table();
        expect(table.unreadable).toEqual([]);
        expect(table.identities.typeOf('explanation')?.id).toBe(shippedTypeId(NOW, 'explanation'));
        expect(table.identities.typeOf('note')?.id).toBe(shippedTypeId('notes', 'note'));
        expect(table.identities.typeOf('view')?.id).toBe(shippedTypeId(CORE_LIBRARY, 'view'));
        expect(table.identities.fieldIdOf('view', 'query')).toBe(fieldIdOf(shippedTypeId(CORE_LIBRARY, 'view'), 'query'));
        const carrier = yield* graph.blocks.blockById(explained.id);
        expect(carrier.tags).toEqual(['explanation']);
        expect(table.supports(carrier, EXPLANATION)).toBe(true);
        expect((yield* graph.blocks.blockById(noted.id)).tags).toEqual(['note']);
        expect(
          yield* db.select({ tag: blockTag.tag, typeId: blockTag.typeId }).from(blockTag).where(eq(blockTag.blockId, explained.id)),
        ).toEqual([{ tag: 'explanation', typeId: shippedTypeId(NOW, 'explanation') }]);
        expect((yield* graph.blocks.blockById(work.id)).fields).toEqual(own.fields);
        expect((yield* graph.blocks.blockById(proposal.id)).fields).toEqual(deferred);
        expect(yield* selected(chosen.id)).toEqual([yield* demo.nameOf(task.id)]);
        expect((yield* graph.blocks.blockById(memo.id)).fields).toEqual(memoFields);
        expect(table.tagById('memo')?.extends).toBe('explanation');
        expect(yield* selected(work.id)).toEqual([yield* demo.nameOf(task.id)]);
        expect(yield* selected(sightings.id)).toEqual([yield* demo.nameOf(reflection.id)]);
        const listings = once.filter((row) => row.tags.includes('catalog'));
        expect(listings.map((row) => [row.fields.id, row.title]).sort()).toEqual([CORE_LIBRARY, NOW, 'notes'].map((id) => [id, id]).sort());
        expect(listings.find((row) => row.fields.id === CORE_LIBRARY)?.fields.release).not.toHaveProperty('transfers');

        yield* ensureVocabulary('machine');
        const installed = yield* demo.table();
        expect(yield* (yield* InstalledCatalogs).findings(projectId)).toEqual([]);
        expect(installed.tagById('explanation')).toEqual(new TagIndex(softwareDevelopment.tags, BEHAVIOUR_REGISTRY).tagById('explanation'));
        expect(installed.tagById('view')).toEqual(new TagIndex(coreLibrary.tags, BEHAVIOUR_REGISTRY).tagById('view'));
        expect(yield* graph.blocks.blockById(explained.id)).toEqual(carrier);
      }),
    ),
  );
});
