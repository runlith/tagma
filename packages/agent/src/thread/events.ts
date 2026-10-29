import { attachedDocumentText } from '../transcript/attachments';
import { Effect, Schema } from 'effect';
import { Message, ToolCallPart, ToolResultPart } from '@runlith/llm/schema/messages';
import { Usage } from '@runlith/llm/schema/events';
import type { AgentCallMeasurement } from '../agent/AgentCallMeasurement';
import { decodeThreadEventPayloadResult, type ThreadCallMeasurement, threadEventPayloadSchema } from './persisted';
import { ThreadEntryUndecodable, coreEntry, entryOf, type ThreadEntryReader } from '../transcript/kinds';
import type { AgentToolModelOutput } from '../agent/ToolOutput';
import type { StructuredValue } from '@runlith/utils/object';
import {
  agentGuideMessage,
  agentRuntimeGuidanceMessage,
  agentSignalMessages,
  withAgentOrigin,
  withAgentReaderInput,
} from '../agent/AgentSignal';
import type { AgentSignalPart, AgentRuntimeGuidance, PendingRuntimeGuide } from '../agent/contracts';
import type {
  ThreadAttachment,
  ThreadCompactionEntry,
  ThreadCompositionEntry,
  ThreadContextChangeEntry,
  ThreadFailureEntry,
  ThreadMessageEntry,
  ThreadQuestionEntry,
  ThreadSignalEntry,
  ThreadSystemPromptEntry,
} from '../transcript/entries';
import {
  contextChangeEntryId,
  interruptionEntryId,
  runEndEntryId,
  signalEntryId,
  spokenMessageEntryId,
  systemPromptEntryId,
  toolEntryId,
  userMessageEntryId,
} from '../transcript/entryNames';
import type { ThreadSignal } from '../transcript/parts';
import type { ThreadContextChange, ThreadContextReading, ThreadContextRecord, ThreadRunRow } from './rows';
import { ThreadRunEndEntry, settleTool, toolInputJson, type ThreadRunSpend } from '../transcript/entries';
import type { ThreadTranscript, ThreadTranscriptEntry } from '../transcript/rows';
import type { StoredThreadAttachment } from './attachmentStorage';
import { threadFailureEntry } from './ThreadFailure';
import type { ThreadTurnContext } from './agents/ThreadAgent';
import { type ThreadPortFailure } from './ThreadBorder';
import { ThreadStorageFailed } from './persisted';
import type { ThreadEventLogStorage, ThreadEventPayloadValue, ThreadRecordWindow } from './storage/eventLog';
import type { ThreadRestored, ThreadRewound } from './rewind';
import type { ThreadBranchedCut } from '../transcript/eventFold';

export type ThreadStepContext = {
  readonly runId: string;
  readonly stepNumber: number;
  readonly activity?: string;
  readonly provider: string | null;
  readonly model: string | null;
  readonly contextWindow: number | null;
  readonly inputLimit?: number | null;
  readonly measuredAt: string;
};

export type ThreadEventPayload = {
  readonly bodyInFold?: boolean;
  readonly entry?: ThreadTranscriptEntry;
  readonly messages?: readonly Message[];
  readonly usage?: Usage;
  readonly context?: ThreadStepContext;
  readonly measurement?: ThreadCallMeasurement;
  readonly contextChange?: ThreadContextChange;
  readonly withdrawn?: ThreadWithdrawal;
  readonly compacted?: ThreadHistoryFold;
  readonly rewound?: ThreadRewound;
  readonly restored?: ThreadRestored;
  readonly branched?: ThreadBranchedCut;
};

export type ThreadHistoryFold = {
  readonly keepFrom: number;
  readonly messages: readonly Message[];
};

export type ThreadWithdrawal = {
  readonly runId: string;
  readonly keepMessages: number;
};

export type ThreadEventBody = {
  readonly kind: string;
  readonly payload: ThreadEventPayload;
};

export type ThreadTurnEvent<T extends ThreadTranscriptEntry = ThreadTranscriptEntry> = ThreadEventBody & {
  readonly payload: ThreadEventPayload & { readonly entry: T };
};

export type ThreadEventDraft = {
  readonly kind: string;
  readonly compose: (eventId: string) => ThreadEventPayload;
};

export type ThreadEventInput = ThreadEventBody | ThreadEventDraft;

