import type { ModelSwitches } from '@runlith/llm/models/description';
import type { AgentToolDoor } from '../../agent/door/AgentToolDoor';
import { declaredConfirmations } from '../../agent/door/DeclaredConfirmations';
import { openToolDoor } from '../../agent/door/openToolDoor';
import { ToolJudge } from '../../agent/door/openToolDoor';
import { ToolSettlements } from '../../agent/ToolSettlements';
import type { ToolGuides } from '../../agent/door/ToolRules';
import type { AgentToolResolution } from '../../agent/door/types';
import type { CallHooks } from '../../agent/AgentCalls';
import { agentCatalog, agentScope, type AgentScope, type AgentScopeBoundary } from '../../agent/AgentScope';
import type { Tool } from '../../agent/tool';
import type { ResolvedCatalog, ToolGrant, Withheld } from '../../catalog/resolveCatalog';
import type { ToolCatalog } from '../../agent/ToolCatalog';
import { AgentHostFailed, agentFailureCause } from '../../agent/AgentFailure';
import type { Agent } from '../../agent/Agent';
import type { AgentHostedRun, AgentRunner, AgentModelSettings, AgentRunOutput, AgentSignalArrivals } from '../../agent/AgentRunner';
import type { TransportCapabilities, TransportWeb } from '../record';
import { Usage } from '@runlith/llm/schema/events';
import type { Message } from '@runlith/llm/schema/messages';
import { Cause, Effect, Exit } from 'effect';
import type { AgentApprovalMode, PendingRuntimeGuide, ThreadBindings, ToolCaller } from '../../agent/contracts';
import type { ModeOf } from '../../modes/ApprovalMode';
import type { AgentAside, AgentAsideHook } from '../../agent/AgentAside';
import type { AgentOneStep, AgentStep, AgentStepIntent } from '../../agent/AgentStep';
import type { AgentContext } from '../../agent/AgentContext';
import type { AgentWaiting } from '../../agent/AgentPhase';
import type { AgentRecovery } from '../../agent/AgentRecovery';
import type { RunStop } from '../../agent/RunStop';
import { AgentRunState, type AgentToolRecord } from '../../agent/AgentRunState';
import { AgentRuntimePolicy, type AgentRule } from '../../agent/policy/AgentRuntimePolicy';
import type { AgentToolOutputs } from '../../agent/ToolOutput';
import { ThreadCallBroke, isThreadBorderFailure, type ThreadBorderFailed } from '../ThreadBorder';
import type { ThreadSignal } from '../../transcript/parts';
import type { ThreadContextEvidence, ThreadContextReading, ThreadContextRecord } from '../rows';
import type { ThreadTranscript, ThreadTranscriptEntry } from '../../transcript/rows';
import type { ThreadToolOutputScopeFaces } from '../ThreadPorts';
import type { ThreadAuthority, ThreadMetadataRow } from '../rows';
import type { ThreadProfileBirth } from './AgentProfile';
import type { ThreadAsides } from '../ThreadAsides';
import { composedInstructions, supplied, type ThreadSources, type ThreadSupplied, type ThreadSupplyPlan } from './supply';
export type AgentRunPolicy = {
  readonly userStartable: boolean;
  readonly backgroundStartable: boolean;
};
export type ThreadSignalDrain = {
  drain(stepNumber: number): Effect.Effect<readonly ThreadSignal[], AgentHostFailed>;
  hasPending(): Effect.Effect<boolean, AgentHostFailed>;
  readonly arrivals?: {
    subscribe(listener: (signal: ThreadSignal) => void): () => void;
    unread(): readonly ThreadSignal[];
  };
};
export type ThreadView = {
  readonly id: string;
  readonly ownerId: string;
  readonly agentId: string;
  readonly hostKind: string | null;
  readonly hostId: string | null;
  readonly bindings: ThreadBindings;
  readonly cacheGroup: string;
  readonly capabilities: TransportCapabilities;
  readonly account: string | null;
  readonly provider: string;
  readonly model: string | null;
  readonly reasoning: string | null;
  readonly switches: ModelSwitches;
  readonly status: string;
  readonly authority: ThreadAuthority;
  readonly profile: ThreadProfileBirth | null;
  readonly history: readonly Message[];
  readonly transcript: ThreadTranscript;
  readonly contextReading: ThreadContextReading | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};
