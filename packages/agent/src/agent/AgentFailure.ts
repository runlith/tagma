import { Data, Schema } from 'effect';
import type { LLMError } from '@runlith/llm/schema/errors';
import type { FinishReason } from '@runlith/llm/schema/ids';
import { ToolFailed, type ToolRefusal } from './tool';

const retryCounts = { attempts: Schema.Int, retries: Schema.Int, limit: Schema.Int };
export const AgentRetryState = Schema.Union([
  Schema.Struct({ stop: Schema.Literals(['exhausted', 'not-retryable']), ...retryCounts }),
  Schema.Struct({ stop: Schema.Literal('delay-limit'), ...retryCounts, retryAfterMs: Schema.Number, ceilingMs: Schema.Number }),
]);
export type AgentRetryState = typeof AgentRetryState.Type;

export class AgentRetryFailed extends Data.TaggedError('AgentRetryFailed')<{
  readonly cause: LLMError;
  readonly retry: AgentRetryState;
}> {
  override get message(): string {
    const { stop, attempts, retries, limit } = this.retry;
    const ending =
      stop === 'exhausted'
        ? `Automatic retries exhausted (${retries}/${limit}; ${attempts} model attempts).`
        : stop === 'delay-limit'
          ? `Automatic retry stopped: requested wait ${this.retry.retryAfterMs} ms exceeds the ${this.retry.ceilingMs} ms ceiling (${attempts} model attempts).`
          : `Automatic retry stopped on a non-retryable failure after ${retries} retries (${attempts} model attempts).`;
    return `${ending} Last failure: ${this.cause.message}`;
  }
}

export type AgentContinuationState = { readonly continued: number; readonly limit: number };

export class AgentResponseUnfinished extends Data.TaggedError('AgentResponseUnfinished')<{
  readonly finish: Exclude<FinishReason, 'stop' | 'tool-calls'>;
  readonly continuation?: AgentContinuationState;
}> {
  override get message(): string {
    if (this.finish !== 'length') return `The model provider stream did not complete successfully (${this.finish}).`;
    const continued =
      this.continuation === undefined
        ? ''
        : ` Automatic continuation stopped after ${this.continuation.continued} of ${this.continuation.limit} continuations.`;
    return `The provider reached its output limit (length).${continued} Partial output remains in the run transcript as unfinished evidence, not a completed report. Before continuing, narrow the requested answer or direct the agent to write its long result to scratch and reply briefly with its path; repeating the same oversized request will repeat the failure.`;
  }
}

export type AgentToolProjection = 'subjects' | 'confirmation.prompt' | 'confirmation.prepare';

export class AgentToolFailed extends Data.TaggedError('AgentToolFailed')<{
  readonly toolName: string;
  readonly toolCallId: string;
  readonly cause: unknown;
  readonly projection?: AgentToolProjection;
  readonly durationMs?: number;
}> {
  override get message(): string {
    return this.projection ? `Tool ${this.toolName} ${this.projection} projection failed: ${causeText(this.cause)}` : causeText(this.cause);
  }
}

export class AgentToolCallReused extends Data.TaggedError('AgentToolCallReused')<{
  readonly toolCallId: string;
  readonly settledAs: string;
  readonly attempted: string;
}> {
  override get message(): string {
    return `Tool call id ${this.toolCallId} already settled as ${this.settledAs}; ${this.attempted} cannot reuse it.`;
  }
}

export class AgentToolCallRegenerated extends Data.TaggedError('AgentToolCallRegenerated')<{
  readonly toolCallId: string;
  readonly admitted: number;
  readonly attempted: number;
}> {
  override get message(): string {
    return `Tool call id ${this.toolCallId} was admitted in context generation ${this.admitted}; generation ${this.attempted} cannot reuse it.`;
  }
}

export class AgentRuleFailed extends Data.TaggedError('AgentRuleFailed')<{
  readonly ruleId: string;
  readonly cause: unknown;
}> {
  override get message(): string {
    return causeText(this.cause);
  }
}

export type AgentHostPort =
  | 'instructions'
  | 'commitInstructions'
  | 'commitEffects'
  | 'signals.drain'
  | 'signals.hasPending'
  | 'project'
  | 'lower'
  | 'observe'
  | 'boundary'
  | 'stopWhen'
  | 'closing'
  | 'toolOutputs'
  | 'recovery'
  | 'tools';

export class AgentHostFailed extends Data.TaggedError('AgentHostFailed')<{
  readonly port: AgentHostPort;
  readonly cause: unknown;
}> {
  override get message(): string {
    return causeText(this.cause);
  }
}

export class AgentRunBroke extends Data.TaggedError('AgentRunBroke')<{ readonly cause: unknown }> {
  override get message(): string {
    return causeText(this.cause);
  }
}

export type AgentToolFailure = AgentToolFailed | AgentToolCallReused | AgentToolCallRegenerated | AgentRuleFailed | AgentHostFailed;

export type AgentRunFailure = AgentRuleFailed | AgentHostFailed;

export function agentToolRefusal(failure: unknown): ToolRefusal | null {
  return failure instanceof AgentToolFailed && failure.cause instanceof ToolFailed ? failure.cause.refusal : null;
}

export function agentFailureCause(failure: unknown): unknown {
  if (failure instanceof AgentToolCallReused || failure instanceof AgentToolCallRegenerated) {
    return new Error(failure.message);
  }
  if (failure instanceof AgentToolFailed || failure instanceof AgentRuleFailed || failure instanceof AgentHostFailed) {
    return failure.cause;
  }
  return failure;
}

function causeText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
