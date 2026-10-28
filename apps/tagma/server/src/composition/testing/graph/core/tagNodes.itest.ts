import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Effect, Layer } from 'effect';
import { eq } from 'drizzle-orm';
import { Blocks } from '../../../../graph/contract/service/blocks.js';
import { block } from '../../../../graph/store/tables.js';
import { demoGraphLayer, withDemo } from '../../graphFixture.js';
import { SHIPPED_CATALOGS } from '../../settings.js';

const declare = (projectId: number, id: string, fields: Record<string, unknown>) =>
  Effect.flatMap(Blocks, ({ create, rootBlockOf }) =>
    Effect.flatMap(rootBlockOf(projectId), (root) =>
      create({ projectId, parentId: root.id, tags: ['tag'], title: `#${id}`, fields: { id, ...fields } }),
    ),
  );

layer(demoGraphLayer().pipe(Layer.provideMerge(BunFileSystem.layer)), { excludeTestServices: true })('tag nodes', (it) => {
  it.effect('a declaration checks the next write, stops declaring in the trash and declares again after restoration', () =>
    withDemo(({ graph, projectId, root, refusal, table }) =>
      Effect.gen(function* () {
        const declaration = yield* declare(projectId, 'invoice', { fields: { total: 'number' } });
        const invalid = yield* refusal(
          graph.blocks.create({ projectId, parentId: root, tags: ['invoice'], title: 'March', fields: { total: 'x' } }),
        );
        expect(invalid.code).toBe('field-invalid');
        expect(invalid.reason).toContain('invoice.total');
        const first = yield* graph.blocks.create({ projectId, parentId: root, tags: ['invoice'], title: 'March', fields: { total: 1200 } });
        expect((yield* graph.blocks.blockById(first.id)).fields.total).toBe(1200);
        const before = yield* graph.blocks.blockById(first.id);
        yield* graph.trash.delete({ id: declaration.id });
        expect((yield* refusal(graph.blocks.create({ projectId, parentId: root, tags: ['invoice'], title: 'April' }))).code).toBe(
          'tag-undeclared',
        );
        expect((yield* table()).tagById('invoice')).toBeNull();
        yield* graph.trash.restore({ id: declaration.id });
        const second = yield* graph.blocks.create({ projectId, parentId: root, tags: ['invoice'], title: 'April', fields: { total: 2 } });
        expect(second.fields.total).toBe(2);
        expect(yield* graph.blocks.blockById(first.id)).toEqual(before);
      }),
    ),
  );

  it.effect('incoherent work and lifecycle declarations refuse before they become types', () =>
    withDemo(({ projectId, refusal, table }) =>
      Effect.gen(function* () {
        const declarations = [
          { id: 'wish', named: 'status', fields: { state: { type: 'enum', values: ['open', 'done'] } }, roles: { work: true } },
          {
            id: 'shipment',
            named: 'closed',
            fields: { state: { type: 'enum', values: ['open', 'review', 'shipped'] } },
            roles: { status: { field: 'state', initial: 'open', done: 'shipped' }, work: true },
            gates: [
              { gate: 'transition', field: 'state', from: 'open', to: 'review' },
              { gate: 'transition', field: 'state', from: 'review', to: 'shipped' },
            ],
          },
          {
            id: 'errand',
            named: 'review',
            fields: { state: { type: 'enum', values: ['open', 'review', 'shipped', 'dropped'] } },
            roles: { status: { field: 'state', initial: 'open', done: 'review', closed: 'dropped' }, work: true },
            gates: [
              { gate: 'transition', field: 'state', from: 'open', to: 'review' },
              { gate: 'transition', field: 'state', from: 'review', to: 'shipped' },
              { gate: 'transition', field: 'state', from: 'open', to: 'dropped' },
            ],
          },
          {
            id: 'chore',
            named: 'abandoned',
            fields: { state: { type: 'enum', values: ['open', 'done'] } },
            roles: { status: { field: 'state', initial: 'open', done: 'done', closed: 'abandoned' } },
            gates: [{ gate: 'transition', field: 'state', from: 'open', to: 'done' }],
          },
        ];
        const before = (yield* table()).declaredTags();
        for (const { id, named, ...fields } of declarations) {
          const refused = yield* refusal(declare(projectId, id, fields));
          expect(refused.code).toBe('tag-incoherent');
          expect(refused.reason).toContain(named);
        }
        expect((yield* table()).declaredTags()).toEqual(before);
      }),
    ),
  );

  it.effect('catalog settings select a new project vocabulary and install additional types into a standing project', () =>
    withDemo(({ graph, projectId, root: demoBlock, fixture, refusal }) =>
      Effect.gen(function* () {
        expect(
          (yield* refusal(graph.blocks.create({ projectId, parentId: demoBlock, tags: ['decision'], title: 'Use sourdough' }))).code,
        ).toBe('tag-undeclared');
        yield* graph.settings.write({ scope: 'user', key: SHIPPED_CATALOGS.key.id, value: ['knowledge'] });
        const root = yield* fixture.directory('notebook');
        const notebook = yield* graph.projectLifecycle.create({ name: 'notebook', rootPath: root });
        const notebookRoot = (yield* graph.blocks.rootBlockOf(notebook.id)).id;
        expect(yield* graph.settings.value(SHIPPED_CATALOGS.key, notebook.id)).toEqual(['knowledge']);
        const refused = yield* refusal(
          graph.blocks.create({ projectId: notebook.id, parentId: notebookRoot, tags: ['task'], title: 'do it' }),
        );
        expect(refused.code).toBe('tag-undeclared');
        expect(refused.unblock.join(' ')).toContain('software-development');
        expect(refused.unblock.join(' ')).toContain(SHIPPED_CATALOGS.key.id);
        expect((yield* graph.blocks.create({ projectId: notebook.id, parentId: notebookRoot, title: 'a thought' })).tags).toEqual([]);
        yield* graph.settings.write({
          scope: 'project',
          projectId,
          key: SHIPPED_CATALOGS.key.id,
          value: ['software-development', 'knowledge'],
        });
        expect((yield* graph.blocks.create({ projectId, parentId: demoBlock, tags: ['decision'], title: 'Use sourdough' })).tags).toEqual([
          'decision',
        ]);
        expect((yield* graph.blocks.create({ projectId, parentId: demoBlock, tags: ['task'], title: 'bake it' })).fields.status).toBe(
          'open',
        );
      }),
    ),
  );

  it.effect('a spec with open child work refuses to close until the child finishes', () =>
    withDemo(({ graph, projectId, root, refusal, table }) =>
      Effect.gen(function* () {
        const spec = yield* graph.blocks.create({ projectId, parentId: root, tags: ['spec'], title: 'the shape' });
        const child = yield* graph.blocks.create({
          projectId,
          tags: ['task'],
          title: 'build it',
          parentId: spec.id,
          edges: [{ kind: 'implements', to: spec.id }],
        });
        const before = yield* graph.blocks.blockById(spec.id);
        const refused = yield* refusal(graph.tasks.close({ id: spec.id }));
        expect(refused.code).toBe('open-children');
        expect(refused.reason).toContain('spec.open-children');
        expect(yield* graph.blocks.blockById(spec.id)).toEqual(before);
        yield* graph.tasks.claim({ id: child.id });
        yield* graph.tasks.finish({ id: child.id });
        yield* graph.tasks.close({ id: spec.id });
        expect((yield* table()).statusOf(yield* graph.blocks.blockById(spec.id))).toBe('closed');
      }),
    ),
  );

  it.effect('a leaf refuses children whether its type was shipped or declared locally', () =>
    withDemo(({ graph, projectId, root, refusal }) =>
      Effect.gen(function* () {
        yield* declare(projectId, 'dashboard', { roles: { leaf: true } });
        const view = yield* graph.blocks.create({
          projectId,
          parentId: root,
          tags: ['view'],
          title: 'open work',
          fields: { query: { tags: ['task'], sort: { by: 'updated', order: 'desc' } } },
        });
        const dashboard = yield* graph.blocks.create({ projectId, parentId: root, tags: ['dashboard'], title: 'this week' });
        for (const parent of [view, dashboard]) {
          expect(
            (yield* refusal(graph.blocks.create({ projectId, tags: ['idea'], title: 'under a leaf', parentId: parent.id }))).code,
          ).toBe('leaf');
          expect((yield* graph.reading.show(parent.id, 1)).children).toEqual([]);
        }
      }),
    ),
  );

  it.effect('declared status and holder fields drive search, queries and work operations while plain updates preserve the carrier', () =>
    withDemo(({ graph, projectId, root, table, refusal, as, nameOf }) =>
      Effect.gen(function* () {
        yield* declare(projectId, 'ticket', {
          fields: { state: { type: 'enum', values: ['filed', 'taken', 'shipped', 'dropped'] }, owner: 'session' },
          roles: {
            status: { field: 'state', initial: 'filed', claimed: 'taken', done: 'shipped', closed: 'dropped' },
            holder: 'owner',
            work: true,
          },
          gates: [
            { gate: 'transition', field: 'state', from: 'filed', to: 'taken' },
            { gate: 'transition', field: 'state', from: 'taken', to: 'shipped' },
            { gate: 'transition', field: 'state', from: 'taken', to: 'dropped' },
            { gate: 'transition', field: 'state', from: 'filed', to: 'dropped' },
          ],
        });
        const ticket = yield* graph.blocks.create({ projectId, parentId: root, tags: ['ticket'], title: 'the hinge' });
        const ordinary = yield* graph.blocks.create({ projectId, parentId: root, tags: ['task'], title: 'the hinge again' });
        const tags = yield* table();
        expect(tags.statusOf(ticket)).toBe('filed');
        for (const [status, node] of [
          ['filed', ticket],
          ['open', ordinary],
        ] as const) {
          const found = yield* graph.ranking.search({ query: 'hinge', projectId, status });
          expect(found.items.map((hit) => hit.name)).toEqual([yield* nameOf(node.id)]);
        }
        const selected = yield* graph.selection.rows({ roles: { status: ['filed'] }, sort: { by: 'created', order: 'asc' } }, projectId);
        expect(selected.map((row) => row.uuid)).toEqual([ticket.uuid]);
        expect((yield* graph.selection.ready({ projectId, among: [ticket.id] })).map((row) => row.uuid)).toEqual([ticket.uuid]);
        const before = yield* graph.blocks.blockById(ticket.id);
        for (const [word, verb] of [
          ['taken', 'claim_block'],
          ['shipped', 'finish_block'],
          ['dropped', 'close_block'],
        ] as const) {
          const refused = yield* refusal(graph.blocks.update({ id: ticket.id, status: word }));
          expect(refused.code).toBe('status-operation');
          expect(refused.unblock.join(' ')).toContain(verb);
        }
        expect(yield* graph.blocks.blockById(ticket.id)).toEqual(before);
        const taken = yield* as('holder', graph.tasks.claim({ id: ticket.id }));
        expect(taken.fields.state).toBe('taken');
        expect(tags.holderOf(taken)).not.toBeNull();
        const shipped = yield* as('holder', graph.tasks.finish({ id: ticket.id }));
        expect(shipped.fields.state).toBe('shipped');
        expect(tags.isTerminal(shipped)).toBe(true);
        expect(tags.holderOf(shipped)).toBe(tags.holderOf(taken));
        const other = yield* graph.blocks.create({ projectId, parentId: root, tags: ['ticket'], title: 'the door sticks' });
        expect((yield* graph.tasks.close({ id: other.id, reason: 'not ours' })).fields.state).toBe('dropped');
        expect((yield* graph.selection.ready({ projectId })).map((row) => row.uuid)).toEqual([ordinary.uuid]);
      }),
    ),
  );

  it.effect('a source-required gate refuses birth without the declared kind and records an accepted source', () =>
    withDemo(({ graph, projectId, root, refusal }) =>
      Effect.gen(function* () {
        yield* declare(projectId, 'territory', { sources: ['dir'], gates: [{ gate: 'source-required', kinds: ['dir'] }] });
        const refused = yield* refusal(graph.blocks.create({ projectId, parentId: root, tags: ['territory'], title: 'the server' }));
        expect(refused.code).toBe('source-required');
        expect(refused.reason).toContain('territory.source-required');
        const born = yield* graph.blocks.create({
          projectId,
          parentId: root,
          tags: ['territory'],
          title: 'the server',
          sources: [{ kind: 'dir', ref: 'src' }],
        });
        expect((yield* graph.reading.show(born.id, 0)).sources.map(({ kind, ref }) => ({ kind, ref }))).toEqual([
          { kind: 'dir', ref: 'src' },
        ]);
      }),
    ),
  );

  it.effect('an unreadable stored declaration is named in the vocabulary and in the birth refusal', () =>
    withDemo(({ graph, projectId, root, table, refusal, nameOf }) =>
      Effect.gen(function* () {
        const carrier = yield* declare(projectId, 'invoice', { fields: { total: 'number' } });
        yield* graph.graphStore.db
          .update(block)
          .set({ fields: { id: 'invoice', fields: {}, gates: [{ gate: 'required', field: 'total' }] } })
          .where(eq(block.id, carrier.id));
        yield* graph.tags.forget(projectId);
        const tags = yield* table();
        expect(tags.tagById('invoice')).toBeNull();
        const named = tags.unreadable.find((entry) => entry.id === 'invoice');
        expect(named?.name).toBe(yield* nameOf(carrier.id));
        expect(named?.reason).toContain('total');
        const refused = yield* refusal(graph.blocks.create({ projectId, parentId: root, tags: ['invoice'], title: 'March' }));
        expect(refused.code).toBe('tag-undeclared');
        expect(refused.unblock.join(' ')).toContain(yield* nameOf(carrier.id));
      }),
    ),
  );

  it.effect('a changed type validates standing carriers atomically before allowing new fields', () =>
    withDemo(({ graph, projectId, root, table, refusal, nameOf }) =>
      Effect.gen(function* () {
        const crash = yield* graph.blocks.create({ projectId, parentId: root, tags: ['task'], title: 'the crash' });
        const tags = yield* table();
        const declaration = tags.identities.typeOf('task')?.declaration;
        const task = tags.tagById('task');
        if (declaration === undefined || declaration === null || task === null) return yield* Effect.die('#task is not declared');
        const taskNode = yield* graph.blocks.blockById(yield* graph.blockNames.idOfName(declaration));
        const before = yield* graph.blocks.blockById(crash.id);
        const gated = yield* refusal(
          graph.blocks.update({
            id: taskNode.id,
            fields: { fields: { ...task.fields, estimate: 'number' }, gates: [...task.gates, { gate: 'required', field: 'estimate' }] },
          }),
        );
        expect(gated.code).toBe('carriers-invalid');
        expect(gated.reason).toContain(yield* nameOf(crash.id));
        expect(yield* graph.blocks.blockById(taskNode.id)).toEqual(taskNode);
        expect(yield* graph.blocks.blockById(crash.id)).toEqual(before);
        yield* graph.blocks.update({ id: taskNode.id, fields: { fields: { ...task.fields, estimate: 'number' } } });
        expect((yield* graph.blocks.update({ id: crash.id, fields: { estimate: 3 } })).fields.estimate).toBe(3);
      }),
    ),
  );
});
