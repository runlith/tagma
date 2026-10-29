import { Effect } from 'effect';
import type { AgentPhase } from '../AgentPhase';
import type { Message } from '@runlith/llm/schema/messages';
import { activity } from '@runlith/activity/Activity';
import { PROJECTION } from '../activities';
import type { AgentContext, AgentContextProjection } from '../AgentContext';
import type { AgentHostFailed } from '../AgentFailure';
import type { AgentGuidanceJournal } from '../AgentGuidanceJournal';
import { pendingRuntimeGuides } from '../AgentGuidanceJournal';
import type { PendingRuntimeGuide } from '../contracts';
import type { AgentSink } from '../AgentRunner';
import { type AgentDirective, type AgentStepToolPolicy, agentStepToolPolicy } from '../policy/AgentRuntimePolicy';
import type { AgentSignal } from '../contracts';
import { agentGuideMessage, agentReaderInput, agentSignalMessages, trailingReaderInputs } from '../AgentSignal';
import type { AgentToolDoor } from '../door/AgentToolDoor';
import { wireToolDefinitions } from '../ModelRequests';
import type { ModelCallStep, ModelRequest } from '../modelPort';
import type { ToolCatalog } from '../ToolCatalog';
import type { RunStop } from '../RunStop';

export type AgentStepPlan = {
  readonly callMessages: readonly Message[];
  readonly policy: AgentStepToolPolicy;
};

export type AgentStepInjection = {
  readonly signals: readonly Message[];
  readonly guides: readonly PendingRuntimeGuide[];
};

export type AgentStepPlanInput = {
  readonly stepNumber: number;
  readonly opening: boolean;
  readonly step: ModelCallStep;
  readonly contextOverflow: boolean;
  readonly request: ModelRequest;
  readonly catalog: ToolCatalog;
  readonly toolNames: readonly string[];
  readonly door: { evaluate: AgentToolDoor['evaluate'] };
  readonly messages: readonly Message[];
  readonly context?: AgentContext | undefined;
  readonly signals?: { drain(stepNumber: number): Effect.Effect<readonly AgentSignal[], AgentHostFailed> } | undefined;
  readonly guidance: AgentGuidanceJournal;
  readonly stepGuides: PendingRuntimeGuide[];
  readonly feed: AgentSink;
  readonly phase: (phase: AgentPhase['phase']) => Effect.Effect<void>;
  readonly stop: RunStop;
  readonly injected: { current: AgentStepInjection | null };
};

export const planStep = Effect.fn('planStep')(function* (input: AgentStepPlanInput) {
  const { request } = input;
  const port = request.refusal ? undefined : input.context;
  const context = port
    ? yield* input.stop.cut(
        projecting(
          input.step,
          input.contextOverflow,
          input.messages.length,
          port.project({
            system: request.system || undefined,
            stepNumber: input.stepNumber,
            provider: request.origin?.provider ?? null,
            model: request.origin?.model ?? null,
            messages: input.messages,
            tools: wireToolDefinitions(input.catalog, undefined),
            providerOptions: request.providerOptions,
            plannedOutputTokens: request.plannedOutputTokens,
            contextOverflow: input.contextOverflow,
            phase: input.phase,
          }),
        ),
        null,
      )
    : { messages: input.messages };
  if (context === null) return null;
  const projected = context.messages;
  if (context.estimate) {
    yield* input.feed.push({
      type: 'context-estimate',
      stepNumber: input.stepNumber,
      tokens: context.estimate.tokens,
      contextWindow: context.estimate.contextWindow,
    });
  }
  if (input.injected.current === null) {
    const signals = input.signals ? yield* input.stop.cut(input.signals.drain(input.stepNumber), null) : [];
    if (signals === null) return null;
    input.injected.current = { signals: signals.flatMap((signal) => agentSignalMessages(signal, signal.attached)), guides: [] };
  }
  const held = input.injected.current;
  const directives = yield* input.stop.cut(
    input.door.evaluate({
      hook: 'beforeStep',
      modelMessages: [...projected, ...held.signals, ...held.guides.map(agentGuideMessage)],
      readerInputs: [
        ...(input.opening ? trailingReaderInputs(input.messages) : []),
        ...held.signals.flatMap((signal) => agentReaderInput(signal) ?? []),
      ],
      invocationKey: `step:${input.stepNumber}`,
      ordinal: input.stepNumber + 1,
    }),
    null,
  );
  if (directives === null) return null;
  const injected = yield* injection(input, held, directives);
  input.injected.current = injected;
  return {
    callMessages: [...projected, ...injected.signals, ...injected.guides.map(agentGuideMessage)],
    policy: agentStepToolPolicy(directives, input.toolNames, request.toolChoice),
  } satisfies AgentStepPlan;
});

const injection = Effect.fn(function* (
  input: AgentStepPlanInput,
  held: AgentStepInjection,
  directives: readonly AgentDirective[],
): Effect.fn.Return<AgentStepInjection> {
  const identity = (guide: { readonly text: string; readonly state?: Readonly<Record<string, unknown>> }) =>
    JSON.stringify([guide.text, guide.state]);
  const seen = new Set(held.guides.map(identity));
  const queued = [...input.stepGuides.splice(0), ...pendingRuntimeGuides('beforeStep', directives)];
  const pending = queued.filter((guide) => {
    const key = identity(guide);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (pending.length === 0) return held;
  const entry = input.guidance.emit(input.stepNumber, pending);
  if (entry) yield* input.feed.push({ type: 'runtime-guidance', entry });
  return { signals: held.signals, guides: [...held.guides, ...pending] };
});

function projecting(
  step: ModelCallStep,
  contextOverflow: boolean,
  given: number,
  project: Effect.Effect<AgentContextProjection, AgentHostFailed>,
): Effect.Effect<AgentContextProjection, AgentHostFailed> {
  return activity(PROJECTION, { step: step.number, attempt: step.attempt, contextOverflow, given }, project, {
    ended: (exit) =>
      exit._tag === 'Success'
        ? {
            result: {
              produced: exit.value.messages.length,
              basis: exit.value.estimate === undefined ? undefined : exit.value.estimate.basis,
            },
          }
        : {},
  });
}
