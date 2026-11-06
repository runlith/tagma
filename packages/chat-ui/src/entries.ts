import type { AgentRuntimeGuidance, AgentSignalNotice, ThreadSignalAddressee } from '@runlith/agent/contracts';
import type {
  ThreadCompactionReceipt,
  ThreadCompactionSummarizer,
  ThreadFailureDiagnostics,
  ThreadInteractionPrompt,
  ThreadInterruptedInput,
  ThreadQuestionEntry,
  ThreadReadyAnswer,
  ThreadRestartEntry,
  ThreadRunEndEntry,
  ThreadSummarizerSkip,
  ThreadToolEntry,
  ThreadToolState,
} from '@runlith/agent/transcript/entries';
import type { ThreadEntryUndecodable } from '@runlith/agent/transcript/kinds';
import type { ThreadTranscriptEntry } from '@runlith/agent/transcript/rows';
import type { ThreadRewindMark } from '@runlith/agent/transcript/eventFold';
import type { ToolDisplay } from '@runlith/agent/tool/display';

export type ChatEntryKind =
  | 'context'
  | 'user'
  | 'assistant'
  | 'compaction'
  | 'error'
  | 'unreadable'
  | 'interruption'
  | 'restart'
  | 'run-end'
  | 'product'
  | 'question'
  | 'reasoning'
  | 'retry'
  | 'runtime-guidance'
  | 'signal'
  | 'ready-answers'
  | 'system-prompt'
  | 'tool'
  | 'words';

export type ChatAttachment = {
  mime: string;
  url: string;
  filename?: string;
};

export type ChatQuestionPrompt = ThreadInteractionPrompt;
export type ChatQuestionAnswer = NonNullable<ThreadQuestionEntry['answers']>[number];

export type ChatEntryBase = {
  id: string;
  runId?: string;
  occurredAt?: string;
  rewound?: ThreadRewindMark;
};

export type ChatAttachedDoc = {
  title?: string;
  text: string;
};

export type ChatWordsSender = {
  readonly name: string;
  readonly threadId?: string;
  readonly projectId?: number;
};

export type ChatKeptWarm = {
  readonly status: ThreadRunEndEntry['status'];
  readonly usage?: ThreadRunEndEntry['usage'];
  readonly account?: string;
};

type ChatMessageBody = {
  text: string;
  attachments?: readonly ChatAttachment[];
  attachedDocs?: readonly ChatAttachedDoc[];
};

export type ProductEntry<P = unknown> = ChatEntryBase & { kind: 'product'; product: string; payload: P };

declare const carried: unique symbol;

export type ProductId<P> = { readonly product: string; readonly [carried]?: P };

export function productId<P>(product: string): ProductId<P> {
  return { product };
}

export function productEntry<P>(id: ProductId<P>, base: ChatEntryBase, payload: P): ProductEntry<P> {
  return { ...base, kind: 'product', product: id.product, payload };
}

export function productPayload<P>(id: ProductId<P>, entry: ChatEntry): P | undefined {
  return entry.kind === 'product' && entry.product === id.product ? (entry.payload as P) : undefined;
}

export function entryKindOf(entry: ChatEntry): string {
  return entry.kind === 'product' ? entry.product : entry.kind;
}

