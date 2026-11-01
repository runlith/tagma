import { Deferred, Effect, Exit, Layer, Schema, Scope, Stream } from 'effect';
import { approvalModesLayer } from '../../modes/ApprovalModes';
import { InvalidRequestReason, LLMError, StreamStalledReason } from '@runlith/llm/schema/errors';
import { LLMResponse, Usage, type LLMEvent } from '@runlith/llm/schema/events';
import { Message } from '@runlith/llm/schema/messages';
import { ModelID, ProviderID } from '@runlith/llm/schema/ids';
import { ModelIdentity } from '@runlith/llm/schema/options';
import { modelCatalog } from '@runlith/llm/models/catalog';
import { DEFAULT_PROVIDER_DESCRIPTIONS } from '@runlith/builtin-catalog/descriptions';
import { Agent } from '../../agent/Agent';
import type { CallHooks } from '../../agent/AgentCalls';
import { agentRule } from '../../agent/policy/AgentRuntimePolicy';
import { SUB_AGENT_DEPTH } from '../../collaboration/CollaborationConfig';
import { makeAgentRunner } from '../../agent/AgentRunner';
import { Tool } from '../../agent/tool';
import type { ModelOneShotInput, ModelRequest, ModelRequester } from '../../agent/modelPort';
import type { ThreadCompactionEntry } from '../../transcript/entries';
import type { ThreadTranscriptEntry } from '../../transcript/rows';
import type { ThreadAttachmentStorage } from '../attachmentStorage';
import { AgentHarness } from '../AgentHarness';
import { threadAgent } from '../agents/ThreadAgent';
import { registeredAgents } from './agents';
import { grantOf } from './runLog/world';
import type { CompactionModels } from '../compaction/CompactionModels';
import { makeThreadCompaction } from '../run/ThreadCompaction';
import { threadAgentsLayer, threadCompactorLayer, threadFeaturesLayer, threadStorageLayer } from '../kernelPorts';
import type { ThreadSummarizerAsk, ThreadSummarizers } from '../compaction/summarizer';
import { makeThreadDigestStrategy } from '../compaction/digestStrategy';
import type { ThreadCompactionPolicy } from '../compaction/policy';
import { makeThreadSummaryStrategy, type ThreadCompactionPrompt } from '../compaction/summaryStrategy';
import type { ThreadCompactionText } from '../compaction/text';
import { makeThreadLiveFeed } from '../run/ThreadLiveFeed';
import type { ThreadRunLeaseRhythm, ThreadRunReaperRhythm, ThreadSettlementOutboxRhythm } from '../ThreadPorts';
import type { ThreadSnapshot } from '../state';
import { ThreadCallBroke } from '../ThreadBorder';
import { threadHostLayer } from '../ThreadPorts';
import type { ThreadToolOutputStorage } from '../toolOutputs';
import type { ThreadStorageFactory, ThreadStorageHarness } from './storagePort';
import type { ApproversPort } from '../Approvers';
import { ThreadEntryKinds } from '../../transcript/kinds';
import { ASKS_IN_REVIEW, ASKS_NEVER } from '../../permissions/vocabulary';
import { until as waitUntil } from './runLog/support';
export const OWNER = 'owner';
export const SCOPE = 'scope-a';
const RHYTHM: ThreadRunLeaseRhythm & ThreadRunReaperRhythm & ThreadSettlementOutboxRhythm = {
  heartbeatIntervalMs: 30_000,
  staleRunningAfterMs: 30_000,
  takeoverAfterMs: 0,
  staleSweepIntervalMs: 30_000,
  settledClaimAfterMs: 30_000,
  settledHeartbeatIntervalMs: 30_000,
  settledNotificationBatch: 1,
  recoveryBatch: 1,
  resumeWithinMs: 20 * 60_000,
  resumeAttemptLimit: 1,
  settledNotifyAttemptLimit: 1,
};
const POLICY: ThreadCompactionPolicy = {
  compactionTrigger: { strategy: 'percent', trigger: 0.9 },
  compactionOverrides: [],
  bufferTokens: 2_000,
  imageTokens: 0,
  maxRecentTokens: 150,
  minRecentTokens: 50,
  maxOpeningTokens: 1_000,
  recentFraction: 0.1,
  recentUserTurns: 2,
  toolPruneProtectShare: 0.5,
};
const PROMPT: ThreadCompactionPrompt = { instructions: 'Summarize the thread segment.', template: 'Use exactly these sections:\n## State' };
export const TEXT: ThreadCompactionText = {
  checkpointMarker: 'Continue from the anchored thread state below.',
  prunedToolOutput: '[Old tool result content cleared]',
  overflowMediaGuidance: 'Attached media was omitted from this retry.',
  omittedMedia: (mediaType) => `[Attached ${mediaType ?? 'media'} omitted.]`,
};
export const EARLIER = `The plan: ${'every step of the earlier answer, spelled out at length. '.repeat(45)}`;
export const BRIEF = `Do the work behind PARSE-17: ${'keep every constraint of this brief exactly as written. '.repeat(18)}`.trim();
export const SUMMARY = `## State\n${'The earlier answer set the plan, its constraints and the files it touches. '.repeat(4).trim()}`;
export type Hold = {
  readonly reached: Effect.Effect<void>;
  arrive(): Effect.Effect<void>;
  release(): void;
};
export function hold(): Hold {
  const reached = Deferred.makeUnsafe<void>();
  const released = Deferred.makeUnsafe<void>();
  return {
    reached: Deferred.await(reached),
    arrive: () => Effect.andThen(Deferred.succeed(reached, undefined), Deferred.await(released)),
    release: () => {
      Deferred.doneUnsafe(released, Effect.void);
    },
  };
}
export type Answer =
  | {
      readonly text: string;
      readonly held?: Hold;
    }
  | {
      readonly tool: 'work';
      readonly held?: Hold;
    }
  | {
      readonly call: string;
      readonly input: Record<string, unknown>;
      readonly held?: Hold;
    }
  | {
      readonly parks: Hold;
      readonly opens?: 'reasoning' | 'text';
    }
  | {
      readonly stalls: true;
    };
