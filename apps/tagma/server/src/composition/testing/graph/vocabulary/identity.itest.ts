import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Context, Effect, Schema } from 'effect';
import { eq } from 'drizzle-orm';
import { demoGraphLayer, withDemo } from '../../graphFixture.js';
import { SHIPPED_CATALOGS } from '../../settings.js';
import { block, blockTag } from '../../../../graph/store/tables.js';
import { Blocks } from '../../../../graph/contract/service/blocks.js';
import { BlockNames } from '../../../../graph/contract/service/acts.js';
import { InstalledCatalogs } from '../../../../graph/contract/service/vocabulary.js';
import { Catalogs } from '../../../../graph/contract/wire/catalogs.js';
import { blockQuerySchema } from '../../../../graph/contract/wire/query.js';
import { tagIdentitySchema, shippedTypeId } from '../../../../graph/contract/wire/tags/identity.js';
import type { Catalog, Tag } from '../../../../graph/contract/wire/tags/declaration.js';
import { catalogWriter } from '../../../../graph/vocabulary/install.js';
import { tagLabel } from '../../../../graph/contract/wire/tags/roles.js';
import { payloadLines } from '../../../../graph/voice/blockPage.js';
import { wireRead } from '../../../../graph/reading/rows.js';

const declarationOf = Effect.fnUntraced(function* (projectId: number, key: string) {
  const catalogs = yield* (yield* InstalledCatalogs).read(projectId);
  const { idOfName } = yield* BlockNames;
  const { blockById } = yield* Blocks;
  for (const catalog of catalogs) {
    if (catalog.release === undefined || !catalog.release.tags.some((tag) => tag.id === key)) continue;
    for (const name of catalog.tags) {
      const node = yield* blockById(yield* idOfName(name));
      if (node.fields.id === key) return { catalog: { ...catalog, release: catalog.release }, node };
    }
  }
  return yield* Effect.die(`#${key} has no installed declaration`);
});

