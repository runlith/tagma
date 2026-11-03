import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { eq } from 'drizzle-orm';
import { Effect } from 'effect';
import { knowledge } from '../../../../catalogs/contract/wire/knowledge.js';
import { InstalledCatalogs } from '../../../../graph/contract/service/vocabulary.js';
import { blockName } from '../../../../graph/contract/wire/references.js';
import { fieldIdOf, localTypeId, shippedTypeId } from '../../../../graph/contract/wire/tags/identity.js';
import { ensureVocabulary } from '../../../../graph/serving/birth.js';
import { block } from '../../../../graph/store/tables.js';
import { knowledgeNames } from '../../../../graph/steps/knowledgeNames.js';
import { demoGraphLayer, withDemo } from '../../graphFixture.js';
import { SHIPPED_CATALOGS } from '../../settings.js';
import { installNotes } from './notesFixture.js';

const oldType = (id: string) => shippedTypeId('notes', id);
const newType = (id: string) => shippedTypeId(knowledge.id, id);
const localType = (uuid: string) => localTypeId(uuid.replaceAll('-', '').toLowerCase());

layer(demoGraphLayer(), { excludeTestServices: true })('knowledge migration', (it) => {
  it.effect(
    'installed notes retain their addresses, records, local schema and deferred operations through migration and installation',
    () =>
      withDemo((demo) =>
        Effect.gen(function* () {
          const { graph, projectId, root } = demo;
          const { db } = graph.graphStore;
          yield* installNotes(projectId);
          const rows = yield* db.select().from(block).where(eq(block.projectId, projectId));
          const declared = (key: string) => {
            const row = rows.find((row) => row.tags.includes('tag') && row.fields.id === key);
            if (row === undefined) throw new Error(`the fixture declares no ${key}`);
            return row;
          };
          const personType = declared('person');
          const meetingType = declared('meeting');
          const noteType = declared('note');
          const recipeType = declared('recipe');
          const catalog = rows.find((row) => row.tags.includes('catalog') && row.fields.id === 'notes');
          if (catalog === undefined) return yield* Effect.die('the fixture installs no notes catalog');
          const append = [{ section: 'project', edit: 'append', text: 'project context', over: 'older' }] as const;
          yield* graph.blocks.update({
            id: personType.id,
            fields: {
              identity: { name: 'human' },
              fields: { nickname: 'string' },
              layer: { type: oldType('person'), edits: append },
            },
          });
          yield* graph.blocks.update({ id: meetingType.id, fields: { fork: { library: 'notes', export: 'meeting', at: 'older' } } });
          yield* graph.blocks.update({
            id: noteType.id,
            fields: {
              layer: {
                type: oldType('note'),
                edits: [{ section: 'project', edit: 'append', text: 'local thought guidance', over: 'older' }],
              },
            },
          });
          yield* graph.blocks.update({ id: recipeType.id, fields: { fork: { library: 'notes', export: 'recipe', at: 'older' } } });
          yield* graph.blocks.update({ id: catalog.id, title: 'project knowledge' });
          yield* db
            .update(block)
            .set({
              fields: {
                ...catalog.fields,
                layer: {
                  type: 'notes',
                  edits: [{ section: 'project', edit: 'append', text: 'project catalog context', over: 'older' }],
                },
              },
            })
            .where(eq(block.id, catalog.id));
          const person = yield* graph.blocks.create({
            projectId,
            parentId: root,
            tags: ['person'],
            title: 'Ada',
            fields: { nickname: 'A' },
          });
          const personName = yield* demo.nameOf(person.id);
          const meeting = yield* graph.blocks.create({
            projectId,
            parentId: root,
            tags: ['meeting'],
            title: 'planning',
            fields: { held: '2026-10-20', attendees: [personName] },
          });
          const note = yield* graph.blocks.create({
            projectId,
            tags: ['note'],
            title: 'a thought',
            parentId: meeting.id,
            body: `Ask [[${personName}]]`,
            edges: [{ kind: 'relates', to: person.id }],
          });
          const recipe = yield* graph.blocks.create({ projectId, parentId: root, tags: ['recipe'], title: 'a method', body: 'one step' });
          const memo = yield* graph.blocks.create({
            projectId,
            parentId: root,
            tags: ['tag'],
            title: '#memo',
            fields: {
              id: 'memo',
              extends: oldType('note'),
              fields: {
                author: { type: 'ref', tag: oldType('person') },
                method: { type: 'ref', tag: oldType('recipe') },
                literal: 'string',
              },
              edges: [{ kind: 'relates', to: [oldType('person')] }],
            },
          });
          const memoRecord = yield* graph.blocks.create({
            projectId,
            parentId: root,
            tags: ['memo'],
            title: 'linked thought',
            fields: { author: personName, method: yield* demo.nameOf(recipe.id), literal: oldType('person') },
          });
          const sort = { by: 'created', order: 'asc' } as const;
          const selection = yield* graph.blocks.create({
            projectId,
            parentId: root,
            contract: 'core/selection',
            title: 'dated meetings',
            fields: { query: { tags: [oldType('meeting')], fields: { [fieldIdOf(oldType('meeting'), 'held')]: '2026-10-20' }, sort } },
          });
          const notes = yield* graph.blocks.create({
            projectId,
            parentId: root,
            contract: 'core/selection',
            title: 'thoughts',
            fields: { query: { selector: { kind: 'descendants', types: [oldType('note')] }, sort } },
          });
          const project = yield* graph.projects.byId(projectId);
          yield* knowledgeNames(project);
          const localCatalog = yield* graph.blocks.create({
            projectId,
            parentId: root,
            tags: ['catalog'],
            title: 'project notes',
            fields: { id: 'notes', tags: [] },
          });
          const once = yield* db.select().from(block).where(eq(block.projectId, projectId)).orderBy(block.id);
          yield* knowledgeNames(project);
          expect(yield* db.select().from(block).where(eq(block.projectId, projectId)).orderBy(block.id)).toEqual(once);
          yield* graph.settings.write({ scope: 'project', projectId, key: SHIPPED_CATALOGS.key.id, value: [knowledge.id] });
          yield* ensureVocabulary('machine');

          const table = yield* demo.table();
          expect(table.unreadable).toEqual([]);
          expect(table.identities.typeOf('human')?.id).toBe(newType('person'));
          expect(table.identities.typeOf('meeting')?.id).toBe(newType('meeting'));
          expect(table.identities.typeOf('note')?.id).toBe(localType(noteType.uuid));
          expect(table.identities.typeOf('recipe')?.id).toBe(localType(recipeType.uuid));
          for (const row of [personType, meetingType, noteType, recipeType])
            expect((yield* graph.blocks.blockById(row.id)).uuid).toBe(row.uuid);
          expect((yield* graph.blocks.blockById(personType.id)).fields.layer).toEqual({ type: newType('person'), edits: append });
          expect((yield* graph.blocks.blockById(meetingType.id)).fields.fork).toEqual({
            library: knowledge.id,
            export: 'meeting',
            at: 'older',
          });
          expect((yield* graph.blocks.blockById(localCatalog.id)).fields.id).toBe('notes');
          expect((yield* graph.blocks.blockById(person.id)).fields).toEqual({ nickname: 'A' });
          expect((yield* graph.blocks.blockById(meeting.id)).fields).toEqual({ held: '2026-10-20', attendees: [personName] });
          expect((yield* graph.blocks.blockById(note.id)).parentId).toBe(meeting.id);
          const page = yield* graph.reading.show(note.id, 0);
          expect(page.edgesOut.map((edge) => edge.toId)).toEqual([person.id]);
          expect(page.refsOutDetails.map((ref) => ref.name)).toEqual([personName]);
          const selected = (id: number) =>
            Effect.map(graph.reading.show(id, 0), (page) => (page.results?.items ?? []).map((row) => row.name));
          expect(yield* selected(selection.id)).toEqual([yield* demo.nameOf(meeting.id)]);
          expect(yield* selected(notes.id)).toEqual([yield* demo.nameOf(note.id), yield* demo.nameOf(memoRecord.id)]);
          const memoFields = (yield* graph.blocks.blockById(memo.id)).fields;
          expect(memoFields.extends).toBe(localType(noteType.uuid));
          expect(memoFields.fields).toEqual({
            author: { type: 'ref', tag: newType('person') },
            method: { type: 'ref', tag: localType(recipeType.uuid) },
            literal: 'string',
          });
          expect((yield* graph.blocks.blockById(memoRecord.id)).fields.literal).toBe(oldType('person'));
          const installed = (yield* (yield* InstalledCatalogs).read(projectId)).find((row) => row.id === knowledge.id);
          expect(installed?.name).toBe(blockName(catalog.uuid));
          expect((yield* graph.blocks.blockById(catalog.id)).title).toBe('project knowledge');
          expect(installed?.release?.tags.map((tag) => tag.id)).toEqual(knowledge.tags.map((tag) => tag.id));
          expect(installed?.tags).toEqual(expect.arrayContaining([blockName(personType.uuid), blockName(meetingType.uuid)]));
          expect(installed?.tags).toHaveLength(knowledge.tags.length);

          yield* graph.blocks.update({ id: noteType.id, fields: { fields: { topic: 'string' } } });
          yield* graph.blocks.update({ id: note.id, body: 'changed thought', fields: { topic: 'migration' } });
          yield* graph.blocks.edit({ id: recipe.id, old: 'one', new: 'two' });
          expect((yield* graph.blocks.blockById(note.id)).fields).toEqual({ topic: 'migration' });
          expect((yield* graph.blocks.blockById(recipe.id)).body).toBe('two step');
          yield* graph.blocks.create({
            projectId,
            parentId: meeting.id,
            tags: [newType('meeting')],
            title: 'follow-up',
            fields: { [fieldIdOf(newType('meeting'), 'held')]: '2026-10-21', attendees: [personName] },
          });
          yield* graph.blocks.create({
            projectId,
            parentId: meeting.id,
            tags: [localType(noteType.uuid)],
            title: 'follow-up thought',
            body: 'still editable',
          });
          const children = yield* graph.blocks.childrenOf(meeting.id);
          const followup = children.find((row) => row.title === 'follow-up');
          const thought = children.find((row) => row.title === 'follow-up thought');
          expect(followup?.fields).toEqual({ held: '2026-10-21', attendees: [personName] });
          expect(thought?.tags).toEqual(['note']);
          expect(
            (yield* graph.blocks.create({ projectId, parentId: root, tags: ['person'], title: 'Grace', fields: { nickname: 'G' } })).fields,
          ).toEqual({
            nickname: 'G',
          });
        }),
      ),
  );
});
