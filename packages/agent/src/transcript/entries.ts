import { HttpRateLimitDetails, WireFailureRecord } from '@runlith/llm/schema/errors';
import { Usage } from '@runlith/llm/schema/events';
import type { ToolResultValue } from '@runlith/llm/schema/messages';
import { errorText } from '@runlith/utils/error';
import { toJson } from '@runlith/utils/json';
import { Schema } from 'effect';
import { AgentRetryState } from '../agent/AgentFailure';
import { CallAfter } from '../agent/callProgress';
import { ToolRefusal, toolOutcomeFailed, type ToolOutcome } from '../agent/tool';
import { AgentRuntimeGuidance, AgentSignalNotice, ThreadSignalAddressee } from '../agent/contracts';
import { ToolDisplay } from '../tool/display';
import { ThreadRewindMark } from './eventFold';
import { RUN_END_STATUSES } from './live';

const rewound = Schema.optional(ThreadRewindMark);

export const ThreadAttachment = Schema.Struct({
  mime: Schema.String,
  url: Schema.String,
  filename: Schema.optional(Schema.String),
});
export type ThreadAttachment = typeof ThreadAttachment.Type;

export const WithdrawnWords = Schema.Struct({
  text: Schema.String,
  attachments: Schema.optional(Schema.Array(ThreadAttachment)),
});
export type WithdrawnWords = typeof WithdrawnWords.Type;

export const ThreadMessageEntry = Schema.Struct({
  type: Schema.tag('message'),
  id: Schema.String,
  role: Schema.Literals(['assistant', 'user']),
  runId: Schema.optional(Schema.String),
  text: Schema.String,
  occurredAt: Schema.optional(Schema.String),
  attachments: Schema.optional(Schema.Array(ThreadAttachment)),
  turnKey: Schema.optional(Schema.String),
  rewound,
});
export type ThreadMessageEntry = typeof ThreadMessageEntry.Type;

export const TransportFailure = Schema.Struct({
  stage: Schema.String,
  type: Schema.String,
  httpStatus: Schema.optional(Schema.Number),
  retryable: Schema.NullOr(Schema.Boolean),
  modelStarted: Schema.NullOr(Schema.Boolean),
  contextOverflow: Schema.optional(Schema.Boolean),
  detail: Schema.optional(Schema.String),
  rateLimit: Schema.optional(HttpRateLimitDetails),
  reason: Schema.optional(WireFailureRecord),
});
export type TransportFailure = typeof TransportFailure.Type;

export const ThreadFailureDiagnostics = Schema.Struct({
  provider: Schema.NullOr(Schema.String),
  account: Schema.NullOr(Schema.String),
  ...TransportFailure.fields,
  retry: Schema.optional(AgentRetryState),
  stack: Schema.optional(Schema.String),
  record: Schema.Struct({ threadId: Schema.String, runId: Schema.String, entryId: Schema.String }),
});
export type ThreadFailureDiagnostics = typeof ThreadFailureDiagnostics.Type;

export const ThreadFailureEntry = Schema.Struct({
  type: Schema.tag('failure'),
  id: Schema.String,
  runId: Schema.String,
  message: Schema.String,
  diagnostics: ThreadFailureDiagnostics,
  occurredAt: Schema.optional(Schema.String),
  rewound,
});
export type ThreadFailureEntry = typeof ThreadFailureEntry.Type;

export const ThreadReasoningEntry = Schema.Struct({
  type: Schema.tag('reasoning'),
  id: Schema.String,
  runId: Schema.optional(Schema.String),
  text: Schema.String,
  state: Schema.optional(Schema.Literals(['streaming', 'done'])),
  occurredAt: Schema.optional(Schema.String),
  rewound,
});
export type ThreadReasoningEntry = typeof ThreadReasoningEntry.Type;

export const ThreadInterruptedInput = Schema.Union([
  Schema.Struct({
    kind: Schema.tag('text'),
    text: Schema.String,
    complete: Schema.Boolean,
  }),
  Schema.Struct({
    kind: Schema.tag('retained'),
    outputId: Schema.String,
    byteLength: Schema.Number,
    location: Schema.optional(Schema.String),
    complete: Schema.Boolean,
  }),
  Schema.Struct({
    kind: Schema.tag('unavailable'),
    reason: Schema.String,
    byteLength: Schema.Number,
    complete: Schema.Boolean,
  }),
]);
export type ThreadInterruptedInput = typeof ThreadInterruptedInput.Type;

