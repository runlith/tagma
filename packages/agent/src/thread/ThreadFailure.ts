import { Data } from 'effect';
import { LLMError, wireFailureRecord } from '@runlith/llm/schema/errors';
import { describeError } from '@runlith/utils/error';
import type { AgentStep } from '../agent/AgentStep';
import { AgentResponseUnfinished, AgentRetryFailed } from '../agent/AgentFailure';
import type { ThreadFailureEntry, TransportFailure } from '../transcript/entries';
import { failureEntryId } from '../transcript/entryNames';
import type { ThreadRunRow } from './rows';
import { ThreadSummaryFailedError } from './storage/compaction';

export function threadFailureMessage(value: unknown): string {
  if (value instanceof Error && value.message) return value.message;
  return describeError(value);
}

export class ThreadNoOutputError extends Data.TaggedError('ThreadNoOutput')<{ readonly message: string }> {
  constructor(steps: readonly AgentStep[] = []) {
    const tools = steps.flatMap((step) => step.toolCalls.map((call) => call.toolName));
    super({
      message: `The run finished with no reply text and no user-visible widget. Steps: ${steps.length}; tool calls: ${
        tools.length > 0 ? tools.join(', ') : 'none'
      }.`,
    });
    this.name = 'ThreadNoOutputError';
  }
}

export class ThreadTailLostError extends Data.TaggedError('ThreadTailLost')<{ readonly message: string; readonly cause: unknown }> {
  constructor(cause: unknown) {
    super({ message: `The run ended without writing its last output: ${threadFailureMessage(cause)}`, cause });
    this.name = 'ThreadTailLostError';
  }
}

export function noOutputFailure(error: unknown): boolean {
  if (error instanceof ThreadNoOutputError) return true;
  return error instanceof LLMError && error.reason._tag === 'InvalidProviderOutput';
}

export function visibleThreadFailure(streamError: unknown, doneError: unknown): unknown {
  if (!streamError) return doneError;
  if (!doneError) return streamError;
  return noOutputFailure(doneError) ? streamError : doneError;
}

export class TransportFailed extends Data.TaggedError('TransportFailed')<{
  readonly message: string;
  readonly failure: TransportFailure | undefined;
}> {}

export function threadFailure(
  run: Pick<ThreadRunRow, 'id' | 'threadId' | 'provider'> & Partial<Pick<ThreadRunRow, 'account'>>,
  error: unknown,
): Pick<ThreadFailureEntry, 'message' | 'diagnostics'> {
  const message = typeof error === 'string' ? error.trim() : error instanceof Error ? error.message.trim() : '';
  const summarizer = error instanceof ThreadSummaryFailedError ? error : null;
  return {
    message: message || describeError(error).slice(0, 2000),
    diagnostics: {
      provider: summarizer === null ? run.provider : summarizer.provider,
      account: summarizer === null ? (run.account ?? null) : summarizer.account,
      ...transportFailureOf(error),
      retry: error instanceof AgentRetryFailed ? error.retry : undefined,
      stack: defectStack(error),
      record: { threadId: run.threadId, runId: run.id, entryId: failureEntryId(run.id) },
    },
  };
}

const STACK_CHARS = 3_000;

function defectStack(error: unknown): string | undefined {
  let held = error;
  for (let depth = 0; depth < 8 && held instanceof Error; depth += 1) {
    if (!('_tag' in held)) return held.stack?.slice(0, STACK_CHARS);
    held = held.cause;
  }
  return undefined;
}

function transportFailureOf(error: unknown): TransportFailure {
  if (error instanceof TransportFailed) return error.failure ?? { stage: 'thread', type: UNCLASSED, retryable: null, modelStarted: null };
  if (error instanceof AgentResponseUnfinished)
    return { stage: 'model.finish', type: FINISH_TYPES[error.finish], retryable: false, modelStarted: true, detail: error.finish };
  const call =
    error instanceof AgentRetryFailed
      ? error.cause
      : error instanceof LLMError
        ? error
        : error instanceof ThreadSummaryFailedError && error.failure instanceof LLMError
          ? error.failure
          : null;
  if (call === null) return { stage: 'thread', type: failureName(error), retryable: null, modelStarted: null };
  return {
    stage: `${call.module}.${call.method}`,
    type: call.reason._tag,
    httpStatus: call.status,
    retryable: call.retryable,
    modelStarted: providerModelStarted(call),
    detail: call.detail ? call.detail : undefined,
    rateLimit: call.reason._tag === 'RateLimit' && call.reason.rateLimit !== undefined ? call.reason.rateLimit : undefined,
    reason: wireFailureRecord(call),
  };
}

export function threadFailureEntry(
  run: Pick<ThreadRunRow, 'id' | 'threadId' | 'provider'> & Partial<Pick<ThreadRunRow, 'account'>>,
  error: unknown,
): ThreadFailureEntry {
  return {
    type: 'failure',
    id: failureEntryId(run.id),
    runId: run.id,
    ...threadFailure(run, error),
    occurredAt: new Date().toISOString(),
  };
}

function providerModelStarted(error: LLMError): boolean | null {
  if (error.modelStarted !== undefined) return error.modelStarted;
  switch (error.reason._tag) {
    case 'InvalidRequest':
    case 'NoRoute':
    case 'Authentication':
    case 'RateLimit':
    case 'QuotaExceeded':
    case 'ContentPolicy':
      return false;
    default:
      return null;
  }
}

const UNCLASSED = 'ThreadRunFailure';

const FINISH_TYPES: Readonly<Record<AgentResponseUnfinished['finish'], string>> = {
  length: 'OutputLimit',
  'content-filter': 'ContentFilter',
  error: 'UnfinishedResponse',
  unknown: 'UnfinishedResponse',
};

function failureName(error: unknown): string {
  return error instanceof Error && error.name.trim() ? error.name : UNCLASSED;
}
