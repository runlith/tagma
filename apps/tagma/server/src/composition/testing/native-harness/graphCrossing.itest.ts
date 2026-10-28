import { unthreadedCaller } from '../callers';
import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Context, Effect, Layer } from 'effect';
import { ToolAnswer, toolExecute, toolPrepare } from '@runlith/agent/tool';
import { openToolDoor, ToolJudge } from '@runlith/agent/door/openToolDoor';
import { builtinMode } from '../modes.js';
import { sessionIdentity } from '../../../external-harnesses/sessionPrefix.js';
import { fixtureNativeCatalog } from '../nativeCatalog.js';
import { type EffectDemo, graphFixture, tempRootEffect } from '../graphFixture.js';
import { ProjectIdentification, Projects } from '../../../projects/contract/service/registry.js';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { ProjectPolicy, ProjectLifecycle } from '../../../graph/contract/service/serving.js';
import { OtherGraphs } from '../../../graph/testing/doubles.js';
import type { TagTable } from '../../../graph/contract/wire/tags/table.js';
import { GateRefusal } from '../../../platform/contract/wire/refusal.js';

type GraphToolContext = { readonly graph: EffectDemo['context']; readonly projectId: number; readonly vocabulary: () => TagTable };

const makeCrossing = Effect.gen(function* () {
  const localFixture = graphFixture({ projects: ['tools'] });
  const otherFixture = graphFixture();
  const demo = (yield* Effect.acquireRelease(localFixture.openEffect(), () => Effect.orDie(localFixture.releaseEffect))).effects;
  const foreign = (yield* Effect.acquireRelease(otherFixture.openEffect(), () => Effect.orDie(otherFixture.releaseEffect))).effects;
  const graph = demo.graph;
  const projectId = demo.project('tools').id;
  const ctx: GraphToolContext = { graph: demo.context, projectId, vocabulary: yield* graph.tags.reader(projectId) };
  const graphCatalog = (context: GraphToolContext) =>
    fixtureNativeCatalog(
      {
        caller: {
          actor: {
            kind: 'thread',
            threadId: 'thread-1',
            projectId: context.projectId,
            principalId: 'owner-1',
            session: { harness: 'tagma', key: 'thread-1' },
          },
          files: null,
        },
        place: { root: demo.demoRoot, origin: null },
        project: { id: context.projectId, name: 'tools' },
        vocabulary: context.vocabulary,
        identity: sessionIdentity,
        world: 'checkout',
        graphRoot: demo.demoRoot,
        owners: context.graph,
      },
      [
        'read_block',
        'read_zone',
        'claim_block',
        'query_blocks',
        'search_blocks',
        'delete_block',
        'edit_block',
        'create_block',
        'apply_batch',
        'link_blocks',
        'unlink_blocks',
        'supersede_block',
        'update_block',
      ],
    );
  let calls = 0;
  const answerWith = Effect.fnUntraced(function* (context: GraphToolContext, name: string, input: Record<string, unknown>) {
    const entry = (yield* graphCatalog(context))[name];
    if (entry === undefined) return yield* Effect.die(`The fixture offers no ${name}.`);
    const key = `crossing-${++calls}`;
    const prepared = yield* toolPrepare(entry)?.(input, { toolCallId: key, caller: unthreadedCaller }) ?? Effect.succeed(undefined);
    const answered = yield* toolExecute(entry)!(input, {
      toolCallId: key,
      caller: unthreadedCaller,
      messages: [],
      prepared: prepared?.prepared,
    });
    return (answered instanceof ToolAnswer ? answered.value : answered) as Record<string, unknown>;
  });
  const refusedWith = Effect.fnUntraced(function* (context: GraphToolContext, name: string, input: Record<string, unknown>) {
    const entry = (yield* graphCatalog(context))[name];
    if (entry === undefined) return yield* Effect.die(`The fixture offers no ${name}.`);
    const result = yield* Effect.result(toolPrepare(entry)!(input, { toolCallId: `refusal-${++calls}`, caller: unthreadedCaller }));
    expect(result._tag).toBe('Failure');
    if (result._tag === 'Success') return yield* Effect.die('the operation prepared instead of refusing its subject');
    return result.failure;
  });
  const across = (context: GraphToolContext, globalId: number): GraphToolContext => {
    const registry = Context.make(Projects, Context.get(context.graph, Projects)).pipe(
      Context.add(MachineStore, Context.get(context.graph, MachineStore)),
      Context.add(MachineUnits, Context.get(context.graph, MachineUnits)),
      Context.add(ProjectPolicy, Context.get(context.graph, ProjectPolicy)),
      Context.add(ProjectLifecycle, Context.get(context.graph, ProjectLifecycle)),
    );
    let local: EffectDemo['context'];
    let there: EffectDemo['context'];
    const reach = (id: number) => Effect.succeed(id === globalId ? there : local);
    local = Context.add(context.graph, OtherGraphs(), reach);
    there = Context.add(Context.merge(foreign.context, registry), OtherGraphs(), reach);
    return { ...context, graph: local };
  };
  return {
    demo,
    foreign,
    graph,
    ctx,
    graphCatalog,
    answerWith,
    refusedWith,
    across,
    call: (name: string, input: Record<string, unknown>) => answerWith(ctx, name, input),
    tableOf: (world: EffectDemo, id: number) => world.graph.tags.of(id),
  };
});