export const ThreadToolState = Schema.Literals([
  'input-streaming',
  'input-available',
  'input-interrupted',
  'output-available',
  'output-refused',
  'output-error',
  'output-denied',
  'output-cancelled',
  'output-unknown',
]);
export type ThreadToolState = typeof ThreadToolState.Type;

export const THREAD_TOOL_INPUT_INTERRUPTED = 'input-interrupted';

export function toolSettled(state: ThreadToolState): boolean {
  return state !== 'input-streaming' && state !== 'input-available';
}

const OUTCOME_OF_STATE: Readonly<Partial<Record<ThreadToolState, ToolOutcome['kind']>>> = {
  'output-available': 'answered',
  'output-refused': 'refused',
  'output-error': 'failed',
  'output-denied': 'denied',
  'output-cancelled': 'cancelled',
  'output-unknown': 'unknown',
};

export function toolFailed(state: ThreadToolState): boolean {
  const kind = OUTCOME_OF_STATE[state];
  return state === THREAD_TOOL_INPUT_INTERRUPTED || (kind !== undefined && toolOutcomeFailed(kind));
}

export type ThreadToolSettled = {
  readonly toolState: ThreadToolState;
  readonly toolOutput?: Schema.Json;
  readonly toolError?: string;
  readonly toolRefusal?: ToolRefusal;
};

export function settleTool(outcome: ToolOutcome): ThreadToolSettled {
  const output = 'output' in outcome && outcome.output !== undefined ? { toolOutput: outcome.output } : {};
  switch (outcome.kind) {
    case 'answered':
      return { toolState: 'output-available', toolOutput: outcome.output };
    case 'refused':
      return { toolState: 'output-refused', ...output, toolRefusal: outcome.refusal };
    case 'failed':
      return { toolState: 'output-error', ...output, toolError: outcome.error };
    case 'denied':
      return { toolState: 'output-denied', ...output };
    case 'cancelled':
      return { toolState: 'output-cancelled', ...output };
    case 'unknown':
      return { toolState: 'output-unknown', ...output };
  }
}

export function toolInputJson(input: unknown): Schema.Json | undefined {
  return input === undefined ? undefined : toJson(input);
}

export function toolResultOutcome(result: ToolResultValue): ToolOutcome {
  return result.type === 'error' ? { kind: 'failed', error: errorText(result.value) } : { kind: 'answered', output: toJson(result.value) };
}

export const ThreadToolExecution = Schema.Union([
  Schema.Struct({
    state: Schema.Literal('queued'),
    reason: Schema.optional(Schema.String),
    gated: Schema.optional(Schema.Literal(true)),
    after: Schema.optional(Schema.Array(CallAfter)),
  }),
  Schema.Struct({
    state: Schema.Literal('started'),
    at: Schema.String,
    mutates: Schema.optional(Schema.Boolean),
    after: Schema.optional(Schema.Array(CallAfter)),
    waitedMs: Schema.optional(Schema.Number),
  }),
]);
export type ThreadToolExecution = typeof ThreadToolExecution.Type;

export const ThreadToolEntry = Schema.Struct({
  type: Schema.tag('tool'),
  id: Schema.String,
  runId: Schema.optional(Schema.String),
  toolName: Schema.String,
  toolCallId: Schema.String,
  toolState: ThreadToolState,
  toolRefusal: Schema.optional(ToolRefusal),
  toolInput: Schema.optional(Schema.Json),
  toolInputRaw: Schema.optional(ThreadInterruptedInput),
  interruption: Schema.optional(
    Schema.Struct({ stepNumber: Schema.Number, attempt: Schema.Number, cause: Schema.optional(WireFailureRecord) }),
  ),
  toolOutput: Schema.optional(Schema.Json),
  toolDisplay: Schema.optional(ToolDisplay),
  toolError: Schema.optional(Schema.String),
  execution: Schema.optional(ThreadToolExecution),
  truncated: Schema.optional(Schema.Number),
  occurredAt: Schema.optional(Schema.String),
  rewound,
});
export type ThreadToolEntry = typeof ThreadToolEntry.Type;