export function threadCaller(thread: ThreadView, runId: string): ToolCaller {
  return { agentId: thread.agentId, ownerId: thread.ownerId, thread: { threadId: thread.id, runId, bindings: thread.bindings } };
}
export type ThreadRunView = {
  readonly id: string;
  readonly status: string;
  readonly account: string | null;
  readonly provider: string | null;
  readonly model: string | null;
  readonly reasoning: string | null;
  readonly switches: ModelSwitches;
  readonly approvalMode: AgentApprovalMode;
  readonly interactive: boolean;
};
export type ThreadModelSelection = AgentModelSettings & {
  readonly provider: string;
};
export function threadModelSelection(thread: ThreadMetadataRow): ThreadModelSelection {
  return {
    ownerId: thread.ownerId,
    account: thread.account ?? undefined,
    provider: thread.provider,
    model: thread.model,
    reasoning: thread.reasoning,
    switches: thread.switches,
  };
}
export type ThreadRunParts = {
  readonly thread: ThreadView;
  readonly run: ThreadRunView;
  readonly stop: RunStop;
  readonly model: ThreadModelSelection;
  readonly instructions?: string;
  readonly callHooks?: CallHooks;
  readonly commitInstructions?: (instructions: string) => Effect.Effect<string, AgentHostFailed>;
  readonly priorTools?: readonly AgentToolRecord[];
  readonly stepsTaken?: number;
  readonly startedAt?: number;
  readonly modeOf: ModeOf;
};
export type ThreadRunStartInput = ThreadRunParts & {
  readonly messages: readonly Message[];
  readonly sink: import('../../agent/AgentRunner').AgentSink;
  readonly commitEffects?: (intent: AgentStepIntent) => Effect.Effect<void, AgentHostFailed>;
};
export type ThreadRunInput = ThreadRunStartInput & {
  readonly signals: ThreadSignalDrain;
  readonly rules?: readonly AgentRule<unknown>[];
  readonly oneStep?: AgentOneStep;
  readonly keepWarm?: true;
  readonly context: AgentContext;
  readonly toolOutputs: AgentToolOutputs;
  readonly recovery?: AgentRecovery;
  readonly boundary?: ThreadContextBoundary;
};
export type ThreadHostInput = ThreadRunParts & {
  readonly toolOutputs: AgentToolOutputs;
  readonly onGuides?: ToolGuides;
  readonly arrivals?: AgentSignalArrivals;
  readonly boundary?: ThreadContextBoundary;
};
export type ThreadToolContextInput = {
  readonly thread: ThreadView;
  readonly run: ThreadRunView;
  readonly admitted?: ThreadContextRecord | null;
};
export type ThreadPrepareInput = {
  readonly thread: ThreadView;
  readonly run: ThreadRunView;
  readonly supply: ThreadSupplyPlan;
  readonly admitted?: ThreadContextRecord | null;
  readonly waitingOn?: ThreadWaitingOn;
};
export type ThreadPreparedRun<TWrite = unknown> = {
  orient(thread: ThreadView): Effect.Effect<ThreadTurnContext<TWrite> | null, ThreadBorderFailed>;
  start(input: ThreadRunInput): Effect.Effect<ThreadAgentRunHandle, ThreadBorderFailed>;
  host?(input: ThreadHostInput): Effect.Effect<ThreadHostedRun, ThreadBorderFailed>;
};
export type ThreadTurnContextInput = ThreadToolContextInput & {
  readonly catalog: ToolCatalog;
};
export type ThreadToolCatalogInput = ThreadToolContextInput & {
  readonly supply: ThreadSupplyPlan;
};
export type ThreadInstructionsInput = {
  readonly thread: ThreadView;
  readonly sources: ThreadSources;
};
export type ThreadDoorRequest = {
  readonly thread: ThreadView;
  readonly run: ThreadRunView;
  readonly admitted?: ThreadContextRecord | null;
  readonly priorTools?: readonly AgentToolRecord[];
  readonly stepsTaken?: number;
  readonly toolOutputs?: AgentToolOutputs;
  readonly resolutions?: readonly AgentToolResolution[];
  readonly unattended?: true;
  readonly onGuides?: ToolGuides;
  readonly callHooks?: CallHooks;
};
export type ThreadToolDoorInput = ThreadDoorRequest & {
  readonly modeOf: ModeOf;
};
export type ThreadAgentRunHandle = {
  readonly instructions: string;
  readonly output: AgentRunOutput;
  readonly catalog: ToolCatalog;
  readonly withheld: readonly Withheld[];
  readonly door: AgentToolDoor;
  completedSteps(): readonly AgentStep[];
  untoldGuides(): readonly PendingRuntimeGuide[];
  stop(reason: unknown): Effect.Effect<void>;
  close(): Effect.Effect<void>;
};
export type ThreadRunHandle<TTx> = ThreadAgentRunHandle & {
  toolOutputs: ThreadToolOutputScopeFaces;
  systemPromptEntry: ThreadTranscriptEntry | null;
  contextWindow(): number | null;
  inputLimit(): number | null;
};
export type ThreadTurnContext<TWrite = unknown> = {
  readonly message: Message;
  readonly entry?: ThreadTranscriptEntry;
  readonly parts?: readonly {
    readonly name: string;
    readonly chars: number;
  }[];
  readonly commit?: (tx: TWrite) => Effect.Effect<void, ThreadBorderFailed>;
};
export type ThreadHostedRun = AgentHostedRun & {
  readonly web: TransportWeb;
};
export type ThreadAgent<TWrite = unknown> = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly runPolicy: AgentRunPolicy;
  readonly grant: ToolGrant;
  readonly compaction?: string;
  prepare(input: ThreadPrepareInput): Effect.Effect<ThreadPreparedRun<TWrite>, ThreadBorderFailed>;
  instructions(input: ThreadInstructionsInput): Effect.Effect<string, ThreadBorderFailed>;
  hostedWebOf?(input: { readonly thread: ThreadView }): Effect.Effect<TransportWeb, ThreadBorderFailed>;
  toolCatalog(input: ThreadToolCatalogInput): Effect.Effect<ToolCatalog, ThreadBorderFailed>;
  toolDoor(input: ThreadToolDoorInput): Effect.Effect<AgentToolDoor, ThreadBorderFailed>;
};
export type ThreadTurnContextIn<TFail, TWrite = unknown> = Omit<ThreadTurnContext<TWrite>, 'commit'> & {
  readonly commit?: (tx: TWrite) => Effect.Effect<void, TFail>;
};
export type ThreadWaitingOn = <A, E, R>(waiting: AgentWaiting, work: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
export type ThreadContextUse =
  | {
      readonly kind: 'run';
      readonly runId: string;
      readonly context: ThreadContextRecord | null;
      readonly waitingOn?: ThreadWaitingOn;
    }
  | {
      readonly kind: 'tools';
      readonly runId: string | null;
      readonly context: ThreadContextRecord | null;
    };
export type ThreadContextBoundary = (input: {
  readonly stepNumber: number;
  readonly generation: number;
}) => Effect.Effect<ThreadContextPreparation | null, ThreadBorderFailed>;
export type ThreadContextPreparation = {
  readonly context: ThreadContextRecord;
  readonly supply: ThreadSupplyPlan;
  readonly instructions?: string;
  publish(admitted: { readonly stepNumber: number; readonly evidence: ThreadContextEvidence }): Effect.Effect<boolean, ThreadBorderFailed>;
  deny(cause: unknown): Effect.Effect<void, ThreadBorderFailed>;
};
export type ThreadAgentOptions<TCtx, TFail = never, TWrite = unknown> = {
  readonly agent: Agent<TCtx>;
  readonly runner: AgentRunner;
  readonly runPolicy: AgentRunPolicy;
  context(thread: ThreadRunInput['thread'], use: ThreadContextUse): Effect.Effect<TCtx, TFail>;
  turnContext?(ctx: TCtx, input: ThreadTurnContextInput): Effect.Effect<ThreadTurnContextIn<TFail, TWrite> | null, TFail>;
  aside?(ctx: TCtx, input: ThreadToolContextInput): Effect.Effect<AgentAsideHook | null, TFail>;
  readonly callHooks?: (ctx: TCtx) => CallHooks;
  readonly hostedWeb?: (ctx: TCtx) => TransportWeb;
  readonly catalogRevision?: (ctx: TCtx) => string;
  readonly asides?: ThreadAsides;
};
const crossed = <A, E>(work: Effect.Effect<A, E>): Effect.Effect<A, ThreadBorderFailed> =>
  Effect.mapError(work, (failure) => (isThreadBorderFailure(failure) ? failure : new ThreadCallBroke({ cause: failure })));
const crossedFrom = <A, E>(work: Effect.Effect<A, E>): Effect.Effect<A, ThreadBorderFailed> =>
  crossed(Effect.mapError(work, (failure) => agentFailureCause(failure)));
export function composeCallHooks<TCtx>(
  layer: CallHooks | undefined,
  product: ((ctx: TCtx) => CallHooks) | undefined,
): ((ctx: TCtx) => CallHooks) | undefined {
  if (layer === undefined && product === undefined) return undefined;
  const claimedOnce = (): Effect.Effect<
    {
      readonly release: Effect.Effect<void>;
    },
    AgentHostFailed
  > => (layer === undefined ? Effect.succeed({ release: Effect.void }) : layer.retain());
  return (ctx) => {
    const theirs = product?.(ctx);
    const owed = theirs?.detaching;
    return {
      detaching: owed,
      began: theirs?.began,
      asking: layer?.asking ?? theirs?.asking,
      retain: () => {
        if (theirs === undefined) return claimedOnce();
        return claimedOnce().pipe(
          Effect.flatMap((claim) =>
            theirs.retain().pipe(
              Effect.map((foreign) => ({ release: Effect.andThen(foreign.release, claim.release) })),
              Effect.onError(() => claim.release),
            ),
          ),
        );
      },
      completed: (record, exit) =>
        Effect.andThen(layer?.completed(record, exit) ?? Effect.void, () => theirs?.completed(record, exit) ?? Effect.void),
    };
  };
}
function contextBoundary<TCtx, TFail, TWrite>(
  options: ThreadAgentOptions<TCtx, TFail, TWrite>,
  input: ThreadRunParts,
  boundary: ThreadContextBoundary,
  published: (plan: ThreadSupplyPlan, scope: AgentScope<TCtx>, revision: string | undefined) => void,
): AgentScopeBoundary<TCtx> {
  return Effect.fnUntraced(
    function* ({ stepNumber, scope }) {
      const prepared = yield* boundary({ stepNumber, generation: scope.generation });
      if (!prepared) return scope;
      let revision: string | undefined;
      const admitted = yield* Effect.exit(
        Effect.gen(function* () {
          const ctx = yield* options.context(input.thread, {
            kind: 'run',
            runId: input.run.id,
            context: prepared.context,
          });
          revision = options.catalogRevision?.(ctx);
          const given = yield* supplied(prepared.supply, ctx, input.thread.profile);
          const instructions =
            prepared.instructions ??
            given.compose(
              yield* Effect.try({
                try: () => options.agent.instructions(ctx),
                catch: (cause) => new AgentHostFailed({ port: 'instructions', cause }),
              }),
            );
          return agentScope({
            generation: prepared.context.generation,
            ctx,
            model: { ...scope.model, instructions },
            resolved: agentCatalog(options.agent, ctx, given.supply),
          });
        }),
      );
      if (Exit.isFailure(admitted)) {
        yield* crossToHost(prepared.deny(Cause.squash(admitted.cause)));
        return scope;
      }
      const next = admitted.value;
      const took = yield* crossToHost(
        prepared.publish({
          stepNumber,
          evidence: {
            instructions: next.model.instructions ?? '',
            tools: Object.keys(next.catalog),
            profileId: input.thread.profile?.id ?? null,
            approvalMode: input.run.approvalMode,
          },
        }),
      );
      if (took) published(prepared.supply, next, revision);
      return took ? next : scope;
    },
    (effect, { stepNumber, scope }) => effect.pipe(crossToHost),
  );
}
function settlingOnClose(handle: ThreadAgentRunHandle, settle: Effect.Effect<void>): ThreadAgentRunHandle {
  return {
    instructions: handle.instructions,
    output: handle.output,
    get catalog() {
      return handle.catalog;
    },
    get withheld() {
      return handle.withheld;
    },
    door: handle.door,
    completedSteps: () => handle.completedSteps(),
    untoldGuides: () => handle.untoldGuides(),
    stop: (reason) => handle.stop(reason),
    close: () => Effect.ensuring(handle.close(), settle),
  };
}
const crossToHost = <A, E>(work: Effect.Effect<A, E>): Effect.Effect<A, AgentHostFailed> =>
  Effect.mapError(work, (cause) => (cause instanceof AgentHostFailed ? cause : new AgentHostFailed({ port: 'boundary', cause })));
export function threadAgent<TCtx, TFail = never, TWrite = unknown>(options: ThreadAgentOptions<TCtx, TFail, TWrite>): ThreadAgent<TWrite> {
  const { agent, runner, runPolicy } = options;
  const prepared = (
    run: ThreadRunView,
    ctx: TCtx,
    given: ThreadSupplied,
    resolved: ResolvedCatalog<Tool>,
    plan: ThreadSupplyPlan,
    thread: ThreadView,
  ): ThreadPreparedRun<TWrite> => {
    let revision = options.catalogRevision?.(ctx);
    const refresh =
      options.catalogRevision === undefined
        ? undefined
        : Effect.fnUntraced(function* (current: TCtx) {
            const next = options.catalogRevision?.(current);
            if (next === revision) return null;
            const giving = yield* crossToHost(supplied({ ...plan, restored: undefined }, current, thread.profile));
            const catalog = yield* Effect.try({
              try: () => agentCatalog(agent, current, giving.supply),
              catch: (cause) => new AgentHostFailed({ port: 'tools', cause }),
            });
            revision = next;
            resolved = catalog;
            return catalog;
          });
    const placing = (input: ThreadRunInput | ThreadHostInput) =>
      input.boundary
        ? contextBoundary(options, input, input.boundary, (nextPlan, scope, nextRevision) => {
            plan = nextPlan;
            revision = nextRevision;
            resolved = { catalog: scope.catalog, withheld: scope.withheld };
          })
        : undefined;
    return {
      orient: (thread) => {
        const turn = options.turnContext;
        if (!turn) return Effect.succeed(null);
        return crossed(
          Effect.map(turn(ctx, { thread, run, catalog: resolved.catalog }), (context) => {
            if (!context) return null;
            const { commit, ...delivered } = context;
            return commit ? { ...delivered, commit: (tx: TWrite) => crossed(commit(tx)) } : delivered;
          }),
        );
      },
      start: (input) =>
        Effect.flatMap(
          options.aside ? crossed(options.aside(ctx, { thread: input.thread, run: input.run })) : Effect.succeed(null),
          (aside) => {
            const commitInstructions = input.commitInstructions;
            const held = options.asides;
            return Effect.andThen(
              held?.opened(input.thread.id, input.run.id, input.keepWarm === true) ?? Effect.void,
              runner
                .run(
                  agent,
                  {
                    boundary: placing(input),
                    runId: input.run.id,
                    stop: input.stop,
                    caller: threadCaller(input.thread, input.run.id),
                    callHooks: composeCallHooks(input.callHooks, options.callHooks),
                    cacheGroup: input.thread.cacheGroup,
                    lane: input.thread.id,
                    ctx,
                    instructions: input.instructions,
                    commitInstructions: commitInstructions ? (text: string) => commitInstructions(given.compose(text)) : undefined,
                    commitEffects: input.commitEffects,
                    stepsTaken: input.stepsTaken,
                    startedAt: input.startedAt,
                    model: input.model,
                    messages: input.messages,
                    approval: { mode: input.run.approvalMode, interactive: input.run.interactive },
                    modeOf: input.modeOf,
                    priorTools: input.priorTools,
                    signals: input.signals,
                    rules: input.rules,
                    oneStep: input.oneStep,
                    resolved,
                    refresh,
                    context: input.context,
                    toolOutputs: input.toolOutputs,
                    recovery: input.recovery,
                    aside: aside ?? undefined,
                    capture: held ? (offered: AgentAside) => held.hold(input.thread.id, offered) : undefined,
                  },
                  input.sink,
                )
                .pipe(
                  Effect.map((handle) =>
                    held
                      ? settlingOnClose(
                          handle,
                          Effect.suspend(() => held.settled(input.thread.id, input.run.id)),
                        )
                      : handle,
                  ),
                  Effect.onError(() => held?.settled(input.thread.id, input.run.id) ?? Effect.void),
                  crossedFrom,
                ),
            );
          },
        ),
      host: (input) => {
        const commitInstructions = input.commitInstructions;
        return crossedFrom(
          runner.host(agent, {
            boundary: placing(input),
            runId: input.run.id,
            stop: input.stop,
            caller: threadCaller(input.thread, input.run.id),
            callHooks: composeCallHooks(input.callHooks, options.callHooks),
            ctx,
            instructions: input.instructions,
            commitInstructions: commitInstructions ? (text: string) => commitInstructions(given.compose(text)) : undefined,
            stepsTaken: input.stepsTaken,
            model: input.model,
            approval: { mode: input.run.approvalMode, interactive: input.run.interactive },
            modeOf: input.modeOf,
            priorTools: input.priorTools,
            resolved,
            refresh,
            toolOutputs: input.toolOutputs,
            onGuides: input.onGuides,
            arrivals: input.arrivals,
          }),
        ).pipe(
          Effect.map(
            (hosted) =>
              ({
                ...hosted,
                web: options.hostedWeb?.(ctx) ?? 'none',
              }) satisfies ThreadHostedRun,
          ),
        );
      },
    };
  };
  return {
    id: agent.id,
    name: agent.name,
    description: agent.description,
    runPolicy,
    get grant() {
      return agent.grant;
    },
    compaction: agent.compaction,
    prepare(input: ThreadPrepareInput): Effect.Effect<ThreadPreparedRun<TWrite>, ThreadBorderFailed> {
      return crossed(
        options.context(input.thread, { kind: 'run', runId: input.run.id, context: input.admitted ?? null, waitingOn: input.waitingOn }),
      ).pipe(
        Effect.flatMap((ctx) => Effect.map(supplied(input.supply, ctx, input.thread.profile), (given) => ({ ctx, given }))),
        Effect.flatMap(({ ctx, given }) =>
          crossedFrom(
            Effect.try({
              try: () => agentCatalog(agent, ctx, given.supply),
              catch: (cause) => new AgentHostFailed({ port: 'tools', cause }),
            }),
          ).pipe(Effect.map((resolved) => prepared(input.run, ctx, given, resolved, input.supply, input.thread))),
        ),
      );
    },
    hostedWebOf:
      options.hostedWeb === undefined
        ? undefined
        : (input: { readonly thread: ThreadView }) =>
            crossed(options.context(input.thread, { kind: 'tools', runId: null, context: null })).pipe(
              Effect.map((ctx) => options.hostedWeb?.(ctx) ?? 'none'),
            ),
    instructions(input: ThreadInstructionsInput): Effect.Effect<string, ThreadBorderFailed> {
      return crossed(options.context(input.thread, { kind: 'tools', runId: null, context: null })).pipe(
        Effect.flatMap((ctx) =>
          Effect.zipWith(
            input.sources(ctx),
            crossedFrom(
              Effect.try({
                try: () => agent.instructions(ctx),
                catch: (cause) => new AgentHostFailed({ port: 'instructions', cause }),
              }),
            ),
            (sources, instructions) => composedInstructions(input.thread.profile, sources, instructions),
          ),
        ),
      );
    },
    toolCatalog(input: ThreadToolCatalogInput): Effect.Effect<ToolCatalog, ThreadBorderFailed> {
      return crossed(options.context(input.thread, { kind: 'tools', runId: input.run.id, context: input.admitted ?? null })).pipe(
        Effect.flatMap((ctx) =>
          Effect.map(supplied(input.supply, ctx, input.thread.profile), (given) => agentCatalog(agent, ctx, given.supply).catalog),
        ),
      );
    },
    toolDoor(input: ThreadToolDoorInput): Effect.Effect<AgentToolDoor, ThreadBorderFailed> {
      return crossed(
        options.context(input.thread, {
          kind: 'tools',
          runId: input.run.id,
          context: input.admitted ?? null,
        }),
      ).pipe(
        Effect.flatMap((ctx) =>
          Effect.gen(function* () {
            return { ctx, settlements: yield* ToolSettlements };
          }),
        ),
        Effect.map(({ ctx, settlements }) =>
          openToolDoor(
            input.run.id,
            threadCaller(input.thread, input.run.id),
            ctx,
            new ToolJudge(input.modeOf),
            new AgentRunState({ priorTools: input.priorTools, stepsTaken: input.stepsTaken }),
            new AgentRuntimePolicy(agent.rules),
            declaredConfirmations,
            input.toolOutputs,
            runner.calls,
            composeCallHooks(input.callHooks, options.callHooks),
            undefined,
            input.onGuides,
            input.admitted?.generation ?? 0,
            input.unattended === true,
            input.resolutions,
            settlements,
          ),
        ),
      );
    },
  };
}
