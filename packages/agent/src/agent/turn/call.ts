import { Clock, Effect, Stream } from 'effect';
import type { AgentPhase } from '../AgentPhase';
import { LLMResponse } from '@runlith/llm/schema/events';
import type { FinishReason } from '@runlith/llm/schema/ids';
import type { LLMError } from '@runlith/llm/schema/errors';
import type { Message } from '@runlith/llm/schema/messages';
import { partialJsonReader } from '@runlith/utils/json';
import { agentAside } from '../AgentAside';
import type { AgentAside, AgentAsideInput } from '../AgentAside';
import type { AgentContext } from '../AgentContext';
import { type AgentEvent, isAgentOutputEvent } from '../AgentEvent';
import type { AgentSink } from '../AgentRunner';
import { ModelCalls } from '../ModelCalls';
import { picturesLeftOut, wireToolDefinitions } from '../ModelRequests';
import type { AgentCallMeasurement } from '../AgentCallMeasurement';
import type { ModelCallStep, ModelRequest, ModelRequestInput } from '../modelPort';
import { initialToolDisplay, previewed } from '../ToolOutput';
import { type Tool, toolPartialDisplay } from '../tool';
import type { ToolCatalog } from '../ToolCatalog';
import type { AgentStepPlan } from './plan';
import type { RunStop } from '../RunStop';
import * as ResponseFold from '@runlith/llm/schema/responseFold';
export type AgentCallAttempt = {
  readonly retry?: ModelRequest['retry'];
  readonly continuation?: ModelRequest['continuation'];
  readonly outputStarted: boolean;
  readonly buffered: readonly AgentEvent[];
  readonly callMessages: readonly Message[];
  readonly response: LLMResponse | null;
  readonly arguments: Readonly<Record<string, string>>;
  readonly finishReason: FinishReason | null;
  readonly failure: LLMError | null;
  readonly resultRetention?: ModelRequest['resultRetention'];
  readonly account?: string;
  readonly activity?: string;
  readonly capture: AgentCallCapture | null;
};
export type AgentCallCapture = {
  readonly request: AgentAsideInput;
  readonly measuredAt: number;
};
export type AgentCallInput = {
  readonly runId: string;
  readonly step: ModelCallStep;
  readonly request: ModelRequest;
  readonly model: ModelRequestInput;
  readonly context?: AgentContext | undefined;
  readonly catalog: ToolCatalog;
  readonly sources: ReadonlyMap<string, Tool>;
  readonly plan: AgentStepPlan;
  readonly feed: AgentSink;
  readonly phase: (phase: AgentPhase['phase']) => Effect.Effect<void>;
  readonly idleMs: number;
  readonly stop: RunStop;
  readonly stepStarted?: boolean;
  readonly onAnswer?: ((aside: AgentAside) => Effect.Effect<void>) | undefined;
};
type StreamingToolInput = {
  readonly name: string;
  readonly reader: ReturnType<typeof partialJsonReader>;
  fields: readonly string[] | null;
  complete: boolean;
  title: string | null;
};
export const callModel = Effect.fn('callModel')(function* (input: AgentCallInput) {
  const models = yield* ModelCalls;
  const { step, plan, request } = input;
  const callMessages = plan.callMessages;
  const buffered: AgentEvent[] = [];
  let outputStarted = false;
  let released = false;
  let folded = ResponseFold.empty(request.origin);
  let activity: string | undefined;
  const hydrated = input.context && !request.refusal ? yield* input.stop.cut(input.context.lower(callMessages), null) : callMessages;
  if (hydrated === null) {
    return {
      capture: null,
      outputStarted,
      retry: request.retry,
      buffered,
      callMessages,
      response: null,
      arguments: {},
      finishReason: null,
      failure: null,
      resultRetention: request.resultRetention,
    } satisfies AgentCallAttempt;
  }
  const lowered = request.images === false ? picturesLeftOut(hydrated) : hydrated;
  let phase: AgentPhase['phase'] = 'calling';
  yield* input.phase(phase);
  const streamingInputs = new Map<string, StreamingToolInput>();
  const sentAtMs = yield* Clock.currentTimeMillis;
  const sentAt = new Date(sentAtMs).toISOString();
  const captured: AgentAsideInput = {
    runId: input.runId,
    stepNumber: step.number,
    request,
    messages: lowered,
    tools: input.catalog,
    activeTools: plan.policy.activeTools ? [...plan.policy.activeTools] : undefined,
    toolChoice: plan.policy.toolChoice ?? undefined,
    stallMs: input.idleMs,
    sentAt: sentAtMs,
  };
  const consumed = models
    .open(request, {
      messages: lowered,
      tools: input.catalog,
      activeTools: captured.activeTools,
      toolChoice: captured.toolChoice,
      stallMs: input.idleMs,
      step,
      opened: (opened) => {
        activity = opened;
      },
    })
    .pipe(
      Stream.runForEach(
        Effect.fnUntraced(function* (event) {
          const nextPhase =
            event.type === 'reasoning-start' || event.type === 'reasoning-delta'
              ? 'reasoning'
              : event.type === 'text-start' || event.type === 'text-delta'
                ? 'writing'
                : event.type === 'tool-input-start' || event.type === 'tool-input-delta' || event.type === 'tool-call'
                  ? 'tools'
                  : event.type === 'text-end' || event.type === 'reasoning-end'
                    ? 'calling'
                    : null;
          if (nextPhase !== null && nextPhase !== phase) {
            phase = nextPhase;
            yield* input.phase(phase);
          }
          folded = ResponseFold.reduce(folded, event);
          const answering = !outputStarted && isAgentOutputEvent(event.type);
          if (isAgentOutputEvent(event.type)) outputStarted = true;
          if (answering && input.onAnswer) yield* input.onAnswer(agentAside(captured));
          if (!released && outputStarted) {
            released = true;
            for (const pending of buffered.splice(0)) yield* input.feed.push(pending);
          }
          if (input.stepStarted && event.type === 'step-start') return;
          const numbered =
            event.type === 'step-start' || event.type === 'step-finish' ? ({ ...event, index: step.number } as AgentEvent) : event;
          if (released) yield* input.feed.push(numbered);
          else buffered.push(numbered);
          if (event.type === 'tool-input-start') {
            streamingInputs.set(event.id, {
              name: event.name,
              reader: partialJsonReader(),
              fields: null,
              complete: false,
              title: null,
            });
          } else if (event.type === 'tool-input-delta') {
            const streaming = streamingInputs.get(event.id) ?? {
              name: event.name,
              reader: partialJsonReader(),
              fields: null,
              complete: false,
              title: null,
            };
            streamingInputs.set(event.id, streaming);
            const reading = streaming.reader.push(event.text);
            if (!reading) return;
            if (streaming.fields === reading.completedFields && streaming.complete === reading.complete) return;
            streaming.fields = reading.completedFields;
            streaming.complete = reading.complete;
            const source = input.sources.get(streaming.name);
            if (!source) return;
            const display = yield* previewed(() => {
              const declared = toolPartialDisplay(source, reading);
              return declared === undefined
                ? undefined
                : initialToolDisplay({ declared, mutates: source.mutates === true, keep: source.keepsTail ? 'tail' : 'head' });
            });
            if (display === undefined || display.title === streaming.title) return;
            streaming.title = display.title ?? null;
            yield* input.feed.push({ type: 'tool-display', toolCallId: event.id, display });
          } else if (event.type === 'tool-call') {
            streamingInputs.delete(event.id);
          }
        }),
      ),
      Effect.as<LLMError | null>(null),
      Effect.catchTag('LLM.Error', (cause) => Effect.succeed(cause)),
    );
  const ended = yield* input.stop.cut(consumed, null);
  const completed = ResponseFold.complete(folded);
  const response = completed ?? (ended ? torn(folded) : undefined);
  const account = request.signedAccount?.();
  let measurement: AgentCallMeasurement | undefined;
  if (input.context && !request.refusal) {
    measurement = yield* input.stop.cut(
      input.context.observe(
        {
          runId: input.runId,
          stepNumber: step.number,
          attempt: step.attempt,
          activity: activity,
          provider: request.origin?.provider ?? input.model.provider,
          model: request.origin?.model ?? input.model.model ?? null,
          account: account,
          reasoning: request.rung,
          system: request.system,
          messages: callMessages,
          tools: wireToolDefinitions(input.catalog, plan.policy.activeTools ?? undefined),
          providerOptions: request.providerOptions,
          plannedOutputTokens: request.plannedOutputTokens,
          sentAt,
          cache: request.cache,
        },
        response ? LLMResponse.usage(response) : undefined,
      ),
      undefined,
    );
    if (measurement) yield* input.feed.push({ type: 'measurement', measurement });
  }
  const ttlSeconds = measurement?.cache?.ttlSeconds;
  const capture: AgentCallCapture | null =
    ended === null && completed !== undefined
      ? {
          request: ttlSeconds == null ? captured : { ...captured, ttlMs: ttlSeconds * 1000 },
          measuredAt: yield* Clock.currentTimeMillis,
        }
      : null;
  return {
    capture,
    outputStarted,
    retry: request.retry,
    continuation: request.continuation,
    buffered,
    callMessages,
    response: response ?? null,
    arguments: folded.arguments,
    finishReason: response?.finishReason ?? null,
    failure: ended,
    resultRetention: request.resultRetention,
    account: account,
    activity: activity,
  } satisfies AgentCallAttempt;
});
function torn(state: ResponseFold.State): LLMResponse {
  return new LLMResponse({
    message: state.message,
    events: [...state.events],
    usage: state.usage,
    finishReason: 'error',
  });
}