export function decodeThreadEventPayload(kinds: ThreadEntryReader, value: unknown): ThreadEventPayload {
  const parsed = decodeThreadEventPayloadResult(kinds, value);
  if (parsed._tag === 'Failure') throw eventPayloadFailure(value, parsed.failure);
  return parsed.success;
}

export type ThreadEventRecord = {
  readonly threadId: string;
  readonly position: number;
  readonly id: string;
  readonly kind: string;
  readonly payload: ThreadEventPayload;
};

export function readThreadEvents<TTx>(
  log: ThreadEventLogStorage<TTx>,
  kinds: ThreadEntryReader,
  threadId: string,
  afterPosition: number,
  limit: number,
  tx?: TTx,
): Effect.Effect<readonly ThreadEventRecord[], ThreadPortFailure> {
  return decoded(kinds, 'eventsAfter', log.eventsAfter(threadId, afterPosition, limit, tx));
}

export function readThreadRecordsAsOf<TTx>(
  log: ThreadEventLogStorage<TTx>,
  kinds: ThreadEntryReader,
  threadId: string,
  window: ThreadRecordWindow,
  tx?: TTx,
): Effect.Effect<readonly ThreadEventRecord[], ThreadPortFailure> {
  return decoded(kinds, 'recordsAsOf', log.recordsAsOf(threadId, window, tx));
}

export type ThreadEventUnavailable = {
  readonly threadId: string;
  readonly position: number;
  readonly family: string;
  readonly reason: string;
};

export type ThreadEventEvidence<Row extends ThreadEventRecord> =
  | { readonly _tag: 'Available'; readonly record: Row }
  | { readonly _tag: 'Unavailable'; readonly evidence: ThreadEventUnavailable };

export function readThreadRecordEvidenceAsOf<TTx>(
  log: ThreadEventLogStorage<TTx>,
  kinds: ThreadEntryReader,
  threadId: string,
  window: ThreadRecordWindow,
  tx?: TTx,
): Effect.Effect<readonly ThreadEventEvidence<ThreadEventRecord>[], ThreadPortFailure> {
  return decodedEvidence(kinds, log.recordsAsOf(threadId, window, tx));
}

export function readThreadRevisionsAsOf<TTx>(
  log: ThreadEventLogStorage<TTx>,
  kinds: ThreadEntryReader,
  threadId: string,
  window: ThreadRecordWindow,
  tx?: TTx,
): Effect.Effect<readonly ThreadRevisionRecord[], ThreadPortFailure> {
  return decoded(kinds, 'revisionsAsOf', log.revisionsAsOf(threadId, window, tx));
}

export type ThreadRevisionRecord = ThreadEventRecord & { readonly identity: string };

export function readThreadRevisionEvidenceAsOf<TTx>(
  log: ThreadEventLogStorage<TTx>,
  kinds: ThreadEntryReader,
  threadId: string,
  window: ThreadRecordWindow,
  tx?: TTx,
): Effect.Effect<readonly ThreadEventEvidence<ThreadRevisionRecord>[], ThreadPortFailure> {
  return decodedEvidence(kinds, log.revisionsAsOf(threadId, window, tx));
}

export const THREAD_TAIL_POSITIONS = 64;

const STEP_KINDS: readonly string[] = ['step', 'step-finished'];

export function readThreadRunStepsTaken<TTx>(
  log: ThreadEventLogStorage<TTx>,
  kinds: ThreadEntryReader,
  run: { readonly id: string; readonly threadId: string },
  tail: { readonly positions?: number } = {},
  tx?: TTx,
): Effect.Effect<number, ThreadPortFailure> {
  const positions = tail.positions ?? THREAD_TAIL_POSITIONS;
  const steps = (head: number, after: number, limit: number) =>
    readThreadRecordsAsOf(log, kinds, run.threadId, { head, afterPosition: Math.max(0, after), limit, kinds: STEP_KINDS }, tx);
  return Effect.gen(function* () {
    const head = yield* log.headPosition(run.threadId, tx);
    let rows = yield* steps(head, head - positions, positions);
    if (rows.length === 0) {
      let at = head - positions;
      let span = positions;
      let low: number | null = null;
      while (at > 0 && low === null) {
        const oldest = yield* steps(at, at - span, 1);
        if (oldest.length > 0) low = oldest[0]!.position;
        else {
          at -= span;
          span *= 2;
        }
      }
      if (low === null) return 0;
      let high = at;
      while (high - low >= positions) {
        const middle = Math.floor((low + high) / 2);
        const later = yield* steps(high, middle, 1);
        if (later.length > 0) low = later[0]!.position;
        else high = middle;
      }
      rows = yield* steps(high, high - positions, positions);
    }
    let taken = 0;
    for (const record of rows) {
      const context = record.payload.context;
      if (context?.runId !== run.id) continue;
      taken = Math.max(taken, context.stepNumber + 1);
    }
    return taken;
  });
}

