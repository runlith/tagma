import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { join } from 'node:path';
import { Context, Effect, FileSystem, Layer } from 'effect';
import { type Message as ModelMessage, Message } from '@runlith/llm/schema/messages';
import { agentRuntimeGuidanceMessage } from '@runlith/agent/AgentSignal';
import type { AgentDirective, AgentRuleContext } from '@runlith/agent/AgentRuntimePolicy';
import { demoGraphLayer, withDemo, type DemoServices, type EffectDemo } from '../composition/testing/graphFixture.js';
import { Orientation, Touches } from '../graph/contract/service/orientation.js';
import type { InstructionSet } from '../graph/contract/wire/instructions.js';
import { MeasuredCheckout, ServedGraphs, type ServedGraph } from '../graph/contract/service/serving.js';
import { CheckoutPaths } from '../workspace/contract/service/checkoutPaths.js';
import { signedBy } from '../invocation/testing/call.js';
import { testSessionIdentity } from '../platform/testing/identity.js';
import { checkoutPaths, fixedCoverage } from '../workspace/testing/doubles.js';
import type { GraphOrigin } from '../threads/contract/wire/target.js';
import { touchRule, touchMarks } from './capabilities/touchRule.js';
import type { ThreadExecution } from './contract/service/execution.js';
import { makeWorkingPlaces } from '../threads/working.js';
import { makeThreadRecords } from '../thread-record/layer.js';
import type { ThreadContext } from './turns/context.js';
import { instructionRule } from './turns/instructionRule.js';
import { informedPlaces, instructionsTold } from './turns/instructions.js';
import { type Tool, toolPrepare } from '@runlith/agent/tool';
import { unruledTimes } from '@runlith/agent-tools/CommandWork';
import { CheckoutFlights } from '@runlith/agent-tools/CheckoutFlights';
import { callerInThread } from '../composition/testing/callers.js';
import { checkoutWorld, makeMachineWorld } from '../executions/testing/doubles.js';
import { testGrantSigner } from '../platform/testing/grants.js';
import { asThreadContext, CORE_KINDS, nativeThreadRows, threadStore, worldTools } from './testing/doubles.js';

const THREAD = 'thread-place-law';
const OTHER = 'thread-place-writer';
const execution = {
  touched: (ctx, at, shown) =>
    Effect.flatMap(Touches, (touches) => touches.touch({ projectId: at.projectId, shown })).pipe(
      signedBy(ctx.session),
      Effect.provide(at.graph),
    ),
} as ThreadExecution['Service'];
const lawOf = (set: unknown): string[] =>
  (set as InstructionSet).entries.flatMap((entry) => (entry.kind === 'law' ? [entry.source] : [])).sort();
const told = Effect.fnUntraced(function* (directive: Effect.Effect<AgentDirective | null, unknown>) {
  const answered = yield* directive;
  if (answered === null) return null;
  if (answered.type !== 'guide') return yield* Effect.die(`the rule answered ${answered.type}`);
  return answered;
});

