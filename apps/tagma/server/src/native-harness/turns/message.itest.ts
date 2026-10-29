import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Effect, FileSystem, Layer } from 'effect';
import { join } from 'node:path';
import { makeThreadRecords } from '../../thread-record/layer.js';
import { threadStack } from '../../composition/testing/threadParts.js';
import { demoGraphLayer, withDemo, type EffectDemo } from '../../composition/testing/graphFixture.js';
import { nativeTurnContext } from './message.js';
import { type WorldState, worldStateSections } from './worldState.js';
import type { Message } from '@runlith/llm/schema/messages';
import { CORE_KINDS } from '../testing/doubles.js';

const noWorld: WorldState = {
  skills: [{ id: 'artifacts', description: 'Writes a page this server hosts.' }],
  contextFiles: [],
  scratch: '/tmp/tagma-scratch/turn-context',
};
const reader = { harness: 'test', key: 'reader' };

const setup = Effect.fnUntraced(function* (demo: EffectDemo) {
  const { graph, projectId } = demo;
  const records = yield* makeThreadRecords;
  const { store, threads } = yield* threadStack({ db: graph.store.db, units: graph.units, records, kinds: CORE_KINDS });
  const threadId = yield* graph.units.write('turnContext', (tx) =>
    Effect.gen(function* () {
      const thread = yield* store.insert({ ownerId: 'operator', agentId: 'tagma' }, tx);
      yield* threads.rows.attachFacet({ threadId: thread.id, projectId }, tx);
      return thread.id;
    }),
  );
  let written: readonly string[] = [];
  let history: Message[] = [];
  let turn = 0;
  const nextTurn = Effect.fnUntraced(function* () {
    turn += 1;
    const context = yield* nativeTurnContext({
      threads: threads.rows,
      graph: demo.context,
      threadId,
      runId: `run-${turn}`,
      history,
      digest: true,
      session: reader,
      written: Effect.sync(() => written),
      sections: worldStateSections(noWorld),
    });
    const commit = context?.commit;
    if (commit !== undefined) yield* graph.units.write('turnContext.nextTurn', commit);
    if (context !== null) history.push(context.message);
    return context;
  });
  return {
    nextTurn,
    threads,
    threadId,
    rewind: () => {
      history = [];
    },
    takeOut: (at: number) => {
      history.splice(at, 1);
    },
    wrote: (paths: readonly string[]) => {
      written = paths;
    },
  };
});

function contextText(context: Effect.Success<ReturnType<typeof nativeTurnContext>>): string {
  if (context === null) throw new Error('The turn carried no graph context.');
  return context.message.content.map((part) => (part.type === 'text' ? part.text : '')).join('');
}