export const readThreadContextEvidence = Effect.fnUntraced(function* <TTx>(
  log: ThreadEventLogStorage<TTx>,
  kinds: ThreadEntryReader,
  change: { readonly threadId: string; readonly runId: string; readonly requestId: string },
  tx?: TTx,
): Effect.fn.Return<ThreadContextChange | null, ThreadPortFailure> {
  const position = yield* log.positionOf(change.threadId, contextChangeEntryId(change.runId, change.requestId), tx);
  if (position === null) return null;
  const rows = yield* readThreadRecordsAsOf(
    log,
    kinds,
    change.threadId,
    { head: position, afterPosition: position - 1, limit: 1, kinds: ['context-change'] },
    tx,
  );
  return rows[0]?.payload.contextChange ?? null;
});

function decoded<Row extends { readonly payload: ThreadEventPayloadValue }>(
  kinds: ThreadEntryReader,
  call: string,
  read: Effect.Effect<readonly Row[], ThreadPortFailure>,
): Effect.Effect<readonly (Omit<Row, 'payload'> & { payload: ThreadEventPayload })[], ThreadPortFailure> {
  return Effect.flatMap(read, (rows) =>
    Effect.try({
      try: () => rows.map((row) => ({ ...row, payload: decodeThreadEventPayload(kinds, row.payload) })),
      catch: (cause) => new ThreadStorageFailed({ call, cause }),
    }),
  );
}

function decodedEvidence<
  Row extends {
    readonly threadId: string;
    readonly position: number;
    readonly id: string;
    readonly kind: string;
    readonly payload: ThreadEventPayloadValue;
  },
>(
  kinds: ThreadEntryReader,
  read: Effect.Effect<readonly Row[], ThreadPortFailure>,
): Effect.Effect<readonly ThreadEventEvidence<Omit<Row, 'payload'> & { readonly payload: ThreadEventPayload }>[], ThreadPortFailure> {
  return Effect.map(read, (rows) =>
    rows.map((row) => {
      const parsed = decodeThreadEventPayloadResult(kinds, row.payload);
      if (parsed._tag === 'Success') {
        return { _tag: 'Available', record: { ...row, payload: parsed.success } } as const;
      }
      return {
        _tag: 'Unavailable',
        evidence: {
          threadId: row.threadId,
          position: row.position,
          family: parsed.failure instanceof ThreadEntryUndecodable ? 'entry' : eventPayloadFamily(row.payload),
          reason: parsed.failure.message,
        },
      } as const;
    }),
  );
}

function eventPayloadFailure(value: unknown, error: Schema.SchemaError | ThreadEntryUndecodable): Error {
  const family = error instanceof ThreadEntryUndecodable ? 'entry' : eventPayloadFamily(value);
  return new Error(`Persisted thread event ${family} cannot be read — ${error.message}`);
}

function eventPayloadFamily(value: unknown): string {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'payload';
  const payload = value as Record<string, unknown>;
  const broken: string[] = [];
  for (const [family, schema] of Object.entries(threadEventPayloadSchema.fields)) {
    if (!(family in payload)) continue;
    if (Schema.decodeUnknownResult(schema)(payload[family])._tag === 'Failure') broken.push(family);
  }
  return broken.length === 0 ? 'payload' : broken.join(',');
}

export function threadMessageEntry(
  id: string,
  role: 'user' | 'assistant',
  runId: string,
  text: string,
  occurredAt: string,
  attachments?: readonly ThreadAttachment[],
): ThreadMessageEntry {
  return { type: 'message', id, role, runId, text, occurredAt, attachments: attachments?.length ? attachments : undefined };
}

