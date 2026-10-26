import { Duration, Effect, Random } from 'effect';
import type { LLMError, WireFailureRecord } from '@runlith/llm/schema/errors';
import type { LLMEvent } from '@runlith/llm/schema/events';
import type { ModelRetryVerdict } from '@runlith/llm/route/ModelRetryPolicy';
import type { AgentEvent } from '../AgentEvent';
import type { AgentInterruptedCall } from '../AgentRecovery';

export type AgentAttemptEnding = {
  readonly events: readonly AgentEvent[];
  readonly interrupted: readonly AgentInterruptedCall[];
};

export const openPartEnds = (
  events: readonly LLMEvent[],
  at: { readonly stepNumber: number; readonly attempt: number; readonly cause?: WireFailureRecord },
  outcome: 'completed' | 'failed',
): AgentAttemptEnding => {
  const openText = new Set<string>();
  const openReasoning = new Set<string>();
  const openCalls = new Map<string, string>();
  const announced = new Set<string>();
  const received = new Map<string, string[]>();
  for (const event of events) {
    if (event.type === 'text-start') openText.add(event.id);
    else if (event.type === 'text-end') openText.delete(event.id);
    else if (event.type === 'reasoning-start') openReasoning.add(event.id);
    else if (event.type === 'reasoning-end') openReasoning.delete(event.id);
    else if (event.type === 'tool-input-start') openCalls.set(event.id, event.name);
    else if (event.type === 'tool-input-delta') {
      openCalls.set(event.id, event.name);
      const held = received.get(event.id);
      if (held) held.push(event.text);
      else received.set(event.id, [event.text]);
    } else if (event.type === 'tool-call') {
      openCalls.set(event.id, event.name);
      announced.add(event.id);
    } else if (event.type === 'tool-result' || event.type === 'tool-error') openCalls.delete(event.id);
  }
  const interrupted = [...openCalls].flatMap(([id, name]) =>
    announced.has(id) ? [] : [{ toolCallId: id, toolName: name, received: (received.get(id) ?? []).join('') }],
  );
  return {
    events: [
      ...[...openReasoning].map((id): AgentEvent => ({ type: 'reasoning-end', id })),
      ...[...openText].map((id): AgentEvent => ({ type: 'text-end', id })),
      ...[...openCalls].flatMap(([id, name]): AgentEvent[] =>
        announced.has(id)
          ? outcome === 'completed'
            ? []
            : [{ type: 'tool-error', id, name, message: 'The model request ended before this call could finish.' }]
          : [{ type: 'tool-input-interrupted', toolCallId: id, toolName: name, ...at }],
      ),
    ],
    interrupted,
  };
};

export const STEP_RETRIES = 5;
const STALL_RETRIES = 1;
export const RETRY_AFTER_CEILING_MS = 60_000;
const BUSY_BASE_MS = 2_000;
const BUSY_CEILING_MS = 30_000;
const BUSY_JITTER = 0.25;
const BREAK_BASE_MS = 200;
const BREAK_JITTER = 0.1;

const isBusy = (failure: LLMError) => failure.family === 'rate-limit' || failure.family === 'overloaded';

export const stepRetry = (failure: LLMError, retry: number): Effect.Effect<ModelRetryVerdict> => {
  if (failure.family === 'stalled') {
    return Effect.succeed(
      retry > STALL_RETRIES
        ? { again: false, stop: 'exhausted', of: STALL_RETRIES }
        : { again: true, after: Duration.zero, of: STALL_RETRIES },
    );
  }
  if (!failure.retryable) return Effect.succeed({ again: false, stop: 'not-retryable', of: STEP_RETRIES });
  if (retry > STEP_RETRIES) return Effect.succeed({ again: false, stop: 'exhausted', of: STEP_RETRIES });
  if (isBusy(failure)) {
    const named = failure.retryAfterMs;
    if (named !== undefined) {
      return Effect.succeed(
        named > RETRY_AFTER_CEILING_MS
          ? { again: false, stop: 'delay-limit', of: STEP_RETRIES, retryAfterMs: named, ceilingMs: RETRY_AFTER_CEILING_MS }
          : { again: true, after: Duration.millis(named), of: STEP_RETRIES },
      );
    }
    const rung = Math.min(BUSY_BASE_MS * 2 ** (retry - 1), BUSY_CEILING_MS);
    return Random.nextBetween(rung, rung * (1 + BUSY_JITTER)).pipe(
      Effect.map((wait) => ({ again: true, after: Duration.millis(Math.round(wait)), of: STEP_RETRIES }) as const),
    );
  }
  const rung = BREAK_BASE_MS * 2 ** (retry - 1);
  return Random.nextBetween(rung * (1 - BREAK_JITTER), rung * (1 + BREAK_JITTER)).pipe(
    Effect.map((wait) => ({ again: true, after: Duration.millis(Math.round(wait)), of: STEP_RETRIES }) as const),
  );
};
