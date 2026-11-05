import type { ModelSwitches } from '@runlith/llm/models/description';
import { Effect, Exit, Fiber, Scope, Semaphore } from 'effect';
import { agentDeferredToolRule } from './AgentDeferredTools';
import { AgentHostFailed, type AgentRunBroke } from './AgentFailure';
import { activity } from '@runlith/activity/Activity';
import { ActivityCause } from '@runlith/activity/cause';
import { RUN } from './activities';
import type { Agent } from './Agent';
import { type AgentApproval, type AgentSignal, isReaderWords, isReport } from './contracts';
import type { ModeOf } from '../modes/ApprovalMode';
import type { AgentAsideCapture, AgentAsideHook } from './AgentAside';
import type { AgentContext } from './AgentContext';
import type { AgentRecovery } from './AgentRecovery';
import { Usage } from '@runlith/llm/schema/events';
import type { FinishReason } from '@runlith/llm/schema/ids';
import type { Message } from '@runlith/llm/schema/messages';
import type { AgentEvent } from './AgentEvent';
import type { AgentRuntimeGuidance, ToolCaller } from './contracts';
import { agentSpan } from './spans';
import { AgentGuidanceJournal, coalesceGuides, pendingRuntimeGuides } from './AgentGuidanceJournal';
import type { PendingRuntimeGuide } from './contracts';
import { AgentRunState, type AgentToolRecord } from './AgentRunState';
import { AgentRuntimePolicy, type AgentRule } from './policy/AgentRuntimePolicy';
import type { AgentOneStep, AgentStep, AgentStepIntent } from './AgentStep';
import type { AgentToolDoor } from './door/AgentToolDoor';
import type { ToolRunMode } from './door/ToolRun';
import { declaredConfirmations } from './door/DeclaredConfirmations';
import { openToolDoor } from './door/openToolDoor';
import { ToolJudge } from './door/openToolDoor';
import type { ToolGuides } from './door/ToolRules';
import type { AgentCallHooks } from './door/types';
import { type AgentCalls, makeAgentCalls } from './AgentCalls';
import { ToolSettlements, type CallSettlements } from './ToolSettlements';
import type { Arrival } from './AgentCall';
import type { RunStop } from './RunStop';
import { type AgentScope, type AgentScopeBoundary, type CatalogRefresh, agentCatalog, agentScope, refreshCatalog } from './AgentScope';
import type { ResolvedCatalog, Withheld } from '../catalog/resolveCatalog';
import type { Tool } from './tool';
import { agentTurn, type AgentRunEnding } from './AgentTurn';
import { ModelCalls } from './ModelCalls';
import type { ModelRequester, ModelRequestInput } from './modelPort';
import type { ToolCatalog } from './ToolCatalog';
import type { AgentToolOutputs } from './ToolOutput';
export type AgentEmission =
  | AgentEvent
  | {
      type: 'runtime-guidance';
      entry: AgentRuntimeGuidance;
    };