export function threadSignalEntry(
  signal: ThreadSignal,
  runId: string | null,
  attachments?: readonly ThreadAttachment[],
): ThreadSignalEntry {
  return {
    type: 'signal',
    id: signalEntryId(signal.id),
    runId: runId || undefined,
    signalType: signal.type,
    addressee: signal.addressee,
    text: signal.text,
    title: signal.from,
    senderThreadId: signal.senderThreadId,
    senderProjectId: signal.senderProjectId,
    notice: signal.notice,
    attachments: attachments?.length ? attachments : undefined,
    occurredAt: signal.occurredAt,
  };
}

export function threadEntryEvent(entry: ThreadTranscriptEntry): ThreadEventBody {
  return { kind: entry.type, payload: { entry } };
}

export function threadRunEndEvent(run: ThreadRunRow, reading: ThreadContextReading | null = null): ThreadEventBody | null {
  if (run.status === 'running' || run.status === 'withdrawn' || run.finishedAt === null) return null;
  const account = reading?.runId === run.id ? reading.account : (run.account ?? undefined);
  const entry: ThreadRunEndEntry = {
    type: 'run-end',
    id: runEndEntryId(run.id),
    runId: run.id,
    status: run.status,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt.toISOString(),
    occurredAt: run.finishedAt.toISOString(),
    usage: run.usage ? runSpend(run.usage) : undefined,
    account: account,
  };
  return threadEntryEvent(entry);
}

function runSpend(usage: Usage): ThreadRunSpend {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadInputTokens: usage.cacheReadInputTokens,
    cacheWriteInputTokens: usage.cacheWriteInputTokens,
  };
}

export function threadStepMessagesEvent(
  messages: readonly Message[],
  step?: { readonly context: ThreadStepContext; readonly usage?: Usage },
): ThreadEventBody | null {
  if (messages.length === 0 && step?.usage === undefined) return null;
  return {
    kind: 'step',
    payload: {
      messages: [...messages],
      context: step?.context,
      usage: step?.usage,
    },
  };
}

export function threadStepFinishedEvent(context: ThreadStepContext, usage?: Usage): ThreadEventBody {
  return { kind: 'step-finished', payload: { context, usage: usage } };
}

export function threadMeasurementEvent(measurement: AgentCallMeasurement): ThreadEventBody {
  return { kind: 'measurement', payload: { measurement } };
}

export function threadCompositionEvent(entry: ThreadCompositionEntry): ThreadEventBody {
  return { kind: 'composition', payload: { entry } };
}

export function threadContextChangeEvent(change: ThreadContextChange): ThreadEventBody {
  const entry: ThreadContextChangeEntry = {
    type: 'context-change',
    id: contextChangeEntryId(change.runId, change.requestId),
    runId: change.runId,
    requestId: change.requestId,
    sourceKey: change.sourceKey,
    status: change.outcome,
    fromGeneration: change.fromGeneration,
    generation: change.record ? change.record.generation : undefined,
    stepNumber: change.stepNumber,
    detail: change.detail,
    occurredAt: change.requestedAt,
    updatedAt: change.settledAt,
  };
  return { kind: 'context-change', payload: { entry, contextChange: change } };
}

export function threadContextOf(entries: readonly ThreadTranscriptEntry[]): ThreadContextRecord | null {
  let admitted: ThreadContextRecord | null = null;
  for (const change of entries.filter(entryOf('context-change'))) {
    if (change.status !== 'published' || change.generation === undefined) continue;
    if (admitted !== null && change.generation <= admitted.generation) continue;
    admitted = { generation: change.generation, sourceKey: change.sourceKey, requestId: change.requestId };
  }
  return admitted;
}

export function threadPendingContextChange(entries: readonly ThreadTranscriptEntry[]): ThreadContextChangeEntry | null {
  return entries.filter(entryOf('context-change')).find((change) => change.status === 'pending') ?? null;
}

export function threadGuidanceEvent(frame: AgentRuntimeGuidance): ThreadEventBody {
  return {
    kind: 'runtime-guidance',
    payload: {
      entry: frame,
      messages: frame.texts.map((text, index) =>
        agentRuntimeGuidanceMessage(text, frame.sources[index]?.state, frame.sources[index]?.retell),
      ),
    },
  };
}

export function threadQuestionEvent(question: ThreadQuestionEntry, messages?: readonly Message[]): ThreadEventBody {
  return { kind: 'question', payload: { entry: question, messages: messages?.length ? messages : undefined } };
}

