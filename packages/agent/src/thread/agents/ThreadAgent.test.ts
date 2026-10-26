import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { builtinMode } from '../../agent/testing/modes';
import { Cause, Deferred, Effect, Exit, Schema, Stream } from 'effect';
import { Agent } from '../../agent/Agent';
import { agentScope, type AgentScope } from '../../agent/AgentScope';
import { stepLimit } from '../../agent/AgentStep';
import type { AgentContext } from '../../agent/AgentContext';
import { type AgentRunner, makeAgentRunner } from '../../agent/AgentRunner';
import { RunStop } from '../../agent/RunStop';
import type { ModelRequest } from '../../agent/modelPort';
import type { ToolCatalog } from '../../agent/ToolCatalog';
import type { AgentHostFailed } from '../../agent/AgentFailure';
import { makeAgentCalls } from '../../agent/AgentCalls';
import type { ThreadToolSource } from '../ThreadPorts';
import type { ThreadSupplyPlan } from './supply';
import type { AgentToolOutputs } from '../../agent/ToolOutput';
import type { ThreadContextEvidence } from '../rows';
import { Tool } from '../../agent/tool';
import { threadAgent } from './ThreadAgent';
import type {
  ThreadContextPreparation,
  ThreadPrepareInput,
  ThreadRunInput,
  ThreadToolContextInput,
  ThreadContextUse,
  ThreadView,
} from './ThreadAgent';
import { ASKS_NEVER } from '../../permissions/vocabulary';
import { NATIVE_CAPABILITIES } from '../record';
describe('threadAgent', () => {
  it.effect(
    'a catalog admits context tools but refuses one that shadows a declared tool',
    Effect.fnUntraced(function* () {
      const plug = threadAgent({
        agent: probeAgent,
        runner: yield* unusedRunner,
        runPolicy: { userStartable: true, backgroundStartable: false },
        context: () => Effect.succeed({ library: 'documents' }),
      });
      const supply = planOf([{ id: 'library', tools: { read_documents: readTool } }]);
      expect(Object.keys(yield* plug.toolCatalog({ ...toolInput(), supply })).sort()).toEqual(['read_documents', 'recall']);
      const exit = yield* Effect.exit(
        plug.toolCatalog({ ...toolInput(), supply: planOf([{ id: 'library', tools: { recall: readTool } }]) }),
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit))
        expect(Cause.squash(exit.cause)).toMatchObject({ _tag: 'CatalogNameCollision', tool: 'recall', first: 'probe', second: 'library' });
    }),
  );
});
describe('a prepared run', () => {
  it.effect(
    'a copied hosted handle restores a re-enabled capability beyond the saved context tool snapshot',
    Effect.fnUntraced(function* () {
      let enabled = false;
      const plug = threadAgent({
        agent: probeAgent,
        runner: yield* makeAgentRunner({ models: { request: () => silentModel }, idleMs: 30_000 }),
        runPolicy: { userStartable: true, backgroundStartable: false },
        context: () => Effect.succeed({ library: 'documents' }),
        catalogRevision: () => String(enabled),
      });
      const supply: ThreadSupplyPlan = {
        sources: () => {
          const tools: ToolCatalog = enabled ? { lookup: deferredTool } : {};
          return Effect.succeed([{ id: 'library', tools }]);
        },
        outputTools: {},
        restored: ['recall'],
      };
      const given = { ...runInput(undefined), supply };
      const prepared = yield* plug.prepare(given);
      const hosted = { ...(yield* prepared.host!({ ...given, toolOutputs: inertToolOutputs })) };
      expect(deferredOf(hosted.catalog())).toEqual([]);
      enabled = true;
      yield* hosted.refresh();
      expect(deferredOf(hosted.catalog())).toEqual(['lookup']);
      enabled = false;
      yield* hosted.refresh();
      expect(deferredOf(hosted.catalog())).toEqual([]);
      yield* hosted.close();
    }),
  );

  it.effect(
    'builds its context and resolves its sources once on the native and the hosted road, and every turn names the deferred tools of the run catalog',
    Effect.fnUntraced(function* () {
      const runner = yield* makeAgentRunner({ models: { request: () => silentModel }, idleMs: 30_000 });
      for (const road of ['native', 'hosted'] as const) {
        const built = { contexts: 0, resolutions: 0 };
        const named: string[][] = [];
        const plug = threadAgent({
          agent: probeAgent,
          runner,
          runPolicy: { userStartable: true, backgroundStartable: false },
          context: () => Effect.sync(() => ((built.contexts += 1), { library: 'documents' })),
          turnContext: (_ctx, input) => Effect.sync(() => (named.push(deferredOf(input.catalog)), null)),
        });
        const supply: ThreadSupplyPlan = {
          sources: () => Effect.sync(() => ((built.resolutions += 1), [{ id: 'library', tools: { lookup: deferredTool } }])),
          outputTools: {},
        };
        const given = { ...runInput(undefined), supply };
        const prepared = yield* plug.prepare(given);
        yield* prepared.orient(probeThread);
        const run = road === 'native' ? yield* prepared.start(given) : yield* prepared.host!({ ...given, toolOutputs: inertToolOutputs });
        if (road === 'hosted') yield* prepared.orient(probeThread);
        expect(built).toEqual({ contexts: 1, resolutions: 1 });
        expect(deferredOf(typeof run.catalog === 'function' ? run.catalog() : run.catalog)).toEqual(['lookup']);
        expect(named).toEqual(road === 'native' ? [['lookup']] : [['lookup'], ['lookup']]);
        yield* run.close();
      }
    }),
  );
});
describe('threadAgent at a context boundary', () => {
  it.effect(
    'the admitted scope is built from the destination, and the evidence names what it can reach',
    Effect.fnUntraced(function* () {
      const asked: ThreadContextUse[] = [];
      const published: {
        stepNumber: number;
        evidence: ThreadContextEvidence;
      }[] = [];
      const opened = yield* startedRun({
        context: (_thread, use) => {
          asked.push(use);
          return Effect.succeed({ library: use.context === null ? 'documents' : 'archive' });
        },
        prepared: preparation({
          contributions: [{ id: 'library', tools: { open_tree: readTool, read_archive: readTool } }],
          keepTools: ['recall', 'open_tree'],
          publish: (admitted) =>
            Effect.sync(() => {
              published.push(admitted);
              return true;
            }),
        }),
      });
      const next = yield* opened.boundary(2);
      expect(asked.map((use) => use.context)).toEqual([null, { generation: 1, sourceKey: 'tree-b', requestId: 'req-1' }]);
      expect(next.generation).toBe(1);
      expect(next.model.instructions).toBe('Answer from archive.\n\nThe tree speaks.');
      expect(next.model.model).toBe(opened.scope.model.model);
      expect(Object.keys(next.catalog).sort()).toEqual(['open_tree', 'recall']);
      expect(
        published.map(({ stepNumber, evidence }) => ({ stepNumber, evidence: { ...evidence, tools: [...evidence.tools].sort() } })),
      ).toEqual([
        {
          stepNumber: 2,
          evidence: {
            instructions: 'Answer from archive.\n\nThe tree speaks.',
            tools: ['open_tree', 'recall'],
            profileId: null,
            approvalMode: 'review',
          },
        },
      ]);
    }),
  );
  it.effect(
    'a restored generation is rebuilt on its published bytes',
    Effect.fnUntraced(function* () {
      const opened = yield* startedRun({
        context: (_thread, use) => Effect.succeed({ library: use.context === null ? 'documents' : 'archive' }),
        prepared: preparation({ instructions: 'Answer from the tree as it was.', keepTools: ['recall'] }),
      });
      const next = yield* opened.boundary(0);
      expect(next.model.instructions).toBe('Answer from the tree as it was.');
      expect(next.generation).toBe(1);
      expect(Object.keys(next.catalog)).toEqual(['recall']);
    }),
  );
  it.effect(
    'an unresolved destination is denied whole and leaves the run’s scope unchanged',
    Effect.fnUntraced(function* () {
      const gone = new Error('The destination is gone.');
      const published: unknown[] = [];
      const denied: unknown[] = [];
      const opened = yield* startedRun({
        context: (_thread, use) => (use.context === null ? Effect.succeed({ library: 'documents' }) : Effect.fail(gone)),
        prepared: preparation({
          publish: (admitted) =>
            Effect.sync(() => {
              published.push(admitted);
              return true;
            }),
          deny: (cause) =>
            Effect.sync(() => {
              denied.push(cause);
            }),
        }),
      });
      expect(yield* opened.boundary(2)).toBe(opened.scope);
      expect(published).toEqual([]);
      expect(denied).toEqual([gone]);
    }),
  );
  it.effect(
    'a refused publication leaves the run in the scope it had',
    Effect.fnUntraced(function* () {
      const denied: unknown[] = [];
      const opened = yield* startedRun({
        context: (_thread, use) => Effect.succeed({ library: use.context === null ? 'documents' : 'archive' }),
        prepared: preparation({
          publish: () => Effect.succeed(false),
          deny: (cause) =>
            Effect.sync(() => {
              denied.push(cause);
            }),
        }),
      });
      expect(yield* opened.boundary(2)).toBe(opened.scope);
      expect(denied).toEqual([]);
    }),
  );
});
const silentModel: ModelRequest = {
  plannedOutputTokens: 1,
  text: () => Effect.die(new Error('The run asks no text.')),
  object: () => Effect.die(new Error('The run asks no object.')),
  stream: () => Stream.never,
};
const deferredTool = Tool.make({
  display: () => ({ form: 'none' }),
  approval: ASKS_NEVER,
  description: 'Look an entry up.',
  parameters: Schema.Struct({}),
  exposure: 'deferred',
  execute: () => Effect.succeed('found'),
});
const deferredOf = (catalog: ToolCatalog): string[] =>
  Object.entries(catalog)
    .flatMap(([name, tool]) => (tool.exposure === 'deferred' ? [name] : []))
    .sort();