layer(demoGraphLayer().pipe(Layer.provideMerge(BunFileSystem.layer)), { excludeTestServices: true })('turn context', (it) => {
  it.effect('the first turn orients, and a turn with nothing new carries no context at all', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const { nextTurn } = yield* setup(demo);
        const first = yield* nextTurn();
        expect(first?.parts?.map((part) => part.name)).toEqual(['Workspace', 'Graph']);
        expect(first?.entry?.type).toBe('context');
        expect(yield* nextTurn()).toBeNull();
      }),
    ),
  );

  it.effect('a turn whose told context a rewind took out of the history is told the world and the graph again', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const { nextTurn, rewind } = yield* setup(demo);
        yield* nextTurn();
        rewind();
        const again = yield* nextTurn();
        expect(again?.parts?.map((part) => part.name)).toEqual(['Workspace', 'Graph']);
        expect(yield* nextTurn()).toBeNull();
      }),
    ),
  );

  it.effect(
    'a later turn taken back un-tells only what it told: the workspace and the graph map stay told, its graph change is told again',
    () =>
      withDemo((demo) =>
        Effect.gen(function* () {
          const { nextTurn, takeOut } = yield* setup(demo);
          const first = yield* nextTurn();
          const task = yield* demo.graph.blocks.create({
            projectId: demo.projectId,
            parentId: demo.root,
            tags: ['task'],
            title: 'взятая задача',
          });
          yield* demo.graph.tasks.claim({ id: task.id });
          expect((yield* nextTurn())?.parts?.map((part) => part.name)).toEqual(['Graph']);
          takeOut(-1);
          const again = yield* nextTurn();
          expect(again?.parts?.map((part) => part.name)).toEqual(['Graph']);
          expect(contextText(again)).toContain(yield* demo.nameOf(task.id));
          expect(again?.message.metadata?.graph).toMatchObject({ from: (first?.message.metadata?.graph as { through: number }).through });
          expect(yield* nextTurn()).toBeNull();
        }),
      ),
  );

  it.effect('graph events a turn taken out of the middle told are told again after a later turn that retold them is taken back too', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const { nextTurn, takeOut } = yield* setup(demo);
        const first = yield* nextTurn();
        const claimed = Effect.fnUntraced(function* (title: string) {
          const task = yield* demo.graph.blocks.create({ projectId: demo.projectId, parentId: demo.root, tags: ['task'], title });
          yield* demo.graph.tasks.claim({ id: task.id });
          return yield* demo.nameOf(task.id);
        });
        const middle = yield* claimed('задача среднего хода');
        yield* nextTurn();
        yield* claimed('задача позднего хода');
        yield* nextTurn();
        takeOut(1);
        yield* nextTurn();
        takeOut(-1);
        const again = yield* nextTurn();
        expect(again?.message.metadata?.graph).toMatchObject({ from: (first?.message.metadata?.graph as { through: number }).through });
        expect(contextText(again)).toContain(middle);
      }),
    ),
  );

  it.effect('the turn names the sections it composed, so nothing has to read the message back', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const { nextTurn } = yield* setup(demo);
        const first = yield* nextTurn();
        expect(first?.parts?.map((part) => part.name)).toEqual(['Workspace', 'Graph']);
        const chars = first?.parts?.reduce((sum, part) => sum + part.chars, 0) ?? 0;
        expect(chars).toBeGreaterThan(0);
        expect(chars).toBeLessThan(contextText(first).length);
        const task = yield* demo.graph.blocks.create({
          projectId: demo.projectId,
          parentId: demo.root,
          tags: ['task'],
          title: 'a fresh task',
        });
        yield* demo.graph.tasks.claim({ id: task.id });
        expect((yield* nextTurn())?.parts?.map((part) => part.name)).toEqual(['Graph']);
      }),
    ),
  );

  it.effect('a change in the graph reaches the next turn once, and only the change', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const { nextTurn } = yield* setup(demo);
        yield* nextTurn();
        const task = yield* demo.graph.blocks.create({
          projectId: demo.projectId,
          parentId: demo.root,
          tags: ['task'],
          title: 'свежая задача',
        });
        yield* demo.graph.tasks.claim({ id: task.id });
        const changed = contextText(yield* nextTurn());
        expect(changed).toContain(`${yield* demo.nameOf(task.id)} [#task/in_work] свежая задача`);
        expect(yield* nextTurn()).toBeNull();
      }),
    ),
  );

  it.effect('another session’s change is told by line only where it reaches the reader’s own work; the rest is counted in one line', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const { graph, projectId, root } = demo;
        const { nextTurn } = yield* setup(demo);
        yield* nextTurn();
        const mine = yield* demo.as(
          'reader',
          graph.blocks.create({ projectId, parentId: root, tags: ['idea'], title: 'what the reader wrote' }),
        );
        const task = yield* graph.blocks.create({ projectId, parentId: root, tags: ['task'], title: 'the reader’s task' });
        yield* demo.as('reader', graph.tasks.claim({ id: task.id }));
        yield* nextTurn();
        yield* demo.as('peer', graph.blocks.update({ id: mine.id, title: 'what the reader wrote, retitled' }));
        yield* demo.as('peer', graph.blocks.update({ id: task.id, body: 'the peer moved it' }));
        yield* demo.as('peer', graph.blocks.create({ projectId, parentId: root, tags: ['idea'], title: 'far away' }));
        yield* demo.as('peer', graph.blocks.create({ projectId, parentId: root, tags: ['idea'], title: 'further away' }));
        const told = contextText(yield* nextTurn());
        expect(told).toContain(yield* demo.nameOf(mine.id));
        expect(told).toContain(yield* demo.nameOf(task.id));
        expect(told).not.toContain('far away');
      }),
    ),
  );

  it.effect('the reader’s own writes never come back to it', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const { nextTurn } = yield* setup(demo);
        yield* nextTurn();
        yield* demo.as(
          'reader',
          demo.graph.blocks.create({ projectId: demo.projectId, parentId: demo.root, tags: ['idea'], title: 'written here' }),
        );
        expect(yield* nextTurn()).toBeNull();
      }),
    ),
  );

  it.effect('a block over a file the reader wrote is the reader’s, whoever changed it', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const { nextTurn, wrote } = yield* setup(demo);
        const files = yield* FileSystem.FileSystem;
        yield* files.makeDirectory(join(demo.demoRoot, 'src'), { recursive: true });
        yield* files.writeFileString(join(demo.demoRoot, 'src', 'mine.ts'), 'export const mine = 1;\n');
        yield* nextTurn();
        wrote(['src/mine.ts']);
        const claim = yield* demo.as(
          'peer',
          demo.graph.blocks.create({
            projectId: demo.projectId,
            parentId: demo.root,
            tags: ['idea'],
            title: 'over the reader’s file',
            sources: [{ kind: 'file', ref: 'src/mine.ts' }],
          }),
        );
        expect(contextText(yield* nextTurn())).toContain(yield* demo.nameOf(claim.id));
      }),
    ),
  );

  it.effect('an agent without the graph is told the world and nothing of the graph, and its cursor never moves', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const { graph, projectId, root } = demo;
        const { threads, threadId } = yield* setup(demo);
        const before = yield* threads.rows.graphCursor(threadId);
        const task = yield* graph.blocks.create({ projectId, parentId: root, tags: ['task'], title: 'невидимая задача' });
        yield* graph.tasks.claim({ id: task.id });
        const first = yield* nativeTurnContext({
          threads: threads.rows,
          graph: demo.context,
          threadId,
          runId: 'run-without-graph-1',
          history: [],
          digest: false,
          session: reader,
          written: Effect.succeed([]),
          sections: worldStateSections(noWorld),
        });
        if (first === null) return yield* Effect.die('The first turn carries the world note.');
        const commit = first.commit;
        if (commit !== undefined) yield* graph.units.write('turnContext', commit);
        expect(first.parts?.map((part) => part.name)).toEqual(['Workspace']);
        expect(contextText(first)).not.toContain('невидимая задача');
        expect(yield* threads.rows.graphCursor(threadId)).toEqual(before);
        const second = yield* nativeTurnContext({
          threads: threads.rows,
          graph: demo.context,
          threadId,
          runId: 'run-without-graph-2',
          history: [first.message],
          digest: false,
          session: reader,
          written: Effect.succeed([]),
          sections: worldStateSections(noWorld),
        });
        expect(second).toBeNull();
      }),
    ),
  );
});