export function threadCutEvent(runId: string, gapMs: number, reason?: string): ThreadEventBody {
  return {
    kind: 'interruption',
    payload: {
      entry: {
        type: 'interruption',
        id: interruptionEntryId(runId),
        runId,
        text: reason === undefined ? threadCutSentence(gapMs) : `Interrupted: ${reason}.`,
        occurredAt: new Date().toISOString(),
      },
    },
  };
}

export function threadCutSentence(gapMs: number): string {
  if (gapMs < 0) {
    return 'Interrupted: the process driving this run left, and its clock disagrees with this one, so the run was not resumed.';
  }
  const minutes = Math.max(1, Math.round(gapMs / 60_000));
  return `Interrupted: the process driving this run left ${minutes} minute${minutes === 1 ? '' : 's'} ago and it was not resumed.`;
}

export type ThreadInterruptionMark = { readonly steers: number };

export function threadInterruptionEvent(runId: string, steers: number): ThreadEventBody {
  return {
    kind: 'interruption',
    payload: {
      entry: {
        type: 'interruption',
        id: interruptionEntryId(runId),
        runId,
        text: steers > 0 ? `Interrupted to deliver ${steers} steer${steers === 1 ? '' : 's'}` : 'Interrupted by user',
        occurredAt: new Date().toISOString(),
      },
    },
  };
}

export function threadTailEvents(
  runId: string,
  tail: ThreadTranscript,
  interruption: ThreadInterruptionMark | null,
): readonly ThreadEventBody[] {
  const events = tail.map((entry) => {
    if (!coreEntry(entry)) return threadEntryEvent(entry);
    if (entry.type === 'reasoning' && entry.state === 'streaming') {
      return threadEntryEvent({ ...entry, state: 'done' });
    }
    if (entry.type === 'message' && entry.role === 'assistant') {
      return { kind: entry.type, payload: { entry, messages: [Message.assistant(entry.text)] } };
    }
    return threadEntryEvent(entry);
  });
  return interruption ? [...events, threadInterruptionEvent(runId, interruption.steers)] : events;
}

export function threadWithdrawalEvent(runId: string, keepMessages: number): ThreadEventBody {
  return { kind: 'withdrawal', payload: { withdrawn: { runId, keepMessages } } };
}

export function threadSignalArrival(
  signal: ThreadSignal,
  runId: string | null,
  attachments?: readonly StoredThreadAttachment[],
): ThreadSignalEntry {
  return threadSignalEntry(signal, runId, attachments?.map(transcriptAttachment));
}

export function threadSignalEvent(
  signal: ThreadSignal,
  runId: string | null,
  options: { title?: string; modelText?: string; attachments?: readonly StoredThreadAttachment[]; unconfirmed?: true } = {},
): ThreadTurnEvent {
  const arrived = threadSignalArrival(signal, runId, options.attachments);
  const entry = options.unconfirmed ? { ...arrived, unconfirmed: options.unconfirmed } : arrived;
  return {
    kind: 'signal',
    payload: {
      entry: options.title ? { ...entry, title: options.title } : entry,
      messages: agentSignalMessages(
        options.modelText ? { ...signal, text: options.modelText } : signal,
        options.attachments === undefined ? undefined : attachmentParts(options.attachments),
      ),
    },
  };
}

export function threadSignalOpening(signal: ThreadSignal, runId: string, said: string): ThreadTurnEvent {
  return { kind: 'signal', payload: { entry: threadSignalEntry(signal, runId), messages: [userMessage({ text: said, reader: false })] } };
}

export function threadSystemPromptEvent(runId: string, text: string): ThreadEventBody {
  const entry: ThreadSystemPromptEntry = {
    type: 'system-prompt',
    id: systemPromptEntryId(runId),
    runId,
    text,
    occurredAt: new Date().toISOString(),
  };
  return { kind: 'system-prompt', payload: { entry } };
}

export function threadFailureEvent(run: ThreadRunRow, error: unknown): ThreadEventBody {
  const entry: ThreadFailureEntry = threadFailureEntry(run, error);
  return { kind: 'failure', payload: { entry } };
}

export function threadCompactionEvent(
  entry: ThreadCompactionEntry,
  compacted?: { readonly keepFrom: number; readonly messages: readonly Message[] },
): ThreadEventBody {
  return { kind: 'compaction', payload: { entry, compacted: compacted } };
}

export function threadPruningEvent(fold: ThreadHistoryFold): ThreadEventBody {
  return { kind: 'pruning', payload: { compacted: fold } };
}