layer(demoGraphLayer(), { excludeTestServices: true })('type identities', (it) => {
  it.effect('a rename preserves permanent keys, carriers and saved references while new writes and filtered queries use the new name', () =>
    withDemo(({ graph, projectId, table, refusal }) =>
      Effect.gen(function* () {
        const { catalog, node } = yield* declarationOf(projectId, 'task');
        const id = shippedTypeId(catalog.id, 'task');
        const identity = (yield* table()).identities.typeOf('task');
        expect(identity?.id).toBe(id);
        expect(identity?.shipped).toEqual({ library: catalog.id, export: 'task', version: catalog.release.revision });
        const carrier = yield* graph.blocks.create({ projectId, tags: [id], title: 'standing' });
        const before = yield* graph.blocks.blockById(carrier.id);
        expect(before.tags).toEqual(['task']);
        const indexed = () =>
          graph.graphStore.db.select({ tag: blockTag.tag, typeId: blockTag.typeId }).from(blockTag).where(eq(blockTag.blockId, carrier.id));
        expect(yield* indexed()).toEqual([{ tag: 'task', typeId: id }]);
        const query = { tags: [id], fields: { status: 'open' }, sort: { by: 'created' as const, order: 'asc' as const } };
        const view = yield* graph.blocks.create({ projectId, tags: ['view'], title: 'all work', fields: { query } });
        expect((yield* graph.blocks.blockById(view.id)).fields.query).toEqual(query);
        yield* graph.blocks.update({ id: view.id, fields: { query: { ...query, tags: ['task'] } } });
        const bug = yield* graph.blocks.create({ projectId, tags: ['tag'], title: '#bug', fields: { id: 'bug', extends: 'task' } });
        expect((yield* graph.blocks.blockById(view.id)).fields.query).toEqual(query);
        expect((yield* graph.blocks.blockById(bug.id)).fields.extends).toBe(id);
        yield* graph.blocks.update({ id: node.id, fields: { identity: { name: 'chore' } } });
        const renamed = yield* table();
        expect(renamed.identities.keyOf('chore')).toBe('task');
        expect(renamed.identities.typeOf('chore')?.id).toBe(id);
        expect(yield* indexed()).toEqual([{ tag: 'task', typeId: id }]);
        expect(yield* graph.blocks.blockById(carrier.id)).toEqual(before);
        const born = yield* graph.blocks.create({ projectId, tags: ['chore'], title: 'named' });
        expect((yield* graph.blocks.blockById(born.id)).tags).toEqual(['task']);
        expect(tagLabel(renamed.tagById('task'))).toBe('#chore');
        expect(renamed.nameOf(id)).toBe('chore');
        const stored = yield* Schema.decodeUnknownEffect(blockQuerySchema)((yield* graph.blocks.blockById(view.id)).fields.query);
        expect((yield* graph.selection.rows(stored, projectId)).map((row) => row.uuid)).toEqual([carrier.uuid, born.uuid]);
        expect(renamed.tagById('bug')?.extends).toBe('task');
        const catalogId = yield* graph.blockNames.idOfName(catalog.name);
        expect((yield* refusal(graph.blocks.update({ id: catalogId, fields: { id: 'renamed' } }))).code).toBe('operation-only');
        expect((yield* refusal(graph.blocks.update({ id: catalogId, fields: { tags: catalog.tags.slice(1) } }))).code).toBe(
          'operation-only',
        );
        expect((yield* table()).identities.typeOf('task')?.id).toBe(id);
      }),
    ),
  );

  it.effect('an unreadable stored identity refuses a rewrite and preserves its shipped provenance unseen', () =>
    withDemo(({ graph, projectId, refusal }) =>
      Effect.gen(function* () {
        const { node } = yield* declarationOf(projectId, 'task');
        yield* graph.graphStore.db
          .update(block)
          .set({ fields: { ...node.fields, identity: { shipped: 'not provenance' } } })
          .where(eq(block.id, node.id));
        const before = yield* graph.blocks.blockById(node.id);
        expect((yield* refusal(graph.blocks.update({ id: node.id, fields: { identity: { name: 'chore' } } }))).code).toBe('field-invalid');
        expect(yield* graph.blocks.blockById(node.id)).toEqual(before);
      }),
    ),
  );

  it.effect('same-name exports keep distinct keys and carriers, and foreign references bind to their own library', () =>
    withDemo(({ graph, projectId, table, context }) =>
      Effect.gen(function* () {
        const task: Tag = { id: 'task', fields: {}, edges: [], gates: [], roles: {}, body: { shape: 'content' }, prompt: '' };
        const subtask: Tag = { ...task, id: 'subtask', extends: 'task', fields: { parent: { type: 'ref', tag: 'task' } } };
        const other: Catalog = { id: 'other', guidance: '', tags: [task, subtask] };
        const both = Catalogs.of({ ...SHIPPED_CATALOGS, byId: (id) => (id === other.id ? other : SHIPPED_CATALOGS.byId(id)) });
        const ours = (yield* table()).identities.typeOf('task');
        if (ours === null) return yield* Effect.die('#task is not installed');
        yield* (yield* catalogWriter(Context.add(context, Catalogs, both), projectId))(['software-development', other.id]);
        const installed = yield* table();
        const theirs = installed.identities.typeOf(shippedTypeId(other.id, 'task'));
        expect(installed.identities.typeOf(ours.id)?.key).toBe('task');
        expect(theirs?.key).toBe('other.task');
        expect(theirs?.id).not.toBe(ours.id);
        expect(installed.tagById('subtask')?.extends).toBe('other.task');
        expect(installed.tagById('subtask')?.fields.parent).toEqual({ type: 'ref', tag: shippedTypeId(other.id, 'task') });
        const mine = yield* graph.blocks.create({ projectId, tags: ['task'], title: 'mine' });
        const foreign = yield* graph.blocks.create({ projectId, tags: [shippedTypeId(other.id, 'task')], title: 'theirs' });
        expect((yield* graph.blocks.blockById(mine.id)).tags).toEqual(['task']);
        expect((yield* graph.blocks.blockById(foreign.id)).tags).toEqual(['other.task']);
        const selected = yield* graph.selection.rows(
          { tags: [shippedTypeId(other.id, 'task')], sort: { by: 'created', order: 'asc' } },
          projectId,
        );
        expect(selected.map((row) => row.uuid)).toEqual([foreign.uuid]);
      }),
    ),
  );

  it.effect('one installation assigns distinct keys to same-name exports and keeps their references inside each library', () =>
    withDemo(({ graph, fixture, table, context }) =>
      Effect.gen(function* () {
        const rootPath = yield* fixture.directory('joint-catalogs');
        const project = yield* graph.projectLifecycle.create({ name: 'joint-catalogs', rootPath, catalogs: [] });
        const person: Tag = { id: 'person', fields: {}, edges: [], gates: [], roles: {}, body: { shape: 'content' }, prompt: '' };
        const contact: Tag = { ...person, id: 'contact', extends: 'person', fields: { parent: { type: 'ref', tag: 'person' } } };
        const other: Catalog = { id: 'other', guidance: '', tags: [person, contact] };
        const both = Catalogs.of({
          ...SHIPPED_CATALOGS,
          all: [...SHIPPED_CATALOGS.all, other],
          byId: (id) => (id === other.id ? other : SHIPPED_CATALOGS.byId(id)),
        });
        yield* (yield* catalogWriter(Context.add(context, Catalogs, both), project.id))(['knowledge', other.id]);
        const installed = yield* table(project.id);
        expect(installed.identities.typeOf(shippedTypeId('knowledge', 'person'))?.key).toBe('person');
        expect(installed.identities.typeOf(shippedTypeId(other.id, 'person'))?.key).toBe('other.person');
        expect(installed.tagById('contact')?.extends).toBe('other.person');
        expect(installed.tagById('contact')?.fields.parent).toEqual({ type: 'ref', tag: shippedTypeId(other.id, 'person') });
        const mine = yield* graph.blocks.create({ projectId: project.id, tags: [shippedTypeId('knowledge', 'person')], title: 'mine' });
        const theirs = yield* graph.blocks.create({ projectId: project.id, tags: [shippedTypeId(other.id, 'person')], title: 'theirs' });
        expect(mine.tags).toEqual(['person']);
        expect(theirs.tags).toEqual(['other.person']);
        const updated: Catalog = { ...other, tags: [person, { ...contact, fields: { ...contact.fields, due: 'date' } }] };
        const revised = Catalogs.of({
          ...both,
          all: [...SHIPPED_CATALOGS.all, updated],
          byId: (id) => (id === updated.id ? updated : SHIPPED_CATALOGS.byId(id)),
        });
        yield* (yield* catalogWriter(Context.add(context, Catalogs, revised), project.id))(['knowledge', updated.id]);
        expect((yield* table(project.id)).tagById('contact')?.fields.due).toBe('date');
      }),
    ),
  );

  it.effect('one catalog cannot export the same permanent type twice and a refused installation keeps its standing catalogs', () =>
    withDemo(({ graph, projectId, table, context, refusal }) =>
      Effect.gen(function* () {
        const note: Tag = { id: 'note', fields: {}, edges: [], gates: [], roles: {}, body: { shape: 'content' }, prompt: '' };
        const broken: Catalog = { id: 'broken', guidance: '', tags: [note, note] };
        const shipped = Catalogs.of({
          ...SHIPPED_CATALOGS,
          all: [...SHIPPED_CATALOGS.all, broken],
          byId: (id) => (id === broken.id ? broken : SHIPPED_CATALOGS.byId(id)),
        });
        const before = (yield* table()).revision();
        const writer = yield* catalogWriter(Context.add(context, Catalogs, shipped), projectId);
        expect((yield* refusal(writer(['software-development', broken.id]))).code).toBe('field-invalid');
        expect((yield* table()).revision()).toEqual(before);
      }),
    ),
  );

  it.effect('field aliases preserve stored keys and identities, name reads and filters, and refuse an ambiguous selection', () =>
    withDemo(({ graph, projectId, table, refusal }) =>
      Effect.gen(function* () {
        const { node } = yield* declarationOf(projectId, 'view');
        const query = { sort: { by: 'created' as const, order: 'asc' as const } };
        const carrier = yield* graph.blocks.create({ projectId, tags: ['view'], title: 'saved before', fields: { query } });
        const before = yield* graph.blocks.blockById(carrier.id);
        const fieldId = (yield* table()).identities.fieldIdOf('view', 'query');
        const identity = yield* Schema.decodeUnknownEffect(tagIdentitySchema)(node.fields.identity);
        yield* graph.blocks.update({ id: node.id, fields: { identity: { ...identity, fields: { query: 'selection' } } } });
        const renamed = yield* table();
        expect(yield* graph.blocks.blockById(carrier.id)).toEqual(before);
        expect(renamed.identities.fieldIdOf('view', 'query')).toBe(fieldId);
        expect(renamed.fieldNameOf('view', 'query')).toBe('selection');
        const born = yield* graph.blocks.create({ projectId, tags: ['view'], title: 'saved after', fields: { selection: query } });
        expect((yield* graph.blocks.blockById(born.id)).fields.query).toEqual(query);
        const shown = payloadLines(renamed, wireRead(yield* graph.reading.show(born.id, 0))).join('\n');
        expect(shown).toContain('selection');
        expect(shown).not.toContain('query');
        const { node: rule } = yield* declarationOf(projectId, 'rule');
        const law = renamed.lawProjectionOf('rule');
        const switchKey = law?.enabled.field;
        if (switchKey === undefined) return yield* Effect.die('#rule carries no law');
        const ruleIdentity = yield* Schema.decodeUnknownEffect(tagIdentitySchema)(rule.fields.identity);
        yield* graph.blocks.update({ id: rule.id, fields: { identity: { ...ruleIdentity, fields: { [switchKey]: 'active' } } } });
        expect((yield* table()).lawProjectionOf('rule')).toEqual(law);
        const { node: task } = yield* declarationOf(projectId, 'task');
        const taskIdentity = yield* Schema.decodeUnknownEffect(tagIdentitySchema)(task.fields.identity);
        yield* graph.blocks.update({ id: task.id, fields: { identity: { ...taskIdentity, fields: { status: 'selection' } } } });
        expect(
          (yield* refusal(graph.selection.queryPage(projectId, { tags: ['view', 'task'], fields: { selection: 'x' }, sort: query.sort })))
            .code,
        ).toBe('query-shape');
      }),
    ),
  );
});
