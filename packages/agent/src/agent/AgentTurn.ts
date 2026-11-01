import { agentSpan } from './spans';

import { Cause, Deferred, Duration, Effect, Exit, Result } from 'effect';
import {
  AgentHostFailed,
  AgentResponseUnfinished,
  AgentRetryFailed,
  AgentRunBroke,
  type AgentRunFailure,
  agentFailureCause,
} from './AgentFailure';
import { isContextOverflowFailure } from '@runlith/llm/provider-error';
import { retryPause } from '@runlith/llm/route/executor';
import { openRetry } from '@runlith/llm/route/ModelRetryPolicy';
import { Usage } from '@runlith/llm/schema/events';
import { wireFailureRecord, type LLMError } from '@runlith/llm/schema/errors';
import type { FinishReason } from '@runlith/llm/schema/ids';
import type { Message } from '@runlith/llm/schema/messages';
import type { AgentPhase } from './AgentPhase';
import { unsuccessfulFinish } from './finish';
import { agentAside, type AgentAsideCapture, type AgentAsideHook } from './AgentAside';
import type { AgentSink } from './AgentRunner';
import { pendingRuntimeGuides, type AgentGuidanceJournal } from './AgentGuidanceJournal';
import type { PendingRuntimeGuide } from './contracts';
import type { AgentRunState } from './AgentRunState';
import type { AgentSignal } from './contracts';
import type { AgentOneStep, AgentStep, AgentStepIntent, AgentStopCondition } from './AgentStep';
import type { RunStop } from './RunStop';
import { defected, degraded, note } from '@runlith/activity/Activity';
import type { AgentNote } from './activities';
import type { AgentToolDoor } from './door/AgentToolDoor';
import { ModelCalls } from './ModelCalls';
import type { ModelCallStep, ModelRequestInput } from './modelPort';
import type { AgentContext } from './AgentContext';
import type { AgentRecovery } from './AgentRecovery';
import type { AgentRunOutput } from './AgentRunner';
import type { AgentScope, AgentScopeBoundary } from './AgentScope';
import { type AgentCallAttempt, callModel } from './turn/call';
import { commitStep, totalAgentUsage } from './turn/commit';
import { STEP_CONTINUATION, continuationMessage, continuedBefore } from './turn/continuation';
import { foldStep } from './turn/fold';
import { type AgentStepInjection, planStep } from './turn/plan';
import { openPartEnds, stepRetry, type AgentAttemptEnding } from './turn/retry';
import { closeStepTools, runStepTools } from './turn/tools';

type AgentTurnDoor = {
  readonly unattended: boolean;
  claims: AgentToolDoor['claims'];
  order: AgentToolDoor['order'];
  attend: AgentToolDoor['attend'];
  keep: AgentToolDoor['keep'];
  receipt: AgentToolDoor['receipt'];
  evaluate: AgentToolDoor['evaluate'];
  settle: AgentToolDoor['settle'];
};

export type AgentTurnDeps = {
  readonly runId: string;
  readonly scope: AgentScope;
  readonly boundary?: AgentScopeBoundary | undefined;
  readonly refresh?: AgentScopeBoundary | undefined;
  readonly stepsTaken?: number | undefined;
  readonly door: AgentTurnDoor;
  readonly stopWhen: readonly AgentStopCondition[];
  readonly oneStep?: AgentOneStep | undefined;
  readonly aside?: AgentAsideHook | undefined;
  readonly capture?: AgentAsideCapture | undefined;
  readonly messages: readonly Message[];
  readonly idleMs: number;
  readonly stop: RunStop;
  readonly context?: AgentContext | undefined;
  readonly recovery?: AgentRecovery | undefined;
  readonly signals?:
    | {
        drain(stepNumber: number): Effect.Effect<readonly AgentSignal[], AgentHostFailed>;
        hasPending(): Effect.Effect<boolean, AgentHostFailed>;
      }
    | undefined;
  readonly commitEffects?: ((intent: AgentStepIntent) => Effect.Effect<void, AgentHostFailed>) | undefined;
  readonly feed: AgentSink;
  readonly guidance: AgentGuidanceJournal;
  readonly stepGuides: PendingRuntimeGuide[];
  readonly runState: AgentRunState;
};

export type AgentRunEnding =
  | { readonly outcome: 'ok'; readonly finish: FinishReason }
  | { readonly outcome: 'failed' | 'cancelled'; readonly reason: string; readonly message: string };

export type AgentTurn = {
  readonly output: AgentRunOutput;
  completedSteps(): readonly AgentStep[];
  readonly abort: Effect.Effect<AgentRunEnding>;
  readonly run: Effect.Effect<AgentRunEnding, never, ModelCalls>;
};