const unusedRunner = Effect.map(makeAgentCalls({ history: 1 }), (calls): AgentRunner => ({
  calls,
  run: () => Effect.die('No run is driven here.'),
  host: () => Effect.die('No host is opened here.'),
}));
type Opened = {
  readonly scope: AgentScope;
  readonly boundary: (stepNumber: number) => Effect.Effect<AgentScope, AgentHostFailed>;
};
const startedRun = Effect.fnUntraced(function* (over: {
  context: (thread: ThreadView, use: ThreadContextUse) => Effect.Effect<ProbeContext, Error>;
  prepared: ThreadContextPreparation;
}) {
  const captured = yield* Deferred.make<Opened>();
  const runner: AgentRunner = {
    ...(yield* unusedRunner),
    run: (_agent, input) => {
      const boundary = input.boundary;
      if (!boundary) return Effect.die('The thread adapter supplied no boundary.');
      const scope = agentScope({
        generation: 0,
        ctx: input.ctx,
        model: { ...input.model, instructions: 'Answer from documents.' },
        resolved: { catalog: {}, withheld: [] },
      });
      return Deferred.succeed(captured, { scope, boundary: (stepNumber) => boundary({ stepNumber, scope }) }).pipe(
        Effect.andThen(Effect.never),
      );
    },
  };
  const plug = threadAgent({
    agent: probeAgent,
    runner,
    runPolicy: { userStartable: true, backgroundStartable: false },
    context: over.context,
  });
  const given = runInput(() => Effect.succeed(over.prepared));
  yield* Effect.forkScoped(Effect.flatMap(plug.prepare(given), (prepared) => prepared.start(given)));
  return yield* Deferred.await(captured);
});
function planOf(sources: readonly ThreadToolSource[], restored?: readonly string[]): ThreadSupplyPlan {
  return { sources: () => Effect.succeed(sources), outputTools: {}, restored };
}
function preparation(over: {
  contributions?: readonly ThreadToolSource[];
  keepTools?: readonly string[];
  instructions?: string;
  publish?: ThreadContextPreparation['publish'];
  deny?: ThreadContextPreparation['deny'];
}): ThreadContextPreparation {
  return {
    context: { generation: 1, sourceKey: 'tree-b', requestId: 'req-1' },
    supply: planOf([...(over.contributions ?? []), { id: 'tree', tools: {}, prompt: 'The tree speaks.' }], over.keepTools),
    instructions: over.instructions,
    publish: over.publish ?? (() => Effect.succeed(true)),
    deny: over.deny ?? (() => Effect.void),
  };
}
function runInput(boundary: ThreadRunInput['boundary']): ThreadRunInput & ThreadPrepareInput {
  return {
    thread: probeThread,
    sink: { push: () => Effect.void },
    run: probeRun,
    stop: new RunStop(),
    model: { ownerId: 'owner-1', provider: 'openai', model: 'a-model', reasoning: null, switches: {} },
    modeOf: builtinMode('review'),
    messages: [],
    signals: { drain: () => Effect.succeed([]), hasPending: () => Effect.succeed(false) },
    supply: planOf([]),
    context: inertContext,
    toolOutputs: inertToolOutputs,
    boundary,
  };
}
const inertContext: AgentContext = {
  project: () => Effect.succeed({ messages: [] }),
  lower: (messages) => Effect.succeed(messages),
  observe: () => Effect.succeed(undefined),
};
const inertToolOutputs: AgentToolOutputs = {
  project: ({ output, modelOutput }) => Effect.succeed({ output, modelOutput }),
  projectMessages: (messages) => Effect.succeed(messages),
};
type ProbeContext = {
  readonly library: string;
};
const readTool = Tool.make({
  display: () => ({ form: 'none' }),
  approval: ASKS_NEVER,
  description: 'Read one entry.',
  parameters: Schema.Struct({ id: Schema.String }),
  execute: ({ id }) => Effect.succeed(id),
});
const probeAgent = new Agent<ProbeContext>({
  id: 'probe',
  name: 'Probe',
  description: 'Owns one tool.',
  instructions: (ctx) => `Answer from ${ctx.library}.`,
  tools: () => ({
    recall: Tool.make({
      display: () => ({ form: 'none' }),
      approval: ASKS_NEVER,
      description: 'Recall.',
      parameters: Schema.Struct({}),
      execute: () => Effect.succeed('recalled'),
    }),
  }),
  grant: { sources: [{ source: 'probe' }, { source: 'library' }] },
  stopWhen: [stepLimit(1)],
});
function toolInput(): ThreadToolContextInput {
  return { thread: probeThread, run: probeRun };
}
const probeThread: ThreadView = {
  id: 'thread-1',
  ownerId: 'owner-1',
  agentId: 'probe',
  hostKind: null,
  hostId: null,
  bindings: {},
  cacheGroup: 'thread-1',
  capabilities: NATIVE_CAPABILITIES,
  account: null,
  provider: 'openai',
  model: null,
  reasoning: null,
  switches: {},
  status: 'idle',
  authority: { mode: 'trust', bypassFrom: null },
  profile: null,
  contextReading: null,
  history: [],
  transcript: [],
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};
const probeRun = {
  id: 'run-1',
  status: 'running',
  account: null,
  provider: null,
  model: null,
  reasoning: null,
  switches: {},
  approvalMode: 'review',
  interactive: true,
} as const;