type Summary =
  | {
      readonly summary: string;
      readonly held?: Hold;
    }
  | {
      readonly fails: string;
    }
  | {
      readonly stalls: Hold;
    };
type Script = {
  readonly answers: Answer[];
  readonly lanes: Map<string, Answer[]>;
  readonly heard: Map<string, (readonly Message[])[]>;
  readonly models: Map<string, (string | null)[]>;
  readonly summaries: Summary[];
  readonly requests: (readonly Message[])[];
  readonly prompts: string[];
  readonly summarizedBy: string[];
  readonly summarizerAsks: ThreadSummarizerAsk[];
  readonly guides: string[];
  readonly outputs: string[];
  summarized: number;
  summarizers: ThreadSummarizers;
  tool: Hold | null;
};
export type CompactionWorld<TTx, TWrite extends TTx = TTx> = Script & {
  readonly harness: AgentHarness<ThreadSnapshot, TTx, TWrite>;
  dispose(): Effect.Effect<void>;
};
export type CompactionWorldOptions = {
  readonly measured?: boolean;
  readonly billed?: boolean;
  readonly resumeWithinMs?: number;
  readonly collaboration?: boolean;
  readonly approvers?: ApproversPort;
  readonly resting?: ReadonlySet<string>;
  readonly callHooks?: () => CallHooks;
};
const defaultModels = modelCatalog(DEFAULT_PROVIDER_DESCRIPTIONS);
export const compactionWorld = Effect.fnUntraced(function* <TTx, TWrite extends TTx = TTx>(
  storage: ThreadStorageHarness<TTx, TWrite>,
  agentId: string,
  options: CompactionWorldOptions = {},
) {
  const scope = yield* Scope.fork(yield* Effect.scope);
  return yield* makeWorld(storage, agentId, options, scope).pipe(Scope.provide(scope));
});
const makeWorld = Effect.fnUntraced(function* <TTx, TWrite extends TTx>(
  storage: ThreadStorageHarness<TTx, TWrite>,
  agentId: string,
  options: CompactionWorldOptions,
  scope: Scope.Closeable,
) {
  const script: Script = {
    answers: [],
    lanes: new Map(),
    heard: new Map(),
    models: new Map(),
    summaries: [],
    requests: [],
    prompts: [],
    summarizedBy: [],
    summarizerAsks: [],
    guides: [],
    outputs: [],
    summarized: 0,
    summarizers: { kind: 'own', reason: 'unchained' },
    tool: null,
  };
  const { answers, summaries, requests } = script;
  const usage = (messages: readonly Message[]) =>
    options.billed
      ? billed(messages)
      : options.measured
        ? new Usage({ inputTokens: 400, cacheReadInputTokens: 300, outputTokens: 10, totalTokens: 410 })
        : new Usage({ outputTokens: 10, totalTokens: 10 });
  const agentRequest = (lane: string | undefined, model: string | null): ModelRequest => ({
    plannedOutputTokens: 4_000,
    origin: new ModelIdentity({ provider: ProviderID.make('scripted'), model: ModelID.make('scripted-1') }),
    text: () => Effect.die('The loop never opens a one-shot.'),
    object: () => Effect.die('The loop never opens a one-shot.'),
    stream: (input) =>
      Stream.suspend(() => {
        requests.push(input.messages);
        if (lane !== undefined) script.heard.set(lane, [...(script.heard.get(lane) ?? []), input.messages]);
        if (lane !== undefined) script.models.set(lane, [...(script.models.get(lane) ?? []), model]);
        const answer = (lane === undefined ? undefined : script.lanes.get(lane)?.shift()) ?? answers.shift();
        if (answer === undefined) return Stream.die('The script has no answer for this model call.');
        const call = requests.length;
        if ('parks' in answer)
          return Stream.fromIterable(answer.opens === undefined ? [] : openedEvents(answer.opens, `open-${call}`)).pipe(
            Stream.concat(Stream.fromEffect(answer.parks.arrive()).pipe(Stream.drain)),
            Stream.concat(Stream.never),
          );
        if ('stalls' in answer)
          return Stream.fail(
            new LLMError({
              module: 'wire',
              method: 'stream',
              reason: new StreamStalledReason({ message: 'No frames.', idleMs: 1_000 }),
            }),
          );
        const events = Stream.fromIterable(
          'tool' in answer
            ? toolCallEvents(`call-${call}`, 'work', {}, usage(input.messages))
            : 'call' in answer
              ? toolCallEvents(`call-${call}`, answer.call, answer.input, usage(input.messages))
              : textEvents(answer.text, `text-${call}`, usage(input.messages)),
        );
        return answer.held === undefined ? events : Stream.fromEffect(answer.held.arrive()).pipe(Stream.drain, Stream.concat(events));
      }),
  });
  const summarize = Effect.fnUntraced(function* (input: ModelOneShotInput, provider: string) {
    script.summarized += 1;
    script.summarizedBy.push(provider);
    script.prompts.push(input.messages === undefined ? (input.prompt ?? '') : input.messages.map(textOf).join('\n'));
    const answer = summaries.shift() ?? { summary: SUMMARY };
    if ('fails' in answer)
      return yield* new LLMError({
        module: 'wire',
        method: 'text',
        reason: new InvalidRequestReason({ message: answer.fails }),
      });
    if ('stalls' in answer) {
      yield* Effect.forkChild(answer.stalls.arrive());
      return yield* Effect.never;
    }
    if (answer.held) yield* answer.held.arrive();
    return new LLMResponse({
      message: Message.assistant(answer.summary),
      events: [{ type: 'text-delta', id: 'summary', text: answer.summary }],
      usage: new Usage({ inputTokens: 50, outputTokens: 20, totalTokens: 70 }),
      finishReason: 'stop',
    });
  });
  const compactionModels: CompactionModels = {
    request: (asked) => ({
      plannedOutputTokens: 4_000,
      stream: () => Stream.die('A summary never streams.'),
      object: () => Effect.die('A summary answers text.'),
      text: (input) => summarize(input, asked.provider),
    }),
    served: (_provider, model) =>
      Effect.succeed({
        id: model ?? 'model',
        capacity: { context: 100_000, output: 4_000 },
        cacheLifetime: { promisedSeconds: null, prior: null },
        requestLimits: undefined,
        compactionTrigger: undefined,
      }),
    defaultModel: () => null,
  };
  const models: ModelRequester = { request: (input) => agentRequest(input.lane, input.model ?? null) };
  const runner = yield* makeAgentRunner({ models, idleMs: 30_000 });
  const work = Tool.make({
    display: () => ({ form: 'none' }),
    approval: ASKS_NEVER,
    description: 'Do one unit of the work.',
    parameters: Schema.Struct({}),
    execute: Effect.fnUntraced(function* () {
      const held = script.tool;
      if (held !== null) yield* held.arrive();
      const output = script.outputs.shift();
      return output === undefined ? { done: true } : { done: true, output };
    }),
  });
  const push = Tool.make({
    display: () => ({ form: 'none' }),
    approval: ASKS_IN_REVIEW,
    description: 'Publish the work; the reader confirms it first.',
    parameters: Schema.Struct({}),
    mutates: true,
    confirmation: { prompt: () => ({ summary: 'Publish the work?' }), confirmLabel: 'Publish' },
    execute: () => Effect.succeed({ pushed: true }),
  });
  const agent = new Agent({
    id: agentId,
    name: 'Worker',
    description: 'Works in a tool loop.',
    instructions: () => 'Do the work you are asked.',
    tools: () => ({ work, push }),
    grant: grantOf(agentId),
    rules: [
      agentRule(
        'scripted-guide',
        (ctx) => {
          if (ctx.hook !== 'beforeStep') return null;
          const text = script.guides.shift();
          return text === undefined ? null : { type: 'guide', text };
        },
        { owner: 'conformance' },
      ),
    ],
    stopWhen: [],
  });
  const worker = threadAgent({
    agent,
    runner,
    runPolicy: { userStartable: true, backgroundStartable: false },
    context: () => Effect.succeed({}),
    callHooks: options.callHooks,
  });
  const rhythm = { ...RHYTHM, resumeWithinMs: options.resumeWithinMs ?? RHYTHM.resumeWithinMs };
  const ports = Layer.mergeAll(
    threadStorageLayer<TTx, TWrite>({
      storage: storage.aggregate,
      eventLog: storage.eventLog,
      transitions: storage.transitions,
      createRuns: (ownerId) => storage.runs({ ownerId, scope: SCOPE }),
      attachments: inertAttachments<TWrite>(),
      inbox: storage.inbox,
      toolOutputs: inertToolOutputs<TWrite>(),
      ownerSettings: storage.ownerSettings,
    }),
    threadFeaturesLayer(
      options.collaboration
        ? {
            collaboration: {
              models: () => defaultModels,
              subAgentDepth: () => Effect.succeed(SUB_AGENT_DEPTH.default),
              delegation: () => Effect.succeed({ allowed: true, setAt: null }),
              reconcileIntervalMs: rhythm.heartbeatIntervalMs,
            },
          }
        : {},
    ),
    threadCompactorLayer(
      makeThreadCompaction({
        models: compactionModels,
        checkpoints: storage.compaction,
        policy: () => Effect.succeed(POLICY),
        strategy: makeThreadSummaryStrategy({ models: compactionModels, prompt: PROMPT }),
        recovery: makeThreadDigestStrategy(),
        text: TEXT,
        summarizers: (ask) =>
          Effect.sync(() => {
            script.summarizerAsks.push(ask);
            return script.summarizers;
          }),
      }),
    ),
    threadHostLayer({
      approvers: options.approvers,
      resting:
        options.resting === undefined ? undefined : { resting: (threadId: string) => Effect.sync(() => options.resting!.has(threadId)) },
      rhythms: {
        lease: {
          heartbeatIntervalMs: rhythm.heartbeatIntervalMs,
          staleRunningAfterMs: rhythm.staleRunningAfterMs,
          takeoverAfterMs: rhythm.takeoverAfterMs,
        },
        reaper: {
          staleSweepIntervalMs: rhythm.staleSweepIntervalMs,
          recoveryBatch: rhythm.recoveryBatch,
          resumeWithinMs: rhythm.resumeWithinMs,
          resumeAttemptLimit: rhythm.resumeAttemptLimit,
        },
        settlement: {
          settledClaimAfterMs: rhythm.settledClaimAfterMs,
          settledHeartbeatIntervalMs: rhythm.settledHeartbeatIntervalMs,
          settledNotificationBatch: rhythm.settledNotificationBatch,
          settledNotifyAttemptLimit: rhythm.settledNotifyAttemptLimit,
        },
        streamFlushIntervalMs: 0,
      },
    }),
    threadAgentsLayer(yield* registeredAgents([worker], 'world')),
    Layer.succeed(ThreadEntryKinds, storage.kinds),
    approvalModesLayer,
  );
  const harness = yield* Effect.acquireRelease(
    AgentHarness.make<ThreadSnapshot, TTx, TWrite>(ports, yield* makeThreadLiveFeed<ThreadSnapshot>()),
    (harness) => harness.dispose(),
  );
  return Object.assign(script, { harness, dispose: () => Scope.close(scope, Exit.void) }) satisfies CompactionWorld<TTx, TWrite>;
});
export const opened = Effect.fnUntraced(function* <TTx, TWrite extends TTx = TTx, R = never>(
  open: ThreadStorageFactory<TTx, TWrite, R>,
  options: CompactionWorldOptions = {},
) {
  const storage = yield* Effect.acquireRelease(open(), (storage) => storage.dispose());
  const thread = yield* storage.createThread({ ownerId: OWNER, scope: SCOPE });
  const provider = defaultModels.providers[0]!.id;
  yield* storage.aggregate.update(thread.id, { provider });
  const world = yield* compactionWorld(storage, thread.agentId, options);
  const handle = world.harness.threads.handle(thread.id, OWNER);
  yield* handle.setAuthorityMode('trust');
  return { storage, world, threadId: thread.id, agentId: thread.agentId, handle };
});
export type Stack<TTx, TWrite extends TTx = TTx> = Effect.Success<ReturnType<typeof opened<TTx, TWrite>>>;
export const started = Effect.fnUntraced(function* <TTx, TWrite extends TTx = TTx>(
  handle: import('../ThreadHandle').ThreadHandle<ThreadSnapshot, TTx, TWrite>,
  text: string,
) {
  const said = yield* handle.send(text);
  if (said.status !== 'started')
    return yield* new ThreadCallBroke({ cause: new Error(`The words answered ${said.status} instead of opening a turn.`) });
  return said.runId;
});
export const quiet = <TTx, TWrite extends TTx = TTx>(world: CompactionWorld<TTx, TWrite>, threadId: string) =>
  waitUntil(() =>
    Effect.map(
      world.harness.reads.snapshot(threadId),
      (state) => state.activeRun === null && state.latestRun !== null && state.latestRun.settledNotifiedAt !== null,
    ),
  );