type AgentStepOutcome =
  | { readonly kind: 'failed'; readonly failure: unknown }
  | { readonly kind: 'done'; readonly finishReason: FinishReason }
  | { readonly kind: 'continue'; readonly messages: readonly Message[] };

const unsent = (messages: readonly Message[]): AgentCallAttempt => ({
  outputStarted: false,
  buffered: [],
  callMessages: messages,
  response: null,
  arguments: {},
  finishReason: null,
  failure: null,
  capture: null,
});

export function agentTurn(deps: AgentTurnDeps): AgentTurn {
  const steps: AgentStep[] = [];
  let current: AgentScope = deps.scope;
  let awaitingReader = false;
  let asideStep = -1;
  let emptyFinals = 0;
  let continued = continuedBefore(deps.messages);
  const text = Deferred.makeUnsafe<string, AgentRunBroke>();
  const finishReason = Deferred.makeUnsafe<FinishReason, AgentRunBroke>();
  const usage = Deferred.makeUnsafe<Usage, AgentRunBroke>();
  const response = Deferred.makeUnsafe<{ readonly messages: readonly Message[] }, AgentRunBroke>();
  const stepsDone = Deferred.makeUnsafe<readonly AgentStep[], AgentRunBroke>();
  let concluded: AgentRunEnding | null = null;
  const enter = (phase: AgentPhase['phase']): Effect.Effect<void> => deps.feed.push({ type: 'phase', phase });

  const finish = Effect.fnUntraced(function* (reason: FinishReason) {
    if (concluded !== null) return concluded;
    const settled = [...steps];
    const final = settled.at(-1);
    yield* deps.feed.push({ type: 'run-finish' });
    const ending: AgentRunEnding = { outcome: 'ok', finish: reason };
    concluded = ending;
    Deferred.doneUnsafe(text, Effect.succeed(final?.text ?? ''));
    Deferred.doneUnsafe(finishReason, Effect.succeed(reason));
    Deferred.doneUnsafe(usage, Effect.succeed(totalAgentUsage(settled)));
    Deferred.doneUnsafe(response, Effect.succeed({ messages: final?.response?.messages ?? [] }));
    Deferred.doneUnsafe(stepsDone, Effect.succeed(settled));
    return ending;
  });

  const settle = (cause: unknown): Effect.Effect<AgentRunEnding> =>
    Effect.sync(() => {
      if (concluded !== null) return concluded;
      const broke = new AgentRunBroke({ cause });
      const ending: AgentRunEnding = {
        outcome: deps.stop.stopped ? 'cancelled' : 'failed',
        reason: failureTag(cause),
        message: broke.message,
      };
      concluded = ending;
      const failed = Effect.fail(broke);
      Deferred.doneUnsafe(text, failed);
      Deferred.doneUnsafe(finishReason, failed);
      Deferred.doneUnsafe(usage, failed);
      Deferred.doneUnsafe(response, failed);
      Deferred.doneUnsafe(stepsDone, failed);
      return ending;
    });

  const halted = Effect.fnUntraced(function* () {
    yield* deps.feed.push({ type: 'run-abort' });
    return { kind: 'failed', failure: deps.stop.reason } satisfies AgentStepOutcome;
  });

  const stopConditionMet = Effect.fn(function* (taken: readonly AgentStep[] = steps) {
    for (const condition of deps.stopWhen) {
      const met = yield* Effect.try({
        try: () => condition({ steps: taken }),
        catch: (cause) => new AgentHostFailed({ port: 'stopWhen', cause }),
      });
      if (met) return true;
    }
    return false;
  });

  const attempt = (
    scope: AgentScope,
    stepNumber: number,
    messages: readonly Message[],
    contextOverflow: boolean,
    injected: { current: AgentStepInjection | null },
    ordinal = 0,
    stepStarted = false,
  ): Effect.Effect<AgentCallAttempt, AgentRunFailure, ModelCalls> =>
    agentSpan({ type: 'model-step', runId: deps.runId, stepNumber })(
      Effect.scoped(
        Effect.gen(function* () {
          yield* enter('preparing');
          const step: ModelCallStep = { number: stepNumber, attempt: ordinal };
          const request = yield* deps.stop.cut((yield* ModelCalls).request({ ...scope.model, runId: deps.runId }), null);
          if (request === null) return unsent(messages);
          const plan = yield* planStep({
            stepNumber,
            opening: stepNumber === 0,
            step,
            contextOverflow,
            request,
            catalog: scope.catalog,
            toolNames: [...scope.sources.keys()],
            door: deps.door,
            messages,
            context: deps.context,
            signals: deps.signals,
            guidance: deps.guidance,
            stepGuides: deps.stepGuides,
            feed: deps.feed,
            phase: enter,
            stop: deps.stop,
            injected,
          });
          if (plan === null) return unsent(messages);
          return yield* callModel({
            runId: deps.runId,
            step,
            request,
            model: scope.model,
            context: deps.context,
            catalog: scope.catalog,
            sources: scope.sources,
            plan,
            feed: deps.feed,
            phase: enter,
            idleMs: deps.idleMs,
            stop: deps.stop,
            stepStarted,
            onAnswer: deps.aside
              ? (aside) => {
                  if (asideStep === stepNumber) return Effect.void;
                  asideStep = stepNumber;
                  return deps.aside?.(aside) ?? Effect.void;
                }
              : undefined,
          });
        }),
      ),
    );

  const step = Effect.fnUntraced(function* (
    stepNumber: number,
    messages: readonly Message[],
  ): Effect.fn.Return<AgentStepOutcome, AgentRunFailure, ModelCalls> {
    const injected: { current: AgentStepInjection | null } = { current: null };
    const placed = deps.boundary && !awaitingReader ? yield* deps.stop.cut(deps.boundary({ stepNumber, scope: current }), null) : current;
    const scope = placed !== null && deps.refresh ? yield* deps.stop.cut(deps.refresh({ stepNumber, scope: placed }), null) : placed;
    if (scope === null) return { kind: 'failed', failure: deps.stop.reason } satisfies AgentStepOutcome;
    current = scope;
    let call = yield* attempt(scope, stepNumber, messages, false, injected);
    let ordinal = 0;
    let stepStarted = call.outputStarted;
    let closed = false;
    const closeAttempt = Effect.fnUntraced(function* (open: AgentCallAttempt, cause?: ReturnType<typeof wireFailureRecord>) {
      if (closed || !open.outputStarted || !open.response) return null;
      closed = true;
      const ended = openPartEnds(open.response.events, { stepNumber, attempt: ordinal, cause: cause }, 'failed');
      for (const end of ended.events) yield* deps.feed.push(end);
      return ended;
    });
    const aborted = Effect.fnUntraced(function* () {
      yield* closeAttempt(call);
      if (call.response && call.outputStarted) commit(foldStep(call.response, [], call));
      return { kind: 'failed', failure: deps.stop.reason } satisfies AgentStepOutcome;
    });
    if (deps.stop.stopped) {
      for (const pending of call.buffered) yield* deps.feed.push(pending);
      return yield* aborted();
    }
    let hasRecovered = false;
    let retryFailure: AgentRetryFailed | undefined;
    const failures: LLMError[] = [];
    const recovery = openRetry(call.retry, { decide: (failure, context) => stepRetry(failure, context.attempt) });
    for (let retry = 1; call.failure; retry += 1) {
      if (!hasRecovered && !stepStarted && deps.context && isContextOverflowFailure(call.failure)) {
        hasRecovered = true;
        ordinal += 1;
        closed = false;
        call = yield* attempt(scope, stepNumber, messages, true, injected, ordinal);
        stepStarted = call.outputStarted;
        if (deps.stop.stopped) {
          for (const pending of call.buffered) yield* deps.feed.push(pending);
          return yield* aborted();
        }
        if (!call.failure) break;
      }
      const failed = call.failure;
      failures.push(call.failure);
      const verdict = yield* deps.stop.cut(
        recovery.decide(call.failure, {
          attempt: retry,
          failures,
          outputStarted: call.outputStarted,
          recover: call.retry?.recover,
        }),
        null,
      );
      if (verdict === null) return yield* aborted();
      if (!verdict.again) {
        if ('failure' in verdict && verdict.failure !== undefined) call = { ...call, failure: verdict.failure };
        if (verdict.stop !== 'not-retryable' || retry > 1) {
          retryFailure = new AgentRetryFailed({
            cause: 'failure' in verdict ? (verdict.failure ?? failed) : failed,
            retry: {
              attempts: ordinal + 1,
              retries: retry - 1,
              limit: verdict.of,
              ...(verdict.stop === 'delay-limit'
                ? { stop: verdict.stop, retryAfterMs: verdict.retryAfterMs, ceilingMs: verdict.ceilingMs }
                : { stop: verdict.stop }),
            },
          });
        }
        break;
      }
      const delayMs = Duration.toMillis(verdict.after);
      const ending = yield* closeAttempt(call, wireFailureRecord(failed));
      yield* enter('retrying');
      if (verdict.announce !== false)
        yield* deps.feed.push({
          type: 'retry',
          stepNumber,
          attempt: verdict.attempt ?? retry,
          of: verdict.of,
          family: call.failure.family,
          delayMs,
          message: call.failure.message,
          reason: wireFailureRecord(failed),
        });
      yield* note({
        type: 'step-retry',
        step: stepNumber,
        attempt: ordinal,
        retry,
        of: verdict.of,
        family: call.failure?.family ?? 'unknown',
        delayMs,
      } satisfies AgentNote);
      yield* deps.stop.cut(retryPause(verdict.after), undefined);
      if (deps.stop.stopped) return yield* aborted();
      if (verdict.prepare !== undefined) {
        const refused = yield* deps.stop.cut(
          verdict.prepare.pipe(Effect.match({ onSuccess: () => null, onFailure: (failure) => failure })),
          null,
        );
        if (refused !== null) return { kind: 'failed', failure: refused };
      }
      if (deps.stop.stopped) return yield* aborted();
      if (ending && ending.interrupted.length > 0 && deps.recovery) {
        const guides = yield* deps.stop.cut(
          deps.recovery.interrupted({
            stepNumber,
            attempt: ordinal,
            calls: ending.interrupted.map((call) => {
              const declared = scope.sources.get(call.toolName)?.recovery;
              return declared === undefined ? call : { ...call, recovery: declared };
            }),
            cause: wireFailureRecord(failed),
          }),
          null,
        );
        if (guides === null) return yield* aborted();
        deps.stepGuides.push(...guides);
      }
      ordinal += 1;
      closed = false;
      call = yield* attempt(scope, stepNumber, messages, false, injected, ordinal, stepStarted);
      stepStarted = stepStarted || call.outputStarted;
      if (deps.stop.stopped) {
        for (const pending of call.buffered) yield* deps.feed.push(pending);
        return yield* aborted();
      }
    }
    if (call.failure) {
      for (const pending of call.buffered) yield* deps.feed.push(pending);
      yield* closeAttempt(call, wireFailureRecord(call.failure));
      if (call.response && call.outputStarted) commit(foldStep(call.response, [], call));
      return { kind: 'failed', failure: retryFailure ?? call.failure };
    }
    for (const pending of call.buffered) yield* deps.feed.push(pending);
    const response = call.response;
    if (!response) return { kind: 'failed', failure: new Error('The model call ended without a terminal response.') };
    const completed = openPartEnds(response.events, { stepNumber, attempt: ordinal }, 'completed');
    for (const end of completed.events) yield* deps.feed.push(end);

    const tools = deps.oneStep
      ? yield* closeStepTools({
          message: response.message,
          feed: deps.feed,
          refusal: deps.oneStep.refusal,
        })
      : yield* runStepTools({
          message: response.message,
          sources: scope.sources,
          door: deps.door,
          stop: deps.stop,
          feed: deps.feed,
          phase: enter,
          callMessages: call.callMessages,
          arguments: call.arguments,
          resultRetention: call.resultRetention,
          stepNumber,
          commitEffects: deps.commitEffects,
        });
    const textOnly = !response.message.content.some((part) => part.type === 'tool-call');
    const cut = !deps.oneStep && call.finishReason === 'length' && textOnly;
    const policy = call.continuation ?? STEP_CONTINUATION;
    const answered = foldStep(response, tools.outcomes, call);
    const bounded = cut && (yield* stopConditionMet([...steps, answered]));
    const continuing = cut && !bounded && continued < policy.limit && !deps.stop.stopped;
    const assembled = continuing
      ? { ...answered, response: { messages: [...(answered.response?.messages ?? []), continuationMessage(policy)] } }
      : answered;
    commit(assembled);
    if (deps.stop.stopped) return yield* halted();
    if (deps.capture && call.capture) {
      const { capture } = deps;
      const { request, measuredAt } = call.capture;
      const answer = answered.response?.messages ?? [];
      yield* deps.stop.cut(
        degraded(
          'step capture',
          'The captured step answer only warms a later aside; the run answers the same without it.',
          Effect.gen(function* () {
            const lowered = deps.context ? yield* Effect.result(deps.context.lower(answer)) : Result.succeed(answer);
            if (Result.isSuccess(lowered)) {
              yield* capture(agentAside({ ...request, answer: { messages: lowered.success, measuredAt } }));
              return;
            }
            yield* Effect.logWarning('The step answer was not lowered for its capture', {
              runId: deps.runId,
              stepNumber,
              failure: lowered.failure,
            });
          }),
          () => undefined,
        ),
        undefined,
      );
    }
    if (deps.oneStep) return { kind: 'done', finishReason: call.finishReason ?? 'stop' };
    if (cut) {
      if (!continuing)
        return {
          kind: 'failed',
          failure: new AgentResponseUnfinished({
            finish: 'length',
            continuation: bounded ? undefined : { continued, limit: policy.limit },
          }),
        };
      continued += 1;
      yield* note({ type: 'step-continued', step: stepNumber, continued, of: policy.limit } satisfies AgentNote);
      return { kind: 'continue', messages: [...call.callMessages, ...(assembled.response?.messages ?? [])] };
    }
    continued = 0;

    awaitingReader = !tools.everyCallSettled;
    const finishReason = call.finishReason === 'length' ? 'tool-calls' : (call.finishReason ?? 'stop');
    const closing = textOnly && unsuccessfulFinish(finishReason) === null;
    const unread = deps.signals && closing ? yield* deps.stop.cut(deps.signals.hasPending(), null) : false;
    if (unread === null) return yield* halted();
    const needsFollowUp = tools.everyCallSettled || unread;
    const followUp = { kind: 'continue', messages: [...call.callMessages, ...(assembled.response?.messages ?? [])] } as const;
    if (!needsFollowUp) {
      if (closing && assembled.text.trim().length === 0) {
        if (emptyFinals++ > 0) {
          const outputTokens = assembled.usage?.outputTokens;
          return {
            kind: 'failed',
            failure: new Error(
              `The model ended twice without reply text or a tool call (finish reason: ${finishReason}; output tokens: ${outputTokens ?? 'unknown'}).`,
            ),
          };
        }
        deps.stepGuides.push({
          hook: 'beforeStep',
          text: 'Your last step contained no reply text or tool call. Answer with a concise visible reply or call a tool.',
        });
        return followUp;
      }
      if (closing && !(yield* stopConditionMet())) {
        const directives = yield* deps.stop.cut(
          deps.door.evaluate({
            hook: 'beforeClose',
            modelMessages: followUp.messages,
            steps,
            catalog: current.catalog,
            invocationKey: `close:${stepNumber}`,
            ordinal: stepNumber + 1,
          }),
          null,
        );
        if (directives === null) return yield* halted();
        const guides = pendingRuntimeGuides('beforeClose', directives);
        if (guides.length > 0) {
          deps.stepGuides.push(...guides.map((guide) => ({ ...guide, state: { ...guide.state, closing: true } })));
          return followUp;
        }
      }
      return { kind: 'done', finishReason };
    }
    if (yield* stopConditionMet()) return { kind: 'done', finishReason };
    return followUp;
  });

  const commit = (folded: AgentStep): void => commitStep({ runState: deps.runState, steps, step: folded });

  const run: Effect.Effect<AgentRunEnding, never, ModelCalls> = Effect.gen(function* () {
    yield* deps.feed.push({ type: 'run-start' });
    let messages: readonly Message[] = deps.messages;
    let stepNumber = deps.stepsTaken ?? 0;
    for (;;) {
      const outcome = yield* step(stepNumber, messages).pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterrupts(cause)
            ? Effect.interrupt
            : Effect.as(Cause.hasDies(cause) ? defected(cause) : Effect.void, {
                kind: 'failed',
                failure: agentFailureCause(Cause.squash(cause)),
              } satisfies AgentStepOutcome),
        ),
      );
      if (outcome.kind === 'failed') return yield* settle(outcome.failure);
      if (outcome.kind === 'done') {
        const unsuccessful = unsuccessfulFinish(outcome.finishReason);
        return yield* unsuccessful ? settle(unsuccessful) : finish(outcome.finishReason);
      }
      messages = outcome.messages;
      stepNumber += 1;
    }
  }).pipe(
    Effect.catchCause((cause) =>
      Cause.hasInterrupts(cause)
        ? Effect.interrupt
        : Effect.andThen(Cause.hasDies(cause) ? defected(cause) : Effect.void, settle(agentFailureCause(Cause.squash(cause)))),
    ),
  );

  return {
    output: {
      text: Deferred.await(text),
      finishReason: Deferred.await(finishReason),
      usage: Deferred.await(usage),
      response: Deferred.await(response),
      steps: Deferred.await(stepsDone),
    },
    completedSteps: () => steps,
    abort: Effect.suspend(() => settle(deps.stop.reason)),
    run,
  };
}

function failureTag(cause: unknown): string {
  return typeof cause === 'object' && cause !== null && '_tag' in cause && typeof cause._tag === 'string'
    ? cause._tag
    : cause instanceof Error
      ? cause.name
      : 'Error';
}