export type ChatEntry =
  | (Omit<ThreadRunEndEntry, 'type'> & { kind: 'run-end'; rewound?: ThreadRewindMark })
  | (ChatEntryBase & ChatMessageBody & { kind: 'user'; turnKey?: string; unconfirmed?: true })
  | (ChatEntryBase & ChatMessageBody & { kind: 'assistant'; assistantState?: 'streaming' | 'done' })
  | (ChatEntryBase & { kind: 'error'; text: string; diagnostics: ThreadFailureDiagnostics })
  | (ChatEntryBase & { kind: 'unreadable'; refusal: ThreadEntryUndecodable })
  | (ChatEntryBase & { kind: 'interruption'; text?: string })
  | (ChatEntryBase & {
      kind: 'restart';
      stoppedRunId?: string;
      byThreadId?: string;
      continued: boolean;
      calls: ThreadRestartEntry['calls'];
    })
  | (ChatEntryBase & {
      kind: 'compaction';
      mode: 'automatic' | 'manual';
      compactionStatus: 'running' | 'completed' | 'unchanged' | 'aborted' | 'failed';
      compactionReceipt?: ThreadCompactionReceipt;
      compactionSummarizer?: ThreadCompactionSummarizer;
      compactionUnsummarized?: { readonly skipped: readonly ThreadSummarizerSkip[] };
    })
  | (ChatEntryBase & {
      kind: 'signal';
      signalType: string;
      addressee: ThreadSignalAddressee;
      text: string;
      title?: string;
      notice?: AgentSignalNotice;
      attachments?: readonly ChatAttachment[];
      attachedDocs?: readonly ChatAttachedDoc[];
      keptWarm?: ChatKeptWarm;
    })
  | (ChatEntryBase &
      ChatMessageBody & {
        kind: 'words';
        intent: string;
        sender: ChatWordsSender | null;
        unconfirmed?: true;
        opensTurn?: true;
      })
  | (ChatEntryBase & { kind: 'context'; text: string })
  | (ChatEntryBase & {
      kind: 'retry';
      attempt: number;
      of: number;
      family: string;
      delayMs: number;
      message?: string;
    })
  | ProductEntry
  | (ChatEntryBase & { kind: 'system-prompt'; text: string })
  | (ChatEntryBase & { kind: 'reasoning'; text: string; reasoningState?: 'streaming' | 'done' })
  | (ChatEntryBase & { kind: 'runtime-guidance'; runtimeGuidance: AgentRuntimeGuidance })
  | (ChatEntryBase & {
      kind: 'tool';
      toolName: string;
      toolCallId: string;
      toolState: ThreadToolState;
      toolRefusal?: ThreadToolEntry['toolRefusal'];
      execution?: ThreadToolEntry['execution'];
      toolInput?: unknown;
      toolOutput?: unknown;
      display?: ToolDisplay;
      toolError?: string;
      toolInputRaw?: ThreadInterruptedInput;
      truncated?: number;
    })
  | (ChatEntryBase & {
      kind: 'question';
      questionId: string;
      toolCalls: ThreadQuestionEntry['toolCalls'];
      prompts: ThreadQuestionEntry['questions'];
      answers?: readonly ChatQuestionAnswer[];
      sending?: ChatAnswerSending;
      cleared?: boolean;
      approver?: string;
      approverName?: string;
      decision?: { readonly by?: string; readonly note?: string };
      deliveryUnknown?: boolean;
      deliveryNote?: string;
    })
  | (ChatEntryBase & { kind: 'ready-answers'; answers: readonly ThreadReadyAnswer[] });

export type ToolConfirmationEntry = {
  id: string;
  questionId: string;
  prompts: ThreadQuestionEntry['questions'];
  answers?: readonly ChatQuestionAnswer[];
  sending?: ChatAnswerSending;
  cleared?: boolean;
  approver?: string;
  approverName?: string;
  decision?: { readonly by?: string; readonly note?: string };
  deliveryUnknown?: boolean;
  deliveryNote?: string;
  occurredAt?: string;
};

export type ChatAnswerSending = {
  readonly key: string;
  readonly answers: readonly ChatQuestionAnswer[];
  readonly unconfirmed: boolean;
};

export function questionOpen(question: Extract<ChatEntry, { kind: 'question' }> | ToolConfirmationEntry): boolean {
  return question.answers === undefined && question.cleared !== true && question.sending === undefined;
}

export type ChatEntryHandlers = {
  transcriptEntry?(entry: ThreadTranscriptEntry): ChatEntry[] | null;
  attachmentUrl?(url: string): string;
  readAttachment?(url: string, signal: AbortSignal): Promise<string>;
};