const setup = Effect.fnUntraced(function* (demo: EffectDemo, copies: readonly GraphOrigin[] = []) {
  const files = yield* FileSystem.FileSystem;
  const a = { id: demo.projectId, root: demo.demoRoot };
  const b = demo.project('beta');
  const alpha: GraphOrigin = { projectId: a.id, root: yield* files.realPath(a.root) };
  const beta: GraphOrigin = { projectId: b.id, root: yield* files.realPath(b.root) };
  const homeCoverage = fixedCoverage(demo.projectId, [{ checkout: 'home', root: demo.demoRoot }]);
  const paths = yield* checkoutPaths(
    {
      ...homeCoverage,
      covered: (id) => {
        const place = [alpha, beta].find((place) => place.projectId === id);
        return place === undefined
          ? homeCoverage.covered(id)
          : fixedCoverage(
              id,
              [place, ...copies.filter((copy) => copy.projectId === id)].map((copy) => ({ checkout: copy.root, root: copy.root })),
            ).covered(id);
      },
    },
    demo.graph.projects,
  );
  const contexts = new Map<string, Context.Context<DemoServices>>();
  const served = yield* Layer.build(
    Layer.mock(ServedGraphs, {
      held: () => {
        throw new Error('the places fixture opens no graph-pool inventory');
      },
      copies: { subscribe: () => () => {} },
      resolve: ({ projectId, cwd }) =>
        Effect.succeed({
          context: contexts.get(cwd ?? '') ?? Context.add(demo.context, MeasuredCheckout, { projectId, path: cwd ?? demo.demoRoot }),
          checkout: cwd,
          fresh: () => Effect.void,
        } as unknown as ServedGraph),
    }),
  );
  const working = yield* Effect.provide(makeWorkingPlaces, Context.add(served, CheckoutPaths, paths));
  const records = yield* makeThreadRecords;
  const store = yield* threadStore(records, CORE_KINDS);
  const threads = yield* nativeThreadRows(store, records);
  const places = informedPlaces(working, threads);
  for (const id of [THREAD, OTHER])
    yield* store.insert({
      ownerId: 'owner',
      agentId: 'tagma',
      provider: 'openai-oauth',
      model: 'gpt-test',
      reasoning: 'high',
      authority: { mode: 'trust', bypassFrom: null },
      status: 'idle',
      id,
      cacheGroup: id,
      name: id,
    });
  const context = (hook: 'beforeStep' | 'afterTool', messages: readonly ModelMessage[], shown: readonly string[] = [], id = THREAD) =>
    ({
      hook,
      modelMessages: messages,
      tool:
        hook === 'afterTool'
          ? { name: 'read', input: {}, toolCallId: 'call-1', shown: shown.map((path) => ({ path, as: 'read' })) }
          : undefined,
      thread: { id, transcript: [] },
      graph: Effect.succeed(demo.context),
      graphRoot: alpha.root,
      target: { graph: alpha },
      projectId: alpha.projectId,
      world: { facts: { shared: true }, root: alpha.root },
      places,
      session: { harness: 'tagma', key: id },
      execution,
      identity: testSessionIdentity,
    }) as unknown as AgentRuleContext<ThreadContext>;
  return { alpha, beta, places, context, store, contexts };
});

const toolsAt = (alpha: GraphOrigin, places: Effect.Success<ReturnType<typeof setup>>['places']) =>
  worldTools(
    asThreadContext({
      thread: { id: OTHER, model: null, authority: { mode: 'trust', bypassFrom: null } },
      world: checkoutWorld({ projectRoot: alpha.root, scratch: join(alpha.root, '.scratch'), world: makeMachineWorld(() => null) }),
      projectId: alpha.projectId,
      projectRoot: alpha.root,
      origin: null,
      settings: { value: () => Effect.succeed('shared') },
      commandTimes: unruledTimes,
      identity: testSessionIdentity,
      grants: testGrantSigner,
      changeRecord: { changes: () => ({}) },
      checkoutFlights: new CheckoutFlights(),
      comments: () => 'allowed',
      places,
    }),
    { web: false },
  );

const graphs = demoGraphLayer({
  projects: ['beta'],
  prepareEffect: Effect.fnUntraced(function* (demo) {
    const beta = demo.project('beta');
    const files = yield* FileSystem.FileSystem;
    yield* files.makeDirectory(join(beta.root, 'src'), { recursive: true });
    yield* files.writeFileString(join(beta.root, 'src', 'b.ts'), 'export const b = 1;\n');
    const parent = (yield* demo.graph.blocks.rootBlockOf(beta.id)).id;
    yield* demo.graph.blocks.writeModules(beta.id, [{ id: 'beta-src', title: 'beta source', parent, root: 'src' }], []);
  }),
}).pipe(Layer.provideMerge(BunFileSystem.layer));