export type ThreadToolInterruption = NonNullable<ThreadToolEntry['interruption']>;

export const interruptedInputEntry = (input: {
  readonly id: string;
  readonly runId: string;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly received: ThreadInterruptedInput;
  readonly interruption?: ThreadToolInterruption;
  readonly display?: ToolDisplay;
  readonly occurredAt: string;
}): ThreadToolEntry => ({
  type: 'tool',
  id: input.id,
  runId: input.runId,
  toolName: input.toolName,
  toolCallId: input.toolCallId,
  toolState: THREAD_TOOL_INPUT_INTERRUPTED,
  toolInputRaw: input.received,
  interruption: input.interruption,
  toolDisplay: input.display,
  occurredAt: input.occurredAt,
});

export type ToolStanding = { readonly state: 'queued' } | { readonly state: 'running'; readonly since: number | null };

export function toolStanding(entry: {
  readonly toolState: ThreadToolState;
  readonly execution?: ThreadToolExecution;
}): ToolStanding | null {
  if (entry.toolState !== 'input-available') return null;
  const execution = entry.execution;
  if (execution?.state === 'queued' && (execution.gated !== true || execution.reason !== undefined)) return { state: 'queued' };
  const started = execution?.state === 'started' ? Date.parse(execution.at) : Number.NaN;
  return { state: 'running', since: Number.isNaN(started) ? null : started };
}

export function toolReceipt(entry: { readonly toolState: ThreadToolState; readonly toolOutput?: unknown }): boolean {
  if (entry.toolState !== 'output-available') return false;
  const output = entry.toolOutput;
  if (typeof output !== 'object' || output === null || Array.isArray(output)) return false;
  const receipt = output as Record<string, unknown>;
  return (
    (receipt['status'] === 'background' || receipt['status'] === 'running') &&
    typeof receipt['runId'] === 'string' &&
    typeof receipt['toolCallId'] === 'string'
  );
}

export type StandingSource = {
  readonly toolName: string;
  readonly title: string | null;
  readonly toolState: ThreadToolState;
  readonly execution?: ThreadToolExecution;
};

export type StandingCall = { readonly name: string; readonly title: string | null; readonly since: number | null };

export type StandingWork = { readonly calls: readonly StandingCall[]; readonly queued: number };

export function standingWork(tools: Iterable<StandingSource>): StandingWork {
  const calls: StandingCall[] = [];
  let queued = 0;
  for (const tool of tools) {
    const standing = toolStanding(tool);
    if (standing === null) continue;
    if (standing.state === 'queued') queued += 1;
    else calls.push({ name: tool.toolName, title: tool.title, since: standing.since });
  }
  return { calls: calls.sort(oldestFirst), queued };
}

function oldestFirst(left: StandingCall, right: StandingCall): number {
  if (left.since === right.since) return 0;
  if (left.since === null) return 1;
  if (right.since === null) return -1;
  return left.since - right.since;
}

export const ThreadSignalEntry = Schema.Struct({
  type: Schema.tag('signal'),
  id: Schema.String,
  runId: Schema.optional(Schema.String),
  signalType: Schema.String,
  addressee: ThreadSignalAddressee,
  text: Schema.String,
  title: Schema.optional(Schema.String),
  senderThreadId: Schema.optional(Schema.String),
  senderProjectId: Schema.optional(Schema.Number),
  notice: Schema.optional(AgentSignalNotice),
  attachments: Schema.optional(Schema.Array(ThreadAttachment)),
  unconfirmed: Schema.optional(Schema.Literal(true)),
  occurredAt: Schema.optional(Schema.String),
  rewound,
});
export type ThreadSignalEntry = typeof ThreadSignalEntry.Type;

export const ThreadRunSpend = Schema.Struct({
  inputTokens: Schema.optional(Schema.Number),
  outputTokens: Schema.optional(Schema.Number),
  cacheReadInputTokens: Schema.optional(Schema.Number),
  cacheWriteInputTokens: Schema.optional(Schema.Number),
});
export type ThreadRunSpend = typeof ThreadRunSpend.Type;