class CrossingFixture extends Context.Service<CrossingFixture, Effect.Success<typeof makeCrossing>>()('testing/CrossingFixture') {}

const crossingFixture = Layer.effectContext(
  Effect.map(makeCrossing, (world) =>
    Context.make(CrossingFixture, world).pipe(Context.add(ProjectIdentification, Context.get(world.demo.context, ProjectIdentification))),
  ),
).pipe(Layer.provideMerge(BunFileSystem.layer));

layer(crossingFixture, { excludeTestServices: true })('cross-project native tools', (it) => {
  it.effect('a named block of another project is read and deleted in its home', () =>
    Effect.gen(function* () {
      const { demo, graph, call } = yield* CrossingFixture;
      const other = yield* graph.projectLifecycle.create({ name: 'сосед', rootPath: yield* tempRootEffect(demo.fixture, 'tagma-other-') });
      const block = yield* graph.blocks.create({ projectId: other.id, tags: ['task'], title: 'чужая' });
      const read = yield* call('read_block', { blockIds: [yield* demo.nameOf(block.id)] });
      expect(read.status).toBe('ok');
      expect(yield* call('delete_block', { blockId: yield* demo.nameOf(block.id) })).toMatchObject({ status: 'ok' });
      expect((yield* graph.blocks.rawBlockById(block.id)).deletedAt).toBeInstanceOf(Date);
    }),
  );

  it.effect('a batch links a note to an addressed note in another graph from a project thread', () =>
    Effect.gen(function* () {
      const { foreign, graph, ctx, across, answerWith, refusedWith } = yield* CrossingFixture;
      const other = (yield* foreign.graph.projects.global())!;
      const source = yield* graph.blocks.create({ projectId: ctx.projectId, title: 'Local batch note' });
      yield* graph.blocks.create({
        projectId: ctx.projectId,
        title: 'Same short name',
        uuid: (source.uuid[0] === '0' ? '1' : '0') + source.uuid.slice(1),
      });
      const target = yield* foreign.graph.blocks.create({ projectId: other.id, title: 'Foreign batch note' });
      const fromId = source.uuid.replaceAll('-', '');
      const toId = `${other.id}/${yield* foreign.nameOf(target.id)}`;
      const seamed = across(ctx, other.id);
      expect(
        yield* answerWith(seamed, 'apply_batch', {
          project: ctx.projectId,
          ops: [{ op: 'link', fromId, kind: 'relates', toId }],
        }),
      ).toMatchObject({ status: 'ok' });
      const root = yield* foreign.graph.blocks.rootBlockOf(other.id);
      expect((yield* graph.edges.farOf(ctx.projectId)).filter((row) => row.fromId === source.id)).toMatchObject([
        { kind: 'relates', graph: root.uuid, uuid: target.uuid },
      ]);
      const changed = yield* answerWith(seamed, 'apply_batch', {
        project: ctx.projectId,
        ops: [
          { op: 'unlink', fromId: `${ctx.projectId}/${fromId}`, kind: 'relates', toId },
          { op: 'create', $id: 'child', parentId: fromId, title: 'Linked batch child', edges: [{ kind: 'relates', to: toId }] },
          { op: 'link', fromId: '$child', kind: 'discovered-from', toId: `${ctx.projectId}/${fromId}` },
          { op: 'link', fromId, kind: 'relates', toId: '$child' },
          { op: 'unlink', fromId, kind: 'relates', toId: '$child' },
        ],
      });
      expect(changed).toMatchObject({ status: 'ok' });
      expect((yield* graph.edges.farOf(ctx.projectId)).filter((row) => row.fromId === source.id)).toEqual([]);
      expect((yield* graph.edges.of(ctx.projectId, new Set([source.id]))).filter((row) => row.fromId === source.id)).toEqual([]);
      const child = yield* graph.blocks.blockById(yield* graph.blockNames.idOfName((changed.ids as Record<string, string>).child!));
      expect(child.parentId).toBe(source.id);
      expect((yield* graph.edges.farOf(ctx.projectId)).filter((row) => row.fromId === child.id)).toMatchObject([
        { kind: 'relates', graph: root.uuid, uuid: target.uuid },
      ]);
      expect(yield* graph.edges.of(ctx.projectId, new Set([child.id]))).toMatchObject([
        { fromId: child.id, kind: 'discovered-from', toId: source.id },
      ]);
      const standalone = yield* refusedWith(seamed, 'edit_block', {
        project: ctx.projectId,
        blockId: toId,
        oldString: 'x',
        newString: 'y',
      });
      expect(standalone).toMatchObject({ code: 'place-mismatch' });
      for (const op of [
        { op: 'edit', id: toId, old: 'x', new: 'y' },
        { op: 'link', fromId: toId, kind: 'relates', toId: fromId },
        { op: 'create', parentId: toId, title: 'Wrong project' },
        { op: 'update', id: fromId, parentId: toId },
      ]) {
        expect(yield* answerWith(seamed, 'apply_batch', { project: ctx.projectId, ops: [op] })).toMatchObject({
          status: 'refused',
          code: standalone.code,
        });
      }
      expect(
        yield* answerWith(seamed, 'apply_batch', {
          project: ctx.projectId,
          ops: [
            { op: 'link', fromId, kind: 'relates', toId },
            { op: 'link', fromId, kind: 'relates', toId: `${other.id}/ffffffff` },
          ],
        }),
      ).toMatchObject({ status: 'refused', code: 'not-found' });
      expect((yield* graph.edges.farOf(ctx.projectId)).filter((row) => row.fromId === source.id)).toEqual([]);
      const found = yield* answerWith(seamed, 'search_blocks', { project: other.id, query: 'Foreign batch note' });
      const foundName = (found.blocks as { name: string }[])[0]!.name;
      expect(
        yield* answerWith(seamed, 'apply_batch', {
          project: ctx.projectId,
          ops: [{ op: 'link', fromId, kind: 'relates', toId: `${other.id}/${foundName}` }],
        }),
      ).toMatchObject({ status: 'ok' });
      expect(yield* answerWith(seamed, 'unlink_blocks', { project: ctx.projectId, fromId, kind: 'relates', toId })).toMatchObject({
        status: 'ok',
      });
      expect((yield* graph.edges.farOf(ctx.projectId)).filter((row) => row.fromId === source.id)).toEqual([]);
      expect(yield* answerWith(seamed, 'link_blocks', { project: ctx.projectId, fromId, kind: 'relates', toId })).toMatchObject({
        status: 'ok',
      });
      expect((yield* graph.edges.farOf(ctx.projectId)).filter((row) => row.fromId === source.id)).toMatchObject([
        { kind: 'relates', graph: root.uuid, uuid: target.uuid },
      ]);
      expect(
        yield* answerWith(seamed, 'apply_batch', {
          project: ctx.projectId,
          ops: [
            {
              op: 'propose',
              amendsId: fromId,
              title: 'Stored address',
              ops: [{ op: 'update', id: `${ctx.projectId}/${fromId}`, body: 'x' }],
            },
          ],
        }),
      ).toMatchObject({ status: 'refused', code: 'bad-document' });
      expect(
        yield* refusedWith(seamed, 'create_block', { project: ctx.projectId, title: 'Wrong amended project', amendsId: toId }),
      ).toMatchObject({
        code: 'place-mismatch',
      });
      expect(
        yield* answerWith(seamed, 'apply_batch', {
          project: ctx.projectId,
          ops: [{ op: 'create', title: 'Wrong amended project', amendsId: toId }],
        }),
      ).toMatchObject({ status: 'refused', code: 'place-mismatch' });
    }),
  );

  it.effect('foreign blocks open and edit', () =>
    Effect.gen(function* () {
      const { demo, graph, call } = yield* CrossingFixture;
      const globalId = (yield* graph.projects.global())?.id ?? 0;
      const law = yield* graph.blocks.create({ projectId: globalId, tags: ['rule'], title: 'Cross law', body: 'It binds everywhere.' });
      const name = yield* demo.nameOf(law.id);
      expect((yield* call('read_block', { blockIds: [name] })).status).toBe('ok');
      expect((yield* call('edit_block', { blockId: name, oldString: 'everywhere', newString: 'in every project' })).status).toBe('ok');
      const other = yield* graph.projectLifecycle.create({ name: 'other', rootPath: yield* tempRootEffect(demo.fixture, 'tagma-other-') });
      const theirs = yield* graph.blocks.create({ projectId: other.id, tags: ['idea'], title: 'theirs', body: 'x' });
      expect((yield* call('read_block', { blockIds: [yield* demo.nameOf(theirs.id)] })).status).toBe('ok');
    }),
  );

  it.effect('a global block in a separate store opens and edits through the foreign-graph seam', () =>
    Effect.gen(function* () {
      const { demo, foreign, graph, ctx, across, answerWith, refusedWith } = yield* CrossingFixture;
      const globalId = (yield* foreign.graph.projects.global())?.id ?? 0;
      const globalRoot = yield* foreign.graph.blocks.rootBlockOf(globalId);
      const law = yield* foreign.graph.blocks.create({
        projectId: globalId,
        tags: ['rule'],
        title: 'Far law',
        body: 'It binds from another store.',
      });
      const name = yield* foreign.nameOf(law.id);
      expect(yield* answerWith({ ...ctx }, 'read_block', { blockIds: [name] })).toMatchObject({ status: 'refused', code: 'not-found' });
      const seamed = across(ctx, globalId);
      expect((yield* answerWith(seamed, 'read_block', { blockIds: [name] })).status).toBe('ok');
      expect(
        (yield* answerWith(seamed, 'edit_block', { blockId: name, oldString: 'another store', newString: 'its own store' })).status,
      ).toBe('ok');
      const born = (yield* answerWith(seamed, 'create_block', {
        tags: ['rule'],
        title: 'Born across the seam',
        body: 'It lands in GLOBAL.',
        parentId: yield* foreign.nameOf(globalRoot.id),
      })) as { status: string; block: { name: string } };
      expect(born.status).toBe('ok');
      expect((yield* foreign.graph.blocks.blockById(yield* foreign.graph.blockNames.idOfName(born.block.name))).projectId).toBe(globalId);
      expect((yield* Effect.result(graph.blockNames.idOfName(born.block.name)))._tag).toBe('Failure');
      const applied = yield* answerWith(seamed, 'apply_batch', {
        project: 'global',
        ops: [{ op: 'create', $id: 'far-doc', tags: ['idea'], title: 'Far document' }],
      });
      expect(applied).toMatchObject({ status: 'ok' });
      const batchName = (applied.overview as string).match(/\$far-doc → ([0-9a-f]+)/)?.[1];
      if (batchName === undefined) return yield* Effect.die('The GLOBAL batch returned no handle.');
      expect((yield* foreign.graph.blocks.blockById(yield* foreign.graph.blockNames.idOfName(batchName))).projectId).toBe(globalId);
      expect((yield* Effect.result(graph.blockNames.idOfName(batchName)))._tag).toBe('Failure');
      const localRoot = yield* graph.blocks.rootBlockOf(ctx.projectId);
      expect(
        yield* refusedWith(seamed, 'create_block', {
          tags: ['idea'],
          title: 'Nowhere',
          project: 'global',
          parentId: yield* demo.nameOf(localRoot.id),
        }),
      ).toMatchObject({ code: 'place-mismatch' });
      expect((yield* foreign.graph.blocks.blockById(law.id)).body).toContain('its own store');
    }),
  );

  for (const code of ['graph-pool', 'ambiguous-name'] as const) {
    it.effect(`a reachable foreign block answers beside an unrelated project open failure (${code})`, () =>
      Effect.gen(function* () {
        const { demo, foreign, graph, ctx, across, answerWith, refusedWith } = yield* CrossingFixture;
        const global = yield* foreign.graph.projects.global();
        if (global === undefined) return yield* Effect.die('The fixture has no global graph.');
        const born = yield* foreign.graph.blocks.create({ projectId: global.id, tags: ['idea'], title: 'Reachable foreign block' });
        const name = yield* foreign.nameOf(born.id);
        const broken = yield* graph.projectLifecycle.create({
          name: `unreachable-${code}`,
          rootPath: yield* tempRootEffect(demo.fixture, 'unreachable-'),
        });
        const seamed = across(ctx, global.id);
        const reach = Context.get(seamed.graph, OtherGraphs());
        if (reach === null) return yield* Effect.die('The fixture has no foreign graph reader.');
        const partial = {
          ...seamed,
          graph: Context.add(seamed.graph, OtherGraphs(), (id: number) =>
            id === broken.id ? Effect.fail(new GateRefusal(code, 'This project cannot be opened', ['Repair its graph'])) : reach(id),
          ),
        };
        expect(yield* answerWith(partial, 'read_block', { blockIds: [name] })).toMatchObject({
          status: 'ok',
          reads: [{ name, title: 'Reachable foreign block', projectId: global.id }],
          unreachable: [{ projectId: broken.id, error: { code, reason: 'This project cannot be opened' } }],
        });
        expect(yield* answerWith(partial, 'read_block', { blockIds: ['ffffffff'] })).toMatchObject({
          status: 'refused',
          code: 'graph-pool',
          reason: expect.stringContaining(`project ${broken.id}`),
        });
      }),
    );
  }

  it.effect('a foreign GLOBAL task is claimed and queried in its home graph', () =>
    Effect.gen(function* () {
      const { demo, foreign, graph, ctx, across, answerWith, refusedWith, tableOf } = yield* CrossingFixture;
      const globalId = (yield* foreign.graph.projects.global())?.id ?? 0;
      const globalRoot = yield* foreign.graph.blocks.rootBlockOf(globalId);
      const work = yield* foreign.graph.blocks.create({
        projectId: globalId,
        tags: ['task'],
        title: 'Cross-project work',
        parentId: globalRoot.id,
        body: 'It was written from another project.',
      });
      const name = yield* foreign.nameOf(work.id);
      const seamed = across(ctx, globalId);
      expect(yield* answerWith(seamed, 'claim_block', { blockId: name })).toMatchObject({ status: 'ok' });
      expect(yield* answerWith(seamed, 'query_blocks', { scope: [name], sort: { by: 'created', order: 'asc' } })).toMatchObject({
        status: 'ok',
        blocks: [expect.objectContaining({ name })],
      });
      const untouched = yield* foreign.graph.blocks.blockById(work.id);
      const foreignTable = yield* tableOf(foreign, globalId);
      expect(foreignTable.statusOf(untouched)).toBe('in_work');
      expect(yield* foreign.graph.sessions.writerOf(foreignTable.holderOf(untouched) ?? null)).toMatchObject({
        harness: 'tagma',
        key: 'thread-1',
      });
      const zone = yield* answerWith(seamed, 'read_zone', { scopeId: name });
      expect(zone.status).toBe('ok');
      expect(zone.page).toContain('It was written from another project.');
      expect(yield* refusedWith(seamed, 'claim_block', { blockId: 'ffffffff' })).toMatchObject({ code: 'not-found' });
      const mine = yield* graph.blocks.create({ projectId: ctx.projectId, tags: ['idea'], title: 'mine', body: 'Here.' });
      const trap: GraphToolContext = {
        ...ctx,
        graph: Context.add(ctx.graph, OtherGraphs(), () => Effect.die('the ladder was walked on a local hit')),
      };
      expect(yield* answerWith(trap, 'read_block', { blockIds: [yield* demo.nameOf(mine.id)] })).toMatchObject({ status: 'ok' });
      expect(yield* answerWith(trap, 'claim_block', { blockId: yield* demo.nameOf(mine.id) })).toMatchObject({
        status: 'refused',
        code: 'no-holder',
      });
    }),
  );

  it.effect('GLOBAL replacement from a project thread asks in review alone, like an act at home', () =>
    Effect.gen(function* () {
      const { demo, foreign, graph, ctx, graphCatalog, across, answerWith, refusedWith } = yield* CrossingFixture;
      const global = yield* foreign.graph.projects.global();
      if (global === undefined) return yield* Effect.die('the fixture has no GLOBAL project');
      const replacement = yield* foreign.graph.blocks.create({ projectId: global.id, tags: ['rule'], title: 'Standing law' });
      const context = across(ctx, global.id);
      const tool = (yield* graphCatalog(context)).supersede_block!;
      for (const mode of ['bypass', 'trust', 'review'] as const) {
        const old = yield* foreign.graph.blocks.create({ projectId: global.id, tags: ['rule'], title: `Retiring law ${mode}` });
        const input = { oldId: yield* foreign.nameOf(old.id), withId: yield* foreign.nameOf(replacement.id) };
        yield* Effect.acquireUseRelease(
          Effect.sync(() => openToolDoor(mode, unthreadedCaller, {}, new ToolJudge(builtinMode(mode)))),
          (door) =>
            Effect.gen(function* () {
              const verdict = yield* door.verdict({ name: 'supersede_block', input, tool, toolCallId: mode });
              expect(verdict.verdict).toBe(mode === 'review' ? 'ask' : 'allow');
              expect(yield* foreign.graph.standing.successorOf(old.id)).toBeNull();
              const outcome = yield* door.settle({
                name: 'supersede_block',
                input,
                tool,
                confirmed: mode === 'review' ? true : undefined,
                options: { toolCallId: mode, messages: [] },
              });
              expect(outcome.executed).toBe(true);
              expect(outcome.output).toMatchObject({ status: 'ok', block: { name: input.oldId, superseded: true } });
              expect(yield* foreign.graph.standing.successorOf(old.id)).toBe(replacement.id);
            }),
          (door) => door.close(),
        );
      }
      const local = yield* graph.blocks.create({ projectId: ctx.projectId, tags: ['rule'], title: 'Local law' });
      expect(
        yield* refusedWith(context, 'supersede_block', {
          oldId: yield* demo.nameOf(local.id),
          withId: yield* foreign.nameOf(replacement.id),
        }),
      ).toMatchObject({ code: 'place-mismatch' });
      expect(yield* graph.standing.successorOf(local.id)).toBeNull();
      expect(
        yield* refusedWith(context, 'supersede_block', {
          oldId: yield* foreign.nameOf(replacement.id),
          withId: yield* demo.nameOf(local.id),
        }),
      ).toMatchObject({ code: 'place-mismatch' });
      expect(yield* foreign.graph.standing.successorOf(replacement.id)).toBeNull();
      expect(
        yield* answerWith(context, 'read_block', { blockIds: [yield* foreign.nameOf(replacement.id), yield* demo.nameOf(local.id)] }),
      ).toMatchObject({
        status: 'ok',
        reads: [
          expect.objectContaining({ name: yield* foreign.nameOf(replacement.id) }),
          expect.objectContaining({ name: yield* demo.nameOf(local.id) }),
        ],
      });
    }),
  );

  it.effect('a subtree moves into a graph of another store: it arrives first, then leaves, with the edges inside it', () =>
    Effect.gen(function* () {
      const { demo, foreign, graph, ctx, across, answerWith } = yield* CrossingFixture;
      const globalId = (yield* foreign.graph.projects.global())?.id ?? 0;
      const seamed = across(ctx, globalId);
      const home = yield* demo.nameOf((yield* graph.blocks.rootBlockOf(ctx.projectId)).id);
      const law = yield* foreign.graph.blocks.create({
        projectId: globalId,
        tags: ['rule'],
        title: 'Misplaced law',
        body: 'It binds one project.',
      });
      const reason = yield* foreign.graph.blocks.create({
        projectId: globalId,
        tags: ['idea'],
        title: 'Why it binds',
        parentId: law.id,
        edges: [{ kind: 'relates', to: law.id }],
      });
      const name = yield* foreign.nameOf(law.id);
      const child = yield* foreign.nameOf(reason.id);
      expect(yield* answerWith(seamed, 'update_block', { blockId: name, parentId: home })).toMatchObject({
        status: 'ok',
        block: { name },
        moved: { blocks: 2, relinked: 0 },
      });
      const landed = yield* graph.blocks.blockById(yield* graph.blockNames.idOfName(name));
      const under = yield* graph.blocks.blockById(yield* graph.blockNames.idOfName(child));
      expect(landed).toMatchObject({ projectId: ctx.projectId, title: 'Misplaced law', body: 'It binds one project.' });
      expect(under).toMatchObject({ projectId: ctx.projectId, parentId: landed.id });
      expect(yield* graph.edges.of(ctx.projectId, new Set([under.id]))).toMatchObject([
        { fromId: under.id, toId: landed.id, kind: 'relates' },
      ]);
      expect((yield* Effect.result(foreign.graph.blockNames.idOfName(name)))._tag).toBe('Failure');
      expect((yield* Effect.result(foreign.graph.blockNames.idOfName(child)))._tag).toBe('Failure');

      const patched = yield* foreign.graph.blocks.create({ projectId: globalId, tags: ['idea'], title: 'Patched' });
      const patchedName = yield* foreign.nameOf(patched.id);
      expect(yield* answerWith(seamed, 'update_block', { blockId: patchedName, parentId: home, fields: { unknown: 1 } })).toMatchObject({
        status: 'refused',
        code: 'relocation-shape',
      });
      expect((yield* foreign.graph.blocks.blockById(patched.id)).projectId).toBe(globalId);
    }),
  );

  it.effect('a move that stopped between its acts finishes when repeated, and copies that diverged since are refused until one goes', () =>
    Effect.gen(function* () {
      const { demo, foreign, graph, ctx, across, answerWith, call } = yield* CrossingFixture;
      const globalId = (yield* foreign.graph.projects.global())?.id ?? 0;
      const seamed = across(ctx, globalId);
      const globalRoot = yield* foreign.graph.blocks.rootBlockOf(globalId);
      const target = yield* graph.blocks.rootBlockOf(ctx.projectId);
      const home = yield* demo.nameOf(target.id);
      const stopped = Effect.fnUntraced(function* (title: string) {
        const row = yield* foreign.graph.blocks.create({ projectId: globalId, tags: ['idea'], title });
        yield* graph.blocks.arrive({
          projectId: ctx.projectId,
          parentId: target.id,
          from: globalRoot.uuid,
          blocks: [
            {
              uuid: row.uuid,
              parent: null,
              ord: row.ord,
              title: row.title,
              body: row.body,
              tags: row.tags,
              fields: row.fields,
              sessions: [],
              createdAt: row.createdAt,
              updatedAt: row.updatedAt,
              sources: [],
              links: [],
              far: [],
            },
          ],
        });
        return { row, name: yield* foreign.nameOf(row.id) };
      });
      const twin = yield* stopped('Stopped half way');
      expect(yield* answerWith(seamed, 'update_block', { blockId: `${globalId}/${twin.name}`, parentId: home })).toMatchObject({
        status: 'ok',
        moved: { blocks: 1 },
      });
      expect((yield* Effect.result(foreign.graph.blockNames.idOfName(twin.name)))._tag).toBe('Failure');
      expect((yield* graph.blocks.blockById(yield* graph.blockNames.idOfName(twin.name))).projectId).toBe(ctx.projectId);

      const diverged = yield* stopped('Diverged after the stop');
      yield* foreign.graph.blocks.update({ id: diverged.row.id, body: 'Written after the stop.' });
      expect(yield* answerWith(seamed, 'update_block', { blockId: `${globalId}/${diverged.name}`, parentId: home })).toMatchObject({
        status: 'refused',
        code: 'relocation-stale',
      });
      expect(yield* call('delete_block', { blockId: diverged.name })).toMatchObject({ status: 'ok' });
      expect(yield* answerWith(seamed, 'update_block', { blockId: diverged.name, parentId: home })).toMatchObject({
        status: 'ok',
      });
      expect(yield* graph.blocks.blockById(yield* graph.blockNames.idOfName(diverged.name))).toMatchObject({
        projectId: ctx.projectId,
        body: 'Written after the stop.',
        deletedAt: null,
      });
    }),
  );

  it.effect('a subtree keeps its statuses, holder, operation-owned fields, sources and edges in the graph it moves to', () =>
    Effect.gen(function* () {
      const { demo, graph, ctx, call, tableOf } = yield* CrossingFixture;
      const source = yield* graph.projectLifecycle.create({
        name: 'move-source',
        rootPath: yield* tempRootEffect(demo.fixture, 'tagma-source-'),
      });
      const spec = yield* graph.blocks.create({ projectId: source.id, tags: ['spec'], title: 'Moving spec' });
      const working = yield* graph.blocks.create({
        projectId: source.id,
        tags: ['task'],
        title: 'Working task',
        parentId: spec.id,
        edges: [{ kind: 'implements', to: spec.id }],
      });
      const ended = yield* graph.blocks.create({ projectId: source.id, tags: ['task'], title: 'Ended task', parentId: spec.id });
      const law = yield* graph.blocks.create({ projectId: source.id, tags: ['rule'], title: 'Moving law', parentId: spec.id });
      yield* graph.blocks.create({
        projectId: source.id,
        title: 'Moving note',
        parentId: spec.id,
        sources: [{ kind: 'file', ref: 'moving.ts' }],
      });
      const staying = yield* graph.blocks.create({
        projectId: source.id,
        tags: ['task'],
        title: 'Staying task',
        edges: [{ kind: 'waits-on', to: working.id }],
      });
      yield* graph.edges.link({ fromId: ended.id, kind: 'relates', toId: staying.id });
      yield* demo.as('worker', graph.tasks.claim({ id: working.id }));
      yield* graph.tasks.finish({ id: ended.id });
      yield* graph.blocks.setDelivery({ id: law.id, delivery: 'prompt' });
      const names = {
        spec: yield* demo.nameOf(spec.id),
        working: yield* demo.nameOf(working.id),
        ended: yield* demo.nameOf(ended.id),
        law: yield* demo.nameOf(law.id),
      };
      const target = yield* graph.blocks.rootBlockOf(ctx.projectId);
      const left = yield* graph.blocks.rootBlockOf(source.id);
      expect(yield* call('update_block', { blockId: names.spec, parentId: yield* demo.nameOf(target.id) })).toMatchObject({
        status: 'ok',
        block: { name: names.spec },
        moved: { blocks: 5, from: 'move-source', relinked: 0 },
      });

      const at = Effect.fnUntraced(function* (name: string) {
        return yield* graph.blocks.blockById(yield* graph.blockNames.idOfName(name));
      });
      const table = yield* tableOf(demo, ctx.projectId);
      const [moved, task, done, rule] = [yield* at(names.spec), yield* at(names.working), yield* at(names.ended), yield* at(names.law)];
      for (const row of [moved, task, done, rule]) expect(row.projectId).toBe(ctx.projectId);
      expect(table.statusOf(task)).toBe('in_work');
      expect(yield* graph.sessions.writerOf(table.holderOf(task) ?? null)).toMatchObject({ harness: 'test', key: 'worker' });
      expect(table.statusOf(done)).toBe('done');
      expect(rule.fields).toMatchObject({ delivery: 'prompt' });
      const note = (yield* graph.blocks.childrenOf(moved.id)).find((row) => row.title === 'Moving note');
      expect(yield* graph.sources.of(note?.id ?? 0)).toMatchObject([{ kind: 'file', ref: 'moving.ts' }]);
      expect(yield* graph.edges.of(ctx.projectId, new Set([task.id]))).toMatchObject([
        { fromId: task.id, toId: moved.id, kind: 'implements' },
      ]);
      expect((yield* graph.edges.farOf(ctx.projectId)).filter((row) => row.fromId === done.id)).toMatchObject([
        { kind: 'relates', graph: left.uuid, uuid: staying.uuid },
      ]);
      expect((yield* graph.edges.farOf(source.id)).filter((row) => row.fromId === staying.id)).toMatchObject([
        { kind: 'waits-on', graph: target.uuid, uuid: task.uuid },
      ]);
      expect((yield* graph.edges.of(source.id, new Set([staying.id]))).filter((row) => row.fromId === staying.id)).toEqual([]);
      expect((yield* graph.blocks.rawBlockById(spec.id)).deletedAt).toBeInstanceOf(Date);
    }),
  );

  it.effect(
    'a move into a graph that does not declare a carried tag, or one that parts a rule from its debt owner, changes neither graph',
    () =>
      Effect.gen(function* () {
        const { demo, graph, ctx, call } = yield* CrossingFixture;
        const source = yield* graph.projectLifecycle.create({
          name: 'move-refused',
          rootPath: yield* tempRootEffect(demo.fixture, 'tagma-refused-'),
        });
        yield* graph.blocks.create({
          projectId: source.id,
          tags: ['tag'],
          title: '#errand',
          body: 'A small piece of work.',
          fields: { id: 'errand' },
        });
        yield* graph.tags.forget(source.id);
        const parent = yield* graph.blocks.create({ projectId: source.id, tags: ['idea'], title: 'Holds an errand' });
        yield* graph.blocks.create({ projectId: source.id, tags: ['errand'], title: 'The errand', parentId: parent.id });
        const home = yield* demo.nameOf((yield* graph.blocks.rootBlockOf(ctx.projectId)).id);
        const parentName = yield* demo.nameOf(parent.id);
        expect(yield* call('update_block', { blockId: parentName, parentId: home })).toMatchObject({
          status: 'refused',
          code: 'tag-undeclared',
        });
        expect(yield* graph.blocks.blockById(parent.id)).toMatchObject({ projectId: source.id, deletedAt: null });

        const owner = yield* graph.blocks.create({ projectId: source.id, tags: ['task'], title: 'Owns the debt' });
        const rule = yield* graph.blocks.create({ projectId: source.id, tags: ['rule'], title: 'Owes debt' });
        yield* graph.blocks.setEnforcement({
          id: rule.id,
          anchors: [],
          stood: undefined,
          document: {
            strictness: 'note',
            on: [],
            inspection: 'layered',
            debt: [{ fingerprint: 'app order core/view.ts -> ui/', owner: yield* demo.nameOf(owner.id) }],
            escaped: [],
          },
          journal: {},
        });
        expect(yield* call('update_block', { blockId: yield* demo.nameOf(rule.id), parentId: home })).toMatchObject({
          status: 'refused',
          code: 'relocation-shape',
        });
        expect(yield* graph.blocks.blockById(rule.id)).toMatchObject({ projectId: source.id, deletedAt: null });
      }),
  );

  it.effect('a block moved into another graph keeps the session its session-typed field names', () =>
    Effect.gen(function* () {
      const { demo, foreign, graph, ctx, across, answerWith } = yield* CrossingFixture;
      const globalId = (yield* foreign.graph.projects.global())?.id ?? 0;
      const ticket = {
        tags: ['tag'],
        title: '#ticket',
        body: 'A reviewed ticket.',
        fields: { id: 'ticket', fields: { reviewer: 'session' } },
      };
      yield* foreign.graph.blocks.create({ projectId: globalId, ...ticket });
      yield* foreign.graph.tags.forget(globalId);
      yield* graph.blocks.create({ projectId: ctx.projectId, ...ticket });
      yield* graph.tags.forget(ctx.projectId);
      yield* foreign.as('reviewer', foreign.graph.blocks.create({ projectId: globalId, title: 'Signed by the reviewer' }));
      const reviewer = yield* foreign.graph.sessions.idOf({ harness: 'test', key: 'reviewer' });
      const reviewed = yield* foreign.graph.blocks.create({
        projectId: globalId,
        tags: ['ticket'],
        title: 'Reviewed',
        fields: { reviewer },
      });
      const name = yield* foreign.nameOf(reviewed.id);
      const home = yield* demo.nameOf((yield* graph.blocks.rootBlockOf(ctx.projectId)).id);
      expect(yield* answerWith(across(ctx, globalId), 'update_block', { blockId: name, parentId: home })).toMatchObject({ status: 'ok' });
      const moved = yield* graph.blocks.blockById(yield* graph.blockNames.idOfName(name));
      expect(yield* graph.sessions.writerOf(moved.fields['reviewer'] as number)).toMatchObject({ harness: 'test', key: 'reviewer' });
    }),
  );

  it.effect('a project selector creates, searches and applies a batch in the named graph', () =>
    Effect.gen(function* () {
      const { demo, graph, ctx, call, refusedWith } = yield* CrossingFixture;
      const beta = yield* graph.projectLifecycle.create({
        name: 'selector-beta',
        rootPath: yield* tempRootEffect(demo.fixture, 'tagma-beta-'),
      });
      const title = 'Selector destination';
      const created = yield* call('create_block', { project: beta.name, tags: ['idea'], title });
      expect(created.status).toBe('ok');
      const name = (created.block as { name: string }).name;
      const row = yield* graph.blocks.blockById(yield* graph.blockNames.idOfName(name));
      expect(row.projectId).toBe(beta.id);
      expect(yield* call('search_blocks', { project: beta.id, query: title })).toMatchObject({ status: 'ok', blocks: [{ name }] });
      expect(yield* call('search_blocks', { query: title })).toMatchObject({ status: 'ok', blocks: [], total: 0 });
      const applied = yield* call('apply_batch', {
        project: String(beta.id),
        ops: [{ op: 'create', $id: 'child', parentId: name, tags: ['idea'], title: 'Selector child' }],
      });
      expect(applied.status).toBe('ok');
      const childName = (applied.ids as Record<string, string>).child!;
      expect(yield* graph.blocks.blockById(yield* graph.blockNames.idOfName(childName))).toMatchObject({
        projectId: beta.id,
        parentId: row.id,
      });
      const local = yield* graph.blocks.rootBlockOf(ctx.projectId);
      expect(
        yield* refusedWith(ctx, 'create_block', { project: beta.id, parentId: yield* demo.nameOf(local.id), title: 'Wrong place' }),
      ).toMatchObject({ code: 'place-mismatch' });
    }),
  );

  it.effect('aliases select their graphs and a registered alias collision requires an id', () =>
    Effect.gen(function* () {
      const { demo, graph, ctx, call, refusedWith } = yield* CrossingFixture;
      const home = yield* graph.sourceProject.project();
      if (home === undefined) return yield* Effect.die('the fixture source has no project');
      const created = yield* call('create_block', { project: 'tagma', tags: ['idea'], title: 'Source graph' });
      expect(created.status).toBe('ok');
      const name = (created.block as { name: string }).name;
      expect(yield* graph.blocks.blockById(yield* graph.blockNames.idOfName(name))).toMatchObject({ projectId: home.id });
      const collision = yield* graph.projectLifecycle.create({
        name: 'tagma',
        rootPath: yield* tempRootEffect(demo.fixture, 'tagma-alias-'),
      });
      expect(yield* refusedWith(ctx, 'create_block', { project: 'tagma', tags: ['idea'], title: 'Ambiguous source' })).toMatchObject({
        code: 'ambiguous-project',
      });
      const explicit = yield* call('create_block', { project: collision.id, tags: ['idea'], title: 'Chosen by id' });
      expect(explicit.status).toBe('ok');
      expect(yield* graph.blocks.blockById(yield* graph.blockNames.idOfName((explicit.block as { name: string }).name))).toMatchObject({
        projectId: collision.id,
      });
    }),
  );
});