export function threadBranchEvent(cut: ThreadBranchedCut): ThreadEventBody {
  return { kind: 'branch', payload: { branched: cut } };
}

export type ThreadUserTurnInput = {
  readonly text: string;
  readonly attachments?: readonly StoredThreadAttachment[];
  readonly turnKey?: string;
  readonly reader: boolean;
  readonly guides?: readonly PendingRuntimeGuide[];
};

export function threadUserMessageEvent(run: { readonly id: string }, input: ThreadUserTurnInput): ThreadTurnEvent<ThreadMessageEntry> {
  const attachments = input.attachments?.map(transcriptAttachment);
  const entryId = userMessageEntryId(run.id);
  return {
    kind: 'message',
    payload: {
      entry: {
        ...threadMessageEntry(entryId, 'user', run.id, input.text, new Date().toISOString(), attachments),
        turnKey: input.turnKey || undefined,
      },
      messages: [
        input.reader ? withAgentReaderInput(userMessage(input), entryId) : userMessage(input),
        ...(input.guides ?? []).map(agentGuideMessage),
      ],
    },
  };
}

export type ThreadSpokenToolRecord = {
  readonly toolName: string;
  readonly toolCallId: string;
  readonly input: unknown;
  readonly modelOutput: AgentToolModelOutput;
  readonly output?: StructuredValue;
  readonly error?: string;
};

export function threadSpokenMessageEvent(input: { role: 'assistant' | 'user'; text: string; occurredAt: string }): ThreadEventDraft {
  return {
    kind: 'message',
    compose: (eventId) => ({
      entry: {
        type: 'message',
        id: spokenMessageEntryId(eventId),
        role: input.role,
        text: input.text,
        occurredAt: input.occurredAt,
      } satisfies ThreadMessageEntry,
      messages: [Message.make({ role: input.role, content: input.text })],
    }),
  };
}

export function threadSpokenToolEvent(record: ThreadSpokenToolRecord, occurredAt: string): ThreadEventBody {
  return {
    kind: 'tool',
    payload: {
      entry: {
        type: 'tool',
        id: toolEntryId(record.toolCallId),
        toolName: record.toolName,
        toolCallId: record.toolCallId,
        toolInput: toolInputJson(record.input),
        ...settleTool(record.error ? { kind: 'failed', error: record.error } : { kind: 'answered', output: record.output }),
        occurredAt,
      },
      messages: [
        Message.assistant([ToolCallPart.from({ id: record.toolCallId, name: record.toolName, input: record.input })]),
        Message.tool(ToolResultPart.from({ id: record.toolCallId, name: record.toolName, result: record.modelOutput })),
      ],
    },
  };
}

export function threadUntranscribedTurnEvent(entry: ThreadTranscriptEntry, placeholder: string): ThreadEventBody {
  return { kind: entry.type, payload: { entry, messages: [Message.user(placeholder)] } };
}

export function threadContextEvent<TWrite>(context: ThreadTurnContext<TWrite>): ThreadEventBody {
  return {
    kind: 'context',
    payload: {
      entry: context.entry,
      messages: [orientationMessage(context)],
    },
  };
}

function orientationMessage<TWrite>(context: ThreadTurnContext<TWrite>): Message {
  const marked = withAgentOrigin(context.message, 'orientation');
  if (context.parts === undefined || context.parts.length === 0) return marked;
  return Message.make({ ...marked, metadata: { ...marked.metadata, parts: [...context.parts] } });
}

function userMessage(input: ThreadUserTurnInput): Message {
  if (input.attachments && input.attachments.length > 0) {
    return Message.user([...(input.text ? [{ type: 'text' as const, text: input.text }] : []), ...attachmentParts(input.attachments)]);
  }
  return Message.user(input.text);
}

export function attachmentParts(attachments: readonly StoredThreadAttachment[]): AgentSignalPart[] {
  return attachments.map((attachment) =>
    attachment.text === undefined
      ? {
          type: 'media',
          mediaType: attachment.mediaType,
          data: attachment.url,
          filename: attachment.filename || undefined,
        }
      : { type: 'text', text: attachedDocumentText(attachment.text) },
  );
}

function transcriptAttachment(input: StoredThreadAttachment): ThreadAttachment {
  return {
    mime: input.mediaType,
    url: input.url,
    filename: input.filename || undefined,
  };
}