export const ThreadRunEndEntry = Schema.Struct({
  type: Schema.tag('run-end'),
  id: Schema.String,
  runId: Schema.String,
  status: Schema.Literals(RUN_END_STATUSES),
  startedAt: Schema.String,
  finishedAt: Schema.String,
  occurredAt: Schema.String,
  usage: Schema.optional(ThreadRunSpend),
  account: Schema.optional(Schema.String),
  rewound,
});
export type ThreadRunEndEntry = typeof ThreadRunEndEntry.Type;

export const ThreadInterruptionEntry = Schema.Struct({
  type: Schema.tag('interruption'),
  id: Schema.String,
  runId: Schema.String,
  text: Schema.String,
  occurredAt: Schema.optional(Schema.String),
  rewound,
});
export type ThreadInterruptionEntry = typeof ThreadInterruptionEntry.Type;

export const ThreadRetryEntry = Schema.Struct({
  type: Schema.tag('retry'),
  id: Schema.String,
  runId: Schema.String,
  stepNumber: Schema.Number,
  attempt: Schema.Number,
  of: Schema.Number,
  family: Schema.String,
  delayMs: Schema.Number,
  message: Schema.optional(Schema.String),
  reason: Schema.optional(WireFailureRecord),
  occurredAt: Schema.String,
  rewound,
});
export type ThreadRetryEntry = typeof ThreadRetryEntry.Type;

export const THREAD_SUMMARIZER_SKIP_REASONS = [
  'unknown-model',
  'not-callable',
  'not-connected',
  'no-account',
  'quota',
  'rate-limited',
  'unavailable',
  'overflow',
] as const;
export type ThreadSummarizerSkipReason = (typeof THREAD_SUMMARIZER_SKIP_REASONS)[number];

export const ThreadSummarizerSkip = Schema.Struct({
  provider: Schema.String,
  model: Schema.String,
  reason: Schema.Literals(THREAD_SUMMARIZER_SKIP_REASONS),
  until: Schema.optional(Schema.String),
});
export type ThreadSummarizerSkip = typeof ThreadSummarizerSkip.Type;

export const THREAD_SUMMARIZER_REASONS = ['named', 'never', 'warm', 'unchained', 'cold', 'always', 'foreign'] as const;
export type ThreadSummarizerReason = (typeof THREAD_SUMMARIZER_REASONS)[number];

export const ThreadCompactionSummarizer = Schema.Struct({
  provider: Schema.String,
  model: Schema.NullOr(Schema.String),
  reasoning: Schema.NullOr(Schema.String),
  account: Schema.optional(Schema.String),
  own: Schema.Boolean,
  reason: Schema.Literals(THREAD_SUMMARIZER_REASONS),
  skipped: Schema.Array(ThreadSummarizerSkip),
  passes: Schema.optional(Schema.Number),
  usage: Schema.optional(Usage),
});
export type ThreadCompactionSummarizer = typeof ThreadCompactionSummarizer.Type;

export const ThreadCompactionReceipt = Schema.Struct({
  cause: Schema.Literals(['manual', 'overflow', 'measured', 'projected']),
  projectedTokens: Schema.optional(Schema.Number),
  usableTokens: Schema.optional(Schema.Number),
  measuredTokens: Schema.optional(Schema.Number),
  postTokens: Schema.optional(Schema.Number),
  cachedInputTokens: Schema.optional(Schema.Number),
  contextWindow: Schema.optional(Schema.Number),
  inputLimit: Schema.optional(Schema.NullOr(Schema.Number)),
  trigger: Schema.optional(
    Schema.Struct({
      source: Schema.Literals(['override', 'row', 'global']),
      strategy: Schema.Literals(['percent', 'reserve-output']),
      share: Schema.optional(Schema.Number),
    }),
  ),
});
export type ThreadCompactionReceipt = typeof ThreadCompactionReceipt.Type;