layer(graphs, { excludeTestServices: true })('working places and their law', (it) => {
  it.effect('a thread works in another project under that project’s law, beside its home law, through change and compaction', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const { alpha, beta, places, context } = yield* setup(demo);
        const rule = (projectId: number, title: string) => demo.graph.blocks.create({ projectId, tags: ['rule'], title });
        const home = yield* rule(alpha.projectId, 'Alpha law');
        const wide = yield* rule(beta.projectId, 'Beta law');
        const region = yield* demo.graph.graphScopes.zoneByPlace(beta.projectId, 'src');
        if (region === undefined) return yield* Effect.die('the beta source module was not prepared');
        const regional = yield* demo.graph.blocks.create({
          projectId: beta.projectId,
          tags: ['rule'],
          title: 'Beta source law',
          parentId: region.id,
          sources: [{ kind: 'dir', ref: 'src' }],
        });
        const instructions = instructionRule(() => 'graph');
        const touch = touchRule(touchMarks(), () => 'graph');
        const history: ModelMessage[] = [Message.user('Work.')];
        const step = Effect.fnUntraced(function* () {
          const guide = yield* told(instructions(context('beforeStep', history)));
          if (guide !== null) history.push(agentRuntimeGuidanceMessage(guide.text, guide.state));
          return guide?.state ?? {};
        });
        const opened = yield* step();
        expect(Object.keys(opened)).toEqual([instructionsTold(alpha.projectId)]);
        expect(lawOf(opened[instructionsTold(alpha.projectId)])).toContain(yield* demo.nameOf(home.id));
        const file = join(alpha.root, 'linked.ts');
        yield* (yield* FileSystem.FileSystem).symlink(join(beta.root, 'src', 'b.ts'), file);
        yield* places.enter({ threadId: THREAD, home: alpha.projectId, place: beta, mutates: false });
        const brief = yield* told(touch(context('afterTool', history, [file])));
        expect(brief?.text).toContain(yield* demo.nameOf(regional.id));
        const entered = yield* step();
        expect(Object.keys(entered)).toEqual([instructionsTold(beta.projectId)]);
        expect(lawOf(entered[instructionsTold(beta.projectId)])).toContain(yield* demo.nameOf(wide.id));
        expect(lawOf(entered[instructionsTold(beta.projectId)])).not.toContain(yield* demo.nameOf(home.id));
        expect(yield* step()).toEqual({});
        const later = yield* rule(beta.projectId, 'Beta later law');
        const changed = yield* step();
        expect(Object.keys(changed)).toEqual([instructionsTold(beta.projectId)]);
        expect(lawOf(changed[instructionsTold(beta.projectId)])).toContain(yield* demo.nameOf(later.id));
        history.push(
          new Message({
            role: 'user',
            content: [{ type: 'text', text: 'Summary.' }],
            compaction: { id: 'context-reset', mode: 'manual', transcriptLocation: alpha.root, preservedCount: 0 },
          }),
        );
        const restored = yield* step();
        expect(Object.keys(restored).sort()).toEqual([instructionsTold(alpha.projectId), instructionsTold(beta.projectId)].sort());
        expect(lawOf(restored[instructionsTold(beta.projectId)])).toContain(yield* demo.nameOf(later.id));
        expect(lawOf(restored[instructionsTold(alpha.projectId)])).toContain(yield* demo.nameOf(home.id));
        expect(yield* told(touch(context('afterTool', history, ['/nowhere/at/all.ts'])))).toBeNull();
      }),
    ),
  );

  it.effect('checkout changes reuse read law and hold mutations until differing instructions reach the thread', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const files = yield* FileSystem.FileSystem;
        const project = demo.project('beta');
        const copy = { projectId: project.id, root: join(yield* files.realPath(project.root), 'worktree') };
        yield* files.makeDirectory(copy.root);
        const { alpha, beta, places, context, store, contexts } = yield* setup(demo, [copy]);
        const common = yield* demo.graph.blocks.create({ projectId: beta.projectId, tags: ['rule'], title: 'Shared norm' });
        const changed = yield* demo.graph.blocks.create({ projectId: beta.projectId, tags: ['rule'], title: 'Original norm' });
        const name = yield* demo.nameOf(changed.id);
        const commonName = yield* demo.nameOf(common.id);
        const instructions = instructionRule(() => 'graph');
        const history: ModelMessage[] = [];
        const enter = (place: GraphOrigin) => places.enter({ threadId: THREAD, home: alpha.projectId, place, mutates: true });
        expect(yield* Effect.result(enter(beta))).toMatchObject({ _tag: 'Failure', failure: { code: 'instructions-unread' } });
        const initial = yield* told(instructions(context('beforeStep', history)));
        if (initial === null) return yield* Effect.die('the initial law was not offered');
        const original = initial.state![instructionsTold(beta.projectId)] as InstructionSet;
        const record = Effect.fnUntraced(function* (guide: NonNullable<typeof initial>) {
          const message = agentRuntimeGuidanceMessage(guide.text, guide.state);
          history.push(message);
          yield* store.appendEntries(THREAD, { history: [message] });
        });
        yield* record(initial);
        let current: InstructionSet = {
          ...original,
          root: copy.root,
          entries: original.entries.map((entry) => ({ ...entry, revision: `copy-${entry.revision}` })),
        };
        contexts.set(
          copy.root,
          Context.add(demo.context, Orientation, {
            ...demo.graph.orientation,
            instructions: () => Effect.succeed(current),
          }),
        );
        yield* enter(copy);
        expect(yield* places.held(THREAD)).toEqual([copy]);
        expect(yield* told(instructions(context('beforeStep', history)))).toBeNull();
        yield* enter(beta);
        expect(yield* told(instructions(context('beforeStep', history)))).toBeNull();
        current = {
          ...current,
          entries: current.entries.map((entry) => (entry.source === name ? { ...entry, text: 'Worktree norm' } : entry)),
        };
        expect(yield* Effect.result(enter(copy))).toMatchObject({ _tag: 'Failure', failure: { code: 'instructions-unread' } });
        const delta = yield* told(instructions(context('beforeStep', history)));
        if (delta === null) return yield* Effect.die('the changed law was not offered');
        const commonText = original.entries.find((entry) => entry.source === commonName)!.text;
        expect(delta.text).toContain('Worktree norm');
        expect(delta.text).not.toContain(commonText);
        expect(yield* Effect.result(enter(copy))).toMatchObject({ _tag: 'Failure', failure: { code: 'instructions-unread' } });
        yield* record(delta);
        yield* enter(copy);
        expect(yield* Effect.result(enter(beta))).toMatchObject({ _tag: 'Failure', failure: { code: 'instructions-unread' } });
        const back = yield* told(instructions(context('beforeStep', history)));
        if (back === null) return yield* Effect.die('the original law was not offered again');
        expect(back.text).toContain(original.entries.find((entry) => entry.source === name)!.text);
        expect(back.text).not.toContain(commonText);
        yield* record(back);
        yield* enter(beta);
        current = { ...original, root: copy.root };
        yield* enter(copy);
        yield* demo.graph.blocks.update({ id: changed.id, title: 'Changed main norm' });
        expect(yield* told(instructions(context('beforeStep', history)))).toBeNull();
        expect(yield* Effect.result(enter(beta))).toMatchObject({ _tag: 'Failure', failure: { code: 'instructions-unread' } });
        const updated = yield* told(instructions(context('beforeStep', history)));
        if (updated === null) return yield* Effect.die('the changed main law was not offered');
        expect(updated.text).toContain('Changed main norm');
        yield* record(updated);
        yield* enter(beta);
        expect(yield* places.held(THREAD)).toEqual([beta]);
      }),
    ),
  );

  it.effect('a recursive delete waits for the law of another project whose checkout stands inside the removed directory', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const files = yield* FileSystem.FileSystem;
        const vendor = join(yield* files.realPath(demo.demoRoot), 'vendor');
        const copy = { projectId: demo.project('beta').id, root: join(vendor, 'beta') };
        yield* files.makeDirectory(copy.root, { recursive: true });
        const { alpha, places } = yield* setup(demo, [copy]);
        const removal = yield* Effect.result(
          toolPrepare(toolsAt(alpha, places).delete as Tool)!(
            { args: ['-r', vendor], glob: false },
            { toolCallId: 'call-delete', caller: callerInThread(OTHER, 'run-1') },
          ),
        );
        expect(removal._tag === 'Failure' && removal.failure.code).toBe('instructions-unread');
        expect(yield* places.held(OTHER)).toEqual([copy]);
      }),
    ),
  );

  it.effect('foreign mutations wait for recorded project law across parallel calls and reads in one step', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const { alpha, beta, places, context, store } = yield* setup(demo);
        const tools = toolsAt(alpha, places);
        const prepared = (tool: string, thread: string, input: unknown) =>
          Effect.result(toolPrepare(tools[tool] as Tool)!(input, { toolCallId: `call-${tool}`, caller: callerInThread(thread, 'run-1') }));
        const write = (thread: string, path: string) => prepared('write', thread, { path, content: 'export {};\n' });
        const target = join(beta.root, 'src', 'new.ts');
        expect((yield* write(OTHER, join(alpha.root, 'home.ts')))._tag).toBe('Success');
        const link = join(alpha.root, 'linked.ts');
        yield* (yield* FileSystem.FileSystem).symlink(join(beta.root, 'src', 'b.ts'), link);
        expect((yield* prepared('delete', OTHER, { args: [link], glob: false }))._tag).toBe('Success');
        expect((yield* prepared('rename', OTHER, { from: link, to: join(alpha.root, 'moved.ts') }))._tag).toBe('Success');
        expect(yield* places.held(OTHER)).toEqual([]);
        const parallel = yield* Effect.all([write(OTHER, link), write(OTHER, target)], { concurrency: 2 });
        expect(parallel.map((result) => result._tag === 'Failure' && result.failure.code)).toEqual([
          'instructions-unread',
          'instructions-unread',
        ]);
        expect(yield* places.held(OTHER)).toEqual([beta]);
        expect((yield* prepared('read', THREAD, { path: link }))._tag).toBe('Success');
        expect(yield* places.held(THREAD)).toEqual([beta]);
        const unread = yield* write(THREAD, target);
        expect(unread._tag === 'Failure' && unread.failure.code).toBe('instructions-unread');
        const instructions = instructionRule(() => 'graph');
        for (const id of [THREAD, OTHER]) {
          const guide = yield* told(instructions(context('beforeStep', [], [], id)));
          if (guide === null) return yield* Effect.die('the foreign law was not offered');
          const pending = yield* write(id, target);
          expect(pending._tag === 'Failure' && pending.failure.code).toBe('instructions-unread');
          yield* store.appendEntries(id, { history: [agentRuntimeGuidanceMessage(guide.text, guide.state)] });
          expect((yield* write(id, target))._tag).toBe('Success');
        }
        yield* store.appendEntries(THREAD, {
          history: [
            new Message({
              role: 'user',
              content: [{ type: 'text', text: 'Summary.' }],
              compaction: { id: 'law-reset', mode: 'manual', transcriptLocation: alpha.root, preservedCount: 0 },
            }),
          ],
        });
        const reset = yield* write(THREAD, target);
        expect(reset._tag === 'Failure' && reset.failure.code).toBe('instructions-unread');
        expect((yield* write(OTHER, target))._tag).toBe('Success');
        const global = yield* demo.graph.projects.global();
        if (global === undefined) return yield* Effect.die('the global project was not registered');
        const enteringGlobal = yield* Effect.result(
          places.enter({
            threadId: OTHER,
            home: alpha.projectId,
            place: { projectId: global.id, root: global.rootPath },
            mutates: true,
          }),
        );
        expect(enteringGlobal).toMatchObject({ _tag: 'Failure', failure: { code: 'instructions-unread' } });
        expect((yield* places.held(OTHER)).map((place) => place.projectId)).toEqual([beta.projectId, global.id]);
      }),
    ),
  );
});
