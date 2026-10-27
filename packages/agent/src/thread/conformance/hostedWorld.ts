import { Effect, Stream } from 'effect';
import { Message, ToolCallPart } from '@runlith/llm/schema/messages';
import { Agent } from '../../agent/Agent';
import type { CallHooks } from '../../agent/AgentCalls';
import { type AgentRunner, makeAgentRunner } from '../../agent/AgentRunner';
import type { ModelRequest } from '../../agent/modelPort';
import type { ToolCatalog } from '../../agent/ToolCatalog';
import type { ThreadQuestionEntry, ThreadToolEntry } from '../../transcript/entries';
import { composeCallHooks, threadCaller, type ThreadPreparedRun } from '../agents/ThreadAgent';
import { threadStepMessagesEvent } from '../events';
import type { TransportBinding } from '../record';
import type { ThreadRunKind } from '../rows';
import type { ReportPlan } from '../run/lifecycle/RunReports';
import { bordered, ThreadCallBroke } from '../ThreadBorder';
import type { ThreadWriteTx } from '../ThreadPorts';
import type { Transport, TransportRuns } from '../transport/contract';
import { gate } from './runLog/support';
import { openedRun, SCOPE, type ScriptedRhythm } from './runLog/world';
import type { ThreadStorageFactory } from './storagePort';
const ADAPTER = 'hosted-acp';
export const SERVER = 'hosted-server';
export const RUN = 'hosted-run';
const BINDING: TransportBinding = { adapter: ADAPTER, profile: null, agent: 'hosted' };
const silent: ModelRequest = {
  plannedOutputTokens: 1,
  text: () => Effect.die(new Error('a hosted run asks no model')),
  object: () => Effect.die(new Error('a hosted run asks no model')),
  stream: () => Stream.die(new Error('a hosted run asks no model')),
};
const hostedBy =
  (runner: AgentRunner, catalog: ToolCatalog, owing?: CallHooks): NonNullable<ThreadPreparedRun['host']> =>
  (input) => {
    const hooks = composeCallHooks(input.callHooks, owing === undefined ? undefined : () => owing)?.({});
    const agent = new Agent<Record<string, never>>({
      id: 'hosted',
      name: 'Hosted',
      description: 'An agent whose loop runs outside Tagma.',
      instructions: () => 'Hosted prompt',
      tools: () => catalog,
      stopWhen: [],
    });
    return runner
      .host(agent, {
        runId: input.run.id,
        stop: input.stop,
        caller: threadCaller(input.thread, input.run.id),
        ctx: {},
        model: input.model,
        approval: { mode: input.run.approvalMode, interactive: input.run.interactive },
        modeOf: input.modeOf,
        callHooks: hooks === undefined ? undefined : () => hooks,
        arrivals: input.arrivals,
      })
      .pipe(
        Effect.mapError((cause) => new ThreadCallBroke({ cause })),
        Effect.map((hosted) => ({ ...hosted, web: 'none' as const })),
      );
  };
const acpLike = (
  gates: Map<string, ReturnType<typeof gate>>,
  hand: TransportRuns['deliver'],
  handed: NonNullable<TransportRuns['handed']>,
): Transport => ({
  adapter: ADAPTER,
  declares: { history: 'none', compaction: 'none' },
  words: 'receipt',
  runs: {
    launch: () => Effect.void,
    deliver: hand,
    handed,
    withdraw: () => Effect.succeed('unsent'),
    queued: () => Effect.void,
    holds: () => [],
    interrupt: () => Effect.succeed('no-turn'),
    adopt: () => Effect.succeed('declined'),
    reached: (_run, mark) =>
      Effect.suspend(() => {
        const held = mark === 'all' ? undefined : gates.get(mark.callId);
        return held ? Effect.andThen(Effect.sync(held.reach), held.released) : Effect.void;
      }),
  },
});
type Said = readonly [id: string, name: string, input: unknown];
export const hosted = Effect.fnUntraced(function* <TTx, TWrite extends TTx, R = never>(
  open: ThreadStorageFactory<TTx, TWrite, R>,
  catalog: ToolCatalog,
  options: {
    readonly owner?: string;
    readonly rhythm?: Partial<ScriptedRhythm>;
    readonly owing?: CallHooks;
    readonly kind?: ThreadRunKind;
    readonly reads?: true;
  } = {},
) {
  const runner = yield* makeAgentRunner({ models: { request: () => silent }, idleMs: 30_000 });
  const gates = new Map<string, ReturnType<typeof gate>>();
  const { storage, world, thread } = yield* openedRun(open, {
    catalog,
    host: hostedBy(runner, catalog, options.owing),
    harness: { ownerId: SERVER },
    transport: BINDING,
    rhythm: options.rhythm,
  });
  const reports = world.harness.runs.reports().of(ADAPTER);
  const apply = (plan: ReportPlan) => storage.aggregate.transaction((unit) => plan.run(unit as unknown as ThreadWriteTx));
  const handing = new Set<string>();
  yield* world.harness.runs.transports().register(
    acpLike(
      gates,
      (run, items) =>
        Effect.suspend(() => {
          for (const item of items) handing.add(item.id);
          const ids = items.map((item) => item.id);
          return bordered(
            Effect.asVoid(
              Effect.andThen(apply(reports.handed(run, ids)), options.reads ? apply(reports.fate(run, 'read', ids)) : Effect.void),
            ),
          );
        }),
      (run) =>
        Effect.map(storage.inbox.pending(run.threadId), (items) => items.filter((item) => item.state === 'queued' && handing.has(item.id))),
    ),
  );
  yield* storage.runs({ ownerId: options.owner ?? SERVER, scope: SCOPE }).createRun({
    startFrom: {
      id: thread.id,
      ownerId: thread.ownerId,
      account: thread.account,
      provider: ADAPTER,
      model: null,
      reasoning: null,
      switches: {},
    },
    kind: options.kind ?? 'turn',
    approval: { mode: 'trust', interactive: true },
    progress: { stage: null, message: null },
    runId: RUN,
  });
  const run = { id: RUN, threadId: thread.id };
  const transcript = () => Effect.map(storage.aggregate.transcriptOf(thread.id), (entries) => entries ?? []);
  const tools = () =>
    Effect.map(transcript(), (entries) => entries.filter((entry): entry is ThreadToolEntry & typeof entry => entry.type === 'tool'));
  return {
    storage,
    world,
    thread,
    runner,
    gates,
    run,
    reports,
    apply,
    tools,
    entry: (toolCallId: string) => Effect.map(tools(), (entries) => entries.find((entry) => entry.toolCallId === toolCallId)),
    questions: () =>
      Effect.map(transcript(), (entries) =>
        entries.filter((entry): entry is ThreadQuestionEntry & typeof entry => entry.type === 'question'),
      ),
    said: (...calls: readonly Said[]) =>
      apply(
        reports.recorded(
          run,
          [threadStepMessagesEvent([Message.assistant(calls.map(([id, name, input]) => ToolCallPart.from({ id, name, input })))])!],
          `said:${calls.map(([id]) => id).join(',')}`,
        ),
      ),
    call: (toolCallId: string, name: string, input: unknown = {}) =>
      world.harness.runs
        .hosting()
        .call({ threadId: thread.id, agentId: thread.agentId, toolCallId, name, input, arguments: JSON.stringify(input) }),
  };
});