export const ThreadCompactionEntry = Schema.Struct({
  type: Schema.tag('compaction'),
  id: Schema.String,
  runId: Schema.optional(Schema.String),
  mode: Schema.Literals(['automatic', 'manual']),
  status: Schema.Literals(['running', 'completed', 'unchanged', 'aborted', 'failed']),
  occurredAt: Schema.optional(Schema.String),
  updatedAt: Schema.optional(Schema.String),
  receipt: Schema.optional(ThreadCompactionReceipt),
  summary: Schema.optional(Schema.String),
  summarizer: Schema.optional(ThreadCompactionSummarizer),
  noSummarizer: Schema.optional(Schema.Struct({ skipped: Schema.Array(ThreadSummarizerSkip) })),
  rewound,
});
export type ThreadCompactionEntry = typeof ThreadCompactionEntry.Type;

export const ThreadCompositionEntry = Schema.Struct({
  type: Schema.tag('composition'),
  id: Schema.String,
  runId: Schema.String,
  occurredAt: Schema.String,
  opening: Schema.optional(Schema.Literal(true)),
  system: Schema.Struct({ chars: Schema.Number }),
  context: Schema.NullOr(Schema.Struct({ chars: Schema.Number })),
  tools: Schema.Struct({
    count: Schema.Number,
    chars: Schema.Number,
    each: Schema.Array(Schema.Struct({ name: Schema.String, chars: Schema.Number, hidden: Schema.optional(Schema.Literal(true)) })),
  }),
  tokens: Schema.optional(
    Schema.Struct({
      total: Schema.Number,
      system: Schema.Number,
      context: Schema.NullOr(Schema.Number),
      tools: Schema.Number,
      each: Schema.Array(Schema.Struct({ name: Schema.String, tokens: Schema.Number })),
    }),
  ),
  rewound,
});
export type ThreadCompositionEntry = typeof ThreadCompositionEntry.Type;

export type ThreadCompositionTokens = NonNullable<ThreadCompositionEntry['tokens']>;

export const compositionRest = (tokens: ThreadCompositionTokens): number =>
  Math.max(0, tokens.total - tokens.system - (tokens.context ?? 0) - tokens.tools);

export const ThreadSystemPromptEntry = Schema.Struct({
  type: Schema.tag('system-prompt'),
  id: Schema.String,
  runId: Schema.optional(Schema.String),
  text: Schema.String,
  occurredAt: Schema.optional(Schema.String),
  rewound,
});
export type ThreadSystemPromptEntry = typeof ThreadSystemPromptEntry.Type;

export const ThreadContextEntry = Schema.Struct({
  type: Schema.tag('context'),
  id: Schema.String,
  runId: Schema.optional(Schema.String),
  text: Schema.String,
  occurredAt: Schema.optional(Schema.String),
  rewound,
});
export type ThreadContextEntry = typeof ThreadContextEntry.Type;

export const ThreadContextChangeEntry = Schema.Struct({
  type: Schema.tag('context-change'),
  id: Schema.String,
  runId: Schema.String,
  requestId: Schema.String,
  sourceKey: Schema.String,
  status: Schema.Literals(['pending', 'published', 'denied']),
  fromGeneration: Schema.Number,
  generation: Schema.optional(Schema.Number),
  stepNumber: Schema.optional(Schema.Number),
  detail: Schema.optional(Schema.String),
  occurredAt: Schema.String,
  updatedAt: Schema.optional(Schema.String),
  rewound,
});
export type ThreadContextChangeEntry = typeof ThreadContextChangeEntry.Type;

export const ThreadInteractionPrompt = Schema.Struct({
  id: Schema.String,
  kind: Schema.optional(Schema.String),
  prompt: Schema.String,
  header: Schema.optional(Schema.String),
  options: Schema.optional(
    Schema.Array(
      Schema.Struct({
        value: Schema.String,
        label: Schema.String,
        description: Schema.optional(Schema.String),
        preview: Schema.optional(Schema.String),
      }),
    ),
  ),
  allowMultiple: Schema.optional(Schema.Boolean),
  allowFreeform: Schema.optional(Schema.Boolean),
  secret: Schema.optional(Schema.Boolean),
  approves: Schema.optional(Schema.String),
  data: Schema.optional(Schema.Record(Schema.String, Schema.Json)),
});
export type ThreadInteractionPrompt = typeof ThreadInteractionPrompt.Type;

export const ThreadQuestionPrompt = Schema.Struct({ ...ThreadInteractionPrompt.fields, toolCallId: Schema.String });
export type ThreadQuestionPrompt = typeof ThreadQuestionPrompt.Type;