export const until = <E, R>(check: () => Effect.Effect<boolean, E, R>) => waitUntil(check);
export const transcriptOf = <TTx, TWrite extends TTx = TTx>(storage: ThreadStorageHarness<TTx, TWrite>, threadId: string) =>
  Effect.map(storage.aggregate.transcriptOf(threadId), (entries): readonly ThreadTranscriptEntry[] => entries ?? []);
export function compactionsOf(entries: readonly ThreadTranscriptEntry[]): readonly ThreadCompactionEntry[] {
  return entries.filter((entry) => entry.type === 'compaction') as unknown as ThreadCompactionEntry[];
}
export function textOf(message: Message | undefined): string {
  return message === undefined ? '' : message.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('');
}
export function opensOnHead(messages: readonly Message[] | undefined, summary: string = SUMMARY): boolean {
  return (
    messages !== undefined &&
    messages[0]?.role === 'user' &&
    textOf(messages[0]) === TEXT.checkpointMarker &&
    messages[1]?.role === 'assistant' &&
    textOf(messages[1]) === summary
  );
}
function billed(messages: readonly Message[]): Usage {
  const inputTokens = Math.round(JSON.stringify(messages).length / 4);
  return new Usage({ inputTokens, outputTokens: 10, totalTokens: inputTokens + 10 });
}
function textEvents(text: string, id: string, usage: Usage): readonly LLMEvent[] {
  return [
    { type: 'step-start', index: 0 },
    { type: 'text-start', id },
    { type: 'text-delta', id, text },
    { type: 'text-end', id },
    { type: 'step-finish', index: 0, reason: 'stop' },
    { type: 'finish', reason: 'stop', usage },
  ];
}
function openedEvents(kind: 'reasoning' | 'text', id: string): readonly LLMEvent[] {
  return kind === 'reasoning'
    ? [
        { type: 'step-start', index: 0 },
        { type: 'reasoning-start', id },
        { type: 'reasoning-delta', id, text: 'Weighing the work.' },
      ]
    : [
        { type: 'step-start', index: 0 },
        { type: 'text-start', id },
        { type: 'text-delta', id, text: 'Working on it' },
      ];
}
function toolCallEvents(id: string, name: string, input: Record<string, unknown>, usage: Usage): readonly LLMEvent[] {
  return [
    { type: 'step-start', index: 0 },
    { type: 'tool-input-start', id, name },
    { type: 'tool-call', id, name, input },
    { type: 'step-finish', index: 0, reason: 'tool-calls' },
    { type: 'finish', reason: 'tool-calls', usage },
  ];
}
function inertAttachments<TTx, TWrite extends TTx = TTx>(): ThreadAttachmentStorage<TTx> {
  return {
    keep: (_threadId, image) => Effect.succeed({ id: 'kept', mediaType: image.mediaType, url: 'test://kept' }),
    resolve: (_threadId, _ownerId, refs) =>
      Effect.succeed(refs.map((ref) => ({ id: ref.id, mediaType: 'image/png' as const, url: `test://${ref.id}` }))),
    addressed: (_threadId, refs) =>
      Effect.succeed(refs.map((ref) => ({ id: ref.id, mediaType: 'image/png' as const, url: `test://${ref.id}` }))),
    hydrate: (_threadId, messages) => Effect.succeed([...messages]),
    sizes: () => Effect.succeed(new Map()),
  };
}
function inertToolOutputs<TTx, TWrite extends TTx = TTx>(): ThreadToolOutputStorage<TWrite> {
  return {
    scope: () => ({
      tools: {},
      project: ({ output, modelOutput }) => Effect.succeed({ output, modelOutput }),
      projectMessages: (messages) => Effect.succeed(messages),
      retainInterrupted: ({ text, complete }) => Effect.succeed({ kind: 'text' as const, text, complete }),
      retainOpen: ({ text }) => Effect.succeed({ input: { kind: 'text' as const, text, complete: false }, chars: text.length }),
      commitReferenced: () => Effect.void,
      dispose: () => Effect.void,
    }),
    settleOpen: () => Effect.void,
  };
}