export type AgentSink = {
  push(event: AgentEmission): Effect.Effect<void>;
};
export type AgentRunOutput = {
  readonly text: Effect.Effect<string, AgentRunBroke>;
  readonly finishReason: Effect.Effect<FinishReason, AgentRunBroke>;
  readonly usage: Effect.Effect<Usage, AgentRunBroke>;
  readonly response: Effect.Effect<
    {
      readonly messages: readonly Message[];
    },
    AgentRunBroke
  >;
  readonly steps: Effect.Effect<readonly AgentStep[], AgentRunBroke>;
};
export type AgentModelSettings = {
  readonly ownerId: string;
  readonly account?: string;
  readonly provider: string;
  readonly model: string | null;
  readonly reasoning: string | null;
  readonly switches: ModelSwitches;
};
export type AgentSignalArrivals = {
  subscribe(listener: (signal: AgentSignal) => void): () => void;
  unread(): readonly AgentSignal[];
};
export type AgentSignals = {
  drain(stepNumber: number): Effect.Effect<readonly AgentSignal[], AgentHostFailed>;
  hasPending(): Effect.Effect<boolean, AgentHostFailed>;
  readonly arrivals?: AgentSignalArrivals;
};
export type AgentRunParts<TCtx> = {
  readonly runId: string;
  readonly stop: RunStop;
  readonly caller?: ToolCaller;
  readonly callHooks?: AgentCallHooks<TCtx>;
  readonly ctx: TCtx;
  readonly model: AgentModelSettings;
  readonly instructions?: string;
  readonly commitInstructions?: (instructions: string) => Effect.Effect<string, AgentHostFailed>;
  readonly priorTools?: readonly AgentToolRecord[];
  readonly stepsTaken?: number;
  readonly startedAt?: number;
  readonly rules?: readonly AgentRule<unknown>[];
  readonly approval: AgentApproval;
  readonly modeOf: ModeOf;
  readonly resolved?: ResolvedCatalog<Tool>;
  readonly refresh?: CatalogRefresh<TCtx>;
  readonly toolOutputs?: AgentToolOutputs;
};
export type AgentRunInput<TCtx> = AgentRunParts<TCtx> & {
  readonly cacheGroup?: string;
  readonly lane?: string;
  readonly messages: readonly Message[];
  readonly commitEffects?: (intent: AgentStepIntent) => Effect.Effect<void, AgentHostFailed>;
  readonly signals?: AgentSignals;
  readonly oneStep?: AgentOneStep;
  readonly idleMs?: number;
  readonly context?: AgentContext;
  readonly recovery?: AgentRecovery;
  readonly aside?: AgentAsideHook;
  readonly capture?: AgentAsideCapture;
  readonly boundary?: AgentScopeBoundary<TCtx>;
};
export type AgentHostInput<TCtx> = AgentRunParts<TCtx> & {
  readonly onGuides?: ToolGuides;
  readonly arrivals?: AgentSignalArrivals;
  readonly boundary?: AgentScopeBoundary<TCtx>;
};
export type AgentHostedRun = {
  readonly instructions: string;
  catalog(): ToolCatalog;
  withheld(): readonly Withheld[];
  readonly door: AgentToolDoor;
  place(stepNumber: number): Effect.Effect<void, AgentHostFailed>;
  refresh(): Effect.Effect<void, AgentHostFailed>;
  close(): Effect.Effect<void>;
};
export type AgentRunHandle = {
  readonly instructions: string;
  readonly output: AgentRunOutput;
  readonly catalog: ToolCatalog;
  readonly withheld: readonly Withheld[];
  readonly door: AgentToolDoor;
  readonly runState: AgentRunState;
  completedSteps(): readonly AgentStep[];
  untoldGuides(): readonly PendingRuntimeGuide[];
  stop(reason: unknown): Effect.Effect<void>;
  close(): Effect.Effect<void>;
};
const CALL_HISTORY = 200;
export type AgentRunner = Effect.Success<ReturnType<typeof makeAgentRunner>>;
export const makeAgentRunner = Effect.fnUntraced(function* ({
  models,
  idleMs,
  released = () => Effect.void,
}: {
  readonly models: ModelRequester;
  readonly idleMs: number;
  readonly released?: (runId: string) => Effect.Effect<void>;
}) {
  const runs = yield* Scope.fork(yield* Effect.scope);
  const services = ModelCalls.over(models);
  const calls = yield* Scope.provide(makeAgentCalls({ history: CALL_HISTORY }), runs);
  return {
    calls,
    run: <TCtx>(agent: Agent<TCtx>, input: AgentRunInput<TCtx>, sink: AgentSink): Effect.Effect<AgentRunHandle, AgentHostFailed> =>
      Effect.provide(startAgentRun(agent, input, sink, runs, idleMs, calls, released), services),
    host: Effect.fnUntraced(function* <TCtx>(
      agent: Agent<TCtx>,
      input: AgentHostInput<TCtx>,
    ): Effect.fn.Return<AgentHostedRun, AgentHostFailed> {
      const instructions = yield* runInstructions(agent, input);
      let scope = yield* runScope(agent, input, instructions);
      return yield* Effect.uninterruptible(
        Effect.gen(function* () {
          const held = yield* Scope.fork(runs);
          const door = runDoor(agent, input, calls, () => scope, input.onGuides, yield* ToolSettlements, 'hosted');
          const unheard = input.arrivals === undefined ? () => {} : heard(calls, input.runId, input.arrivals);
          const unbound = calls.bind(input.runId, input.stop);
          yield* Scope.addFinalizer(
            held,
            Effect.ensuring(
              door.close(),
              Effect.andThen(
                Effect.sync(() => {
                  unheard();
                  unbound();
                }),
                released(input.runId),
              ),
            ),
          );
          const boundary = input.boundary;
          return {
            instructions,
            catalog: () => scope.catalog,
            withheld: () => scope.withheld,
            door,
            place: Effect.fnUntraced(function* (stepNumber: number) {
              if (boundary === undefined) return;
              const placed = yield* boundary({ stepNumber, scope });
              scope = admitted(door, scope, placed);
            }),
            refresh: () =>
              Effect.map(refreshCatalog(scope, input.refresh), (next) => {
                scope = next;
              }),
            close: () => Scope.close(held, Exit.void),
          };
        }),
      );
    }),
  } as const;
});
const startAgentRun = Effect.fnUntraced(function* <TCtx>(
  agent: Agent<TCtx>,
  input: AgentRunInput<TCtx>,
  sink: AgentSink,
  runs: Scope.Scope,
  idleMs: number,
  calls: AgentCalls,
  released: (runId: string) => Effect.Effect<void>,
): Effect.fn.Return<AgentRunHandle, AgentHostFailed, ModelCalls> {
  const instructions = yield* runInstructions(agent, input);
  const guidance = new AgentGuidanceJournal(input.runId);
  const stepGuides: PendingRuntimeGuide[] = [];
  const scope = yield* runScope(agent, input, instructions);
  const asked = input.boundary;
  let live = scope;
  const stop = input.stop;
  return yield* Effect.uninterruptibleMask(
    Effect.fnUntraced(function* (restore) {
      const held = yield* Scope.fork(runs);
      const door = runDoor(
        agent,
        input,
        calls,
        () => live,
        (directives, context) => {
          stepGuides.push(...pendingRuntimeGuides(context.hook, directives, context));
        },
        yield* ToolSettlements,
      );
      yield* Scope.addFinalizer(held, door.close());
      const unbound = calls.bind(input.runId, stop);
      yield* Scope.addFinalizer(
        held,
        Effect.sync(() => {
          guidance.close();
          unbound();
        }),
      );
      yield* Scope.addFinalizer(held, released(input.runId));
      const signals = input.oneStep ? undefined : input.signals;
      const arrivals = signals?.arrivals;
      if (arrivals !== undefined) yield* Scope.addFinalizer(held, Effect.sync(heard(calls, input.runId, arrivals)));
      const close = Scope.close(held, Exit.void);
      return yield* restore(
        Effect.gen(function* () {
          const admitScope = (next: AgentScope<TCtx>) => {
            live = admitted(door, live, next);
            return next;
          };
          const boundary: AgentScopeBoundary | undefined =
            asked === undefined ? undefined : ({ stepNumber }) => Effect.map(asked({ stepNumber, scope: live }), admitScope);
          const refresh: AgentScopeBoundary | undefined =
            input.refresh === undefined ? undefined : () => Effect.map(refreshCatalog(live, input.refresh), admitScope);
          const recording = yield* Semaphore.make(1);
          const feed: AgentSink = { push: (event) => recording.withPermit(Effect.suspend(() => sink.push(event))) };
          const turn = agentTurn({
            runId: input.runId,
            scope,
            boundary,
            refresh,
            stepsTaken: input.stepsTaken,
            door,
            stopWhen: [...agent.stopWhen],
            oneStep: input.oneStep,
            idleMs: input.idleMs ?? idleMs,
            messages: input.messages,
            stop,
            context: input.context,
            recovery: input.recovery,
            signals,
            commitEffects: input.commitEffects,
            feed,
            guidance,
            stepGuides,
            runState: door.runState,
            aside: input.aside && forkedAside(input.aside, runs, input.runId, stop),
            capture: input.capture,
          });
          const turned = turn.run.pipe(Effect.onInterrupt(() => turn.abort));
          const cause = yield* ActivityCause;
          const turning = yield* Effect.forkIn(
            activity(RUN, { provider: input.model.provider, model: input.model.model, reasoning: input.model.reasoning }, turned, {
              run: input.runId,
              trigger: cause?.trigger ?? null,
              thread: input.caller?.thread == null ? undefined : input.caller.thread.threadId,
              actor: input.caller?.thread == null ? undefined : { kind: 'thread', id: input.caller.thread.threadId },
              ended: (exit) => (Exit.isSuccess(exit) ? runEnding(exit.value) : {}),
            }).pipe(agentSpan({ type: 'run', runId: input.runId })),
            runs,
          );
          return {
            instructions,
            get catalog() {
              return live.catalog;
            },
            get withheld() {
              return live.withheld;
            },
            door,
            runState: door.runState,
            completedSteps: turn.completedSteps,
            untoldGuides: () => coalesceGuides(stepGuides.splice(0)),
            output: turn.output,
            stop: (reason) => Effect.sync(() => void stop.stop(reason)),
            close: () => Effect.andThen(Fiber.interrupt(turning), close),
          } satisfies AgentRunHandle;
        }),
      ).pipe(Effect.onExit((exit) => (Exit.isFailure(exit) ? close : Effect.void)));
    }),
  );
});
function admitted<TCtx>(door: AgentToolDoor<TCtx>, live: AgentScope<TCtx>, next: AgentScope<TCtx>): AgentScope<TCtx> {
  if (next.generation !== live.generation || next.ctx !== live.ctx) door.admit({ generation: next.generation, ctx: next.ctx });
  return next;
}
function arrivalOf(signal: AgentSignal): Arrival | null {
  return isReaderWords(signal) ? 'words' : isReport(signal) ? 'report' : null;
}
function heard(calls: AgentCalls, runId: string, arrivals: AgentSignalArrivals): () => void {
  const unlisten = calls.listen(runId, () => {
    const unread = arrivals.unread().map(arrivalOf);
    return unread.includes('words') ? 'words' : unread.includes('report') ? 'report' : null;
  });
  const unsubscribe = arrivals.subscribe((signal) => {
    const arrival = arrivalOf(signal);
    if (arrival !== null) calls.giveWay(runId, arrival);
  });
  return () => {
    unsubscribe();
    unlisten();
  };
}
function runEnding(ending: AgentRunEnding) {
  if (ending.outcome === 'ok') return { result: { finish: ending.finish } };
  return { outcome: ending.outcome, reason: ending.reason, message: ending.message };
}
const runInstructions = Effect.fnUntraced(function* <TCtx>(agent: Agent<TCtx>, input: AgentRunParts<TCtx>) {
  if (input.instructions !== undefined) return input.instructions;
  const resolved = yield* Effect.try({
    try: () => agent.instructions(input.ctx),
    catch: (cause) => new AgentHostFailed({ port: 'instructions', cause }),
  });
  return input.commitInstructions ? yield* input.commitInstructions(resolved) : resolved;
});
const runScope = <TCtx>(
  agent: Agent<TCtx>,
  input: AgentRunParts<TCtx> & {
    readonly cacheGroup?: string;
    readonly lane?: string;
  },
  instructions: string,
): Effect.Effect<AgentScope<TCtx>, AgentHostFailed> => {
  const model: ModelRequestInput = {
    ownerId: input.model.ownerId,
    account: input.model.account,
    cacheGroup: input.cacheGroup,
    lane: input.lane,
    provider: input.model.provider,
    model: input.model.model,
    reasoning: input.model.reasoning,
    switches: input.model.switches,
    instructions,
    parallelToolCalls: agent.parallelToolCalls,
  };
  return Effect.try({
    try: () =>
      agentScope({
        generation: 0,
        ctx: input.ctx,
        model,
        resolved: input.resolved ?? agentCatalog(agent, input.ctx),
      }),
    catch: (cause) => new AgentHostFailed({ port: 'tools', cause }),
  });
};
const runDoor = <TCtx>(
  agent: Agent<TCtx>,
  input: AgentRunParts<TCtx>,
  calls: AgentCalls,
  live: () => AgentScope<TCtx>,
  onGuides: ToolGuides | undefined,
  settlements: CallSettlements | undefined,
  mode: ToolRunMode = 'native',
): AgentToolDoor<TCtx> =>
  openToolDoor<TCtx>(
    input.runId,
    input.caller ?? { agentId: agent.id, ownerId: input.model.ownerId, thread: null },
    input.ctx,
    new ToolJudge(input.modeOf),
    new AgentRunState({ priorTools: input.priorTools, stepsTaken: input.stepsTaken, startedAt: input.startedAt }),
    new AgentRuntimePolicy<TCtx>([...agent.rules, ...(input.rules ?? []), agentDeferredToolRule<TCtx>(() => live().catalog)]),
    declaredConfirmations,
    input.toolOutputs,
    calls,
    input.callHooks,
    () => live().sources,
    onGuides,
    0,
    !input.approval.interactive,
    [],
    settlements,
    mode,
  );
function forkedAside(hook: AgentAsideHook, runs: Scope.Scope, runId: string, stop: RunStop): AgentAsideHook {
  return (aside) =>
    Effect.asVoid(
      Effect.forkIn(
        stop.cut(
          Effect.onExit(hook(aside), (exit) =>
            Exit.isFailure(exit) ? Effect.logWarning('Agent aside hook failed', { runId, cause: exit.cause }) : Effect.void,
          ),
          undefined,
        ),
        runs,
        { startImmediately: true },
      ),
    );
}