export const ThreadInteractionToolCall = Schema.Struct({ toolCallId: Schema.String, toolName: Schema.String });
export type ThreadInteractionToolCall = typeof ThreadInteractionToolCall.Type;

export const ThreadInteractionAnswer = Schema.Struct({
  questionId: Schema.String,
  values: Schema.Array(Schema.String),
  annotation: Schema.optional(Schema.Struct({ notes: Schema.optional(Schema.String), preview: Schema.optional(Schema.String) })),
});
export type ThreadInteractionAnswer = typeof ThreadInteractionAnswer.Type;

export const ThreadQuestionCleared = Schema.Struct({
  kind: Schema.tag('cleared'),
  reason: Schema.optional(Schema.String),
  refusal: Schema.optional(ToolRefusal),
});
export type ThreadQuestionCleared = typeof ThreadQuestionCleared.Type;

export const ThreadQuestionEntry = Schema.Struct({
  type: Schema.tag('question'),
  id: Schema.String,
  runId: Schema.String,
  questionId: Schema.String,
  questions: Schema.Array(ThreadQuestionPrompt),
  toolCalls: Schema.Array(ThreadInteractionToolCall),
  status: Schema.Literals(['open', 'answered', 'cleared', 'lapsed']),
  outcome: Schema.optional(ThreadQuestionCleared),
  action: Schema.optional(Schema.Struct({ key: Schema.String, operation: Schema.String })),
  approver: Schema.optional(Schema.String),
  timeoutMs: Schema.optional(Schema.NullOr(Schema.Number)),
  decision: Schema.optional(Schema.Struct({ by: Schema.optional(Schema.String), note: Schema.optional(Schema.String) })),
  route: Schema.optional(Schema.String),
  answers: Schema.optional(Schema.Array(ThreadInteractionAnswer)),
  deliveryUnknown: Schema.optional(Schema.Boolean),
  deliveryNote: Schema.optional(Schema.String),
  guidance: Schema.optional(AgentRuntimeGuidance),
  occurredAt: Schema.optional(Schema.String),
  updatedAt: Schema.optional(Schema.String),
  rewound,
});
export type ThreadQuestionEntry = typeof ThreadQuestionEntry.Type;

export const ThreadReadyAnswer = Schema.Struct({ label: Schema.String, send: Schema.String });
export type ThreadReadyAnswer = typeof ThreadReadyAnswer.Type;

export const ThreadReadyAnswersEntry = Schema.Struct({
  type: Schema.tag('ready-answers'),
  id: Schema.String,
  runId: Schema.String,
  answers: Schema.Array(ThreadReadyAnswer),
  occurredAt: Schema.optional(Schema.String),
  rewound,
});
export type ThreadReadyAnswersEntry = typeof ThreadReadyAnswersEntry.Type;

export const ThreadRestartEntry = Schema.Struct({
  type: Schema.tag('restart'),
  id: Schema.String,
  runId: Schema.optional(Schema.String),
  stoppedRunId: Schema.optional(Schema.String),
  continued: Schema.Boolean,
  byThreadId: Schema.optional(Schema.String),
  calls: Schema.Array(ThreadInteractionToolCall),
  occurredAt: Schema.String,
  rewound,
});
export type ThreadRestartEntry = typeof ThreadRestartEntry.Type;

export const ThreadGuidanceEntry = Schema.Struct({ ...AgentRuntimeGuidance.fields, rewound });

export const THREAD_CORE_ENTRIES = [
  ThreadMessageEntry,
  ThreadFailureEntry,
  ThreadReasoningEntry,
  ThreadToolEntry,
  ThreadSignalEntry,
  ThreadInterruptionEntry,
  ThreadRunEndEntry,
  ThreadRetryEntry,
  ThreadCompactionEntry,
  ThreadCompositionEntry,
  ThreadSystemPromptEntry,
  ThreadContextEntry,
  ThreadContextChangeEntry,
  ThreadQuestionEntry,
  ThreadReadyAnswersEntry,
  ThreadRestartEntry,
  ThreadGuidanceEntry,
] as const;

export type ThreadEntry = (typeof THREAD_CORE_ENTRIES)[number]['Type'];
