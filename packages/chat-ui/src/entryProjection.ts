import { THREAD_TOOL_CONFIRM_KIND, USER_QUESTION_TOOL_NAME } from '@runlith/agent/transcript/parts';
import { type AgentRuntimeGuidance, USER_MESSAGE_SIGNAL_TYPE } from '@runlith/agent/contracts';
import type { ThreadQuestionEntry, ThreadSignalEntry } from '@runlith/agent/transcript/entries';
import { opensTurnEntry } from '@runlith/agent/thread/rewind';
import { coreEntry, ThreadEntryUnreadable } from '@runlith/agent/transcript/kinds';
import type { ThreadTranscriptEntry } from '@runlith/agent/transcript/rows';
import type { ToolDisplay } from '@runlith/agent/tool/display';
import type { ChatAttachment, ChatEntry, ChatEntryHandlers, ChatWordsSender, ToolConfirmationEntry } from './entries';

export class TranscriptProjection {
  private readonly projected = new WeakMap<ThreadTranscriptEntry, readonly ChatEntry[]>();

  constructor(private readonly handlers?: ChatEntryHandlers) {}

  entries(transcript: readonly ThreadTranscriptEntry[]): ChatEntry[] {
    const entries: ChatEntry[] = [];
    for (const raw of transcript) {
      let shown = this.projected.get(raw);
      if (shown === undefined) {
        shown = marked(raw, entryFromTranscript(raw, this.handlers));
        this.projected.set(raw, shown);
      }
      for (const entry of shown) entries.push(entry);
    }
    return entries;
  }
}

function marked(raw: ThreadTranscriptEntry, entries: ChatEntry[]): ChatEntry[] {
  const mark = raw.rewound;
  return mark === undefined ? entries : entries.map((entry) => ({ ...entry, rewound: mark }));
}

export function toolConfirmationFromEntry(entry: ChatEntry): ToolConfirmationEntry | null {
  if (entry.kind !== 'question') return null;
  const prompts = entry.prompts.filter(isToolConfirmationPrompt);
  if (prompts.length === 0 || prompts.length !== entry.prompts.length) return null;
  return {
    id: entry.id,
    questionId: entry.questionId,
    prompts,
    answers: entry.answers,
    sending: entry.sending,
    cleared: entry.cleared,
    approver: entry.approver,
    approverName: entry.approverName,
    decision: entry.decision,
    deliveryUnknown: entry.deliveryUnknown === true ? true : undefined,
    deliveryNote: entry.deliveryNote,
    occurredAt: entry.occurredAt,
  };
}

export function isToolConfirmationEntry(entry: ChatEntry): boolean {
  return toolConfirmationFromEntry(entry) !== null;
}

export function runtimeGuidanceChatEntry(runtimeGuidance: AgentRuntimeGuidance): ChatEntry {
  return {
    id: runtimeGuidance.id,
    kind: 'runtime-guidance',
    runId: runtimeGuidance.runId,
    runtimeGuidance,
    occurredAt: runtimeGuidance.occurredAt,
  };
}

function shownAttachments(
  attachments: readonly ChatAttachment[] | undefined,
  handlers?: ChatEntryHandlers,
): { attachments?: readonly ChatAttachment[] } {
  if (!attachments || attachments.length === 0) return {};
  return {
    attachments: attachments.map((attachment) => ({
      mime: attachment.mime,
      url: handlers?.attachmentUrl?.(attachment.url) ?? attachment.url,
      filename: attachment.filename,
    })),
  };
}

function shownDisplay(display: ToolDisplay, handlers?: ChatEntryHandlers): ToolDisplay {
  const address = handlers?.attachmentUrl;
  if (!address || !display.images || display.images.length === 0) return display;
  return { ...display, images: display.images.map((image) => ({ ...image, url: address(image.url) })) };
}

export function entryFromTranscript(raw: ThreadTranscriptEntry, handlers?: ChatEntryHandlers): ChatEntry[] {
  if (ThreadEntryUnreadable.is(raw))
    return [{ kind: 'unreadable', id: raw.id, runId: raw.runId, occurredAt: raw.occurredAt, refusal: raw.refusal }];
  const plugin = handlers?.transcriptEntry?.(raw);
  if (plugin) return plugin;
  if (!coreEntry(raw)) return [];
  const event = raw;
  if (event.type === 'run-end') {
    const { type, ...ending } = event;
    return [{ ...ending, kind: 'run-end' }];
  }
  if (event.type === 'failure') {
    return [
      {
        id: event.id,
        kind: 'error',
        runId: event.runId,
        occurredAt: event.occurredAt,
        text: event.message,
        diagnostics: event.diagnostics,
      },
    ];
  }
  if (event.type === 'message') {
    if (event.role !== 'user' && event.role !== 'assistant') return [];
    const shown = {
      id: event.id,
      runId: event.runId,
      occurredAt: event.occurredAt,
      text: event.text,
      ...shownAttachments(event.attachments, handlers),
    };
    return [event.role === 'user' ? { ...shown, kind: 'user', turnKey: event.turnKey } : { ...shown, kind: 'assistant' }];
  }
  if (event.type === 'reasoning') {
    return [
      {
        id: event.id,
        kind: 'reasoning',
        runId: event.runId,
        occurredAt: event.occurredAt,
        text: event.text,
        reasoningState: event.state,
      },
    ];
  }
  if (event.type === 'runtime-guidance') {
    return [runtimeGuidanceChatEntry(event)];
  }
  if (event.type === 'interruption') {
    return [
      {
        id: event.id,
        kind: 'interruption',
        runId: event.runId,
        text: event.text,
        occurredAt: event.occurredAt,
      },
    ];
  }
  if (event.type === 'restart') {
    return [
      {
        id: event.id,
        kind: 'restart',
        runId: event.runId,
        occurredAt: event.occurredAt,
        stoppedRunId: event.stoppedRunId,
        byThreadId: event.byThreadId,
        continued: event.continued,
        calls: event.calls,
      },
    ];
  }
  if (event.type === 'compaction') {
    return [
      {
        id: event.id,
        kind: 'compaction',
        runId: event.runId,
        occurredAt: event.occurredAt,
        mode: event.mode,
        compactionStatus: event.status,
        compactionReceipt: event.receipt,
        compactionSummarizer: event.summarizer,
        compactionUnsummarized: event.noSummarizer,
      },
    ];
  }
  if (event.type === 'retry') {
    return [
      {
        id: event.id,
        kind: 'retry',
        runId: event.runId,
        occurredAt: event.occurredAt,
        attempt: event.attempt,
        of: event.of,
        family: event.family,
        delayMs: event.delayMs,
        message: event.message,
      },
    ];
  }
  if (event.type === 'tool') {
    if (event.toolName === USER_QUESTION_TOOL_NAME) return [];
    return [
      {
        id: event.id,
        kind: 'tool',
        runId: event.runId,
        occurredAt: event.occurredAt,
        toolName: event.toolName,
        toolCallId: event.toolCallId,
        toolState: event.toolState,
        toolInput: event.toolInput,
        toolOutput: event.toolOutput,
        display: event.toolDisplay ? shownDisplay(event.toolDisplay, handlers) : undefined,
        toolError: event.toolError,
        toolRefusal: event.toolRefusal,
        execution: event.execution,
        toolInputRaw: event.toolInputRaw,
        truncated: event.truncated,
      },
    ];
  }
  if (event.type === 'signal') {
    const words = wordsOf(event);
    if (words !== null) {
      return [
        {
          id: event.id,
          kind: 'words',
          intent: event.signalType,
          sender: words.sender,
          runId: event.runId,
          occurredAt: event.occurredAt,
          text: event.text,
          ...shownAttachments(event.attachments, handlers),
          unconfirmed: event.unconfirmed,
          opensTurn: (words.sender !== null && opensTurnEntry(event)) || undefined,
        },
      ];
    }
    return [
      {
        id: event.id,
        kind: 'signal',
        signalType: event.signalType,
        addressee: event.addressee,
        runId: event.runId,
        occurredAt: event.occurredAt,
        title: event.title,
        text: event.text,
        notice: event.notice,
        ...shownAttachments(event.attachments, handlers),
      },
    ];
  }
  if (event.type === 'system-prompt') {
    return [
      {
        id: event.id,
        kind: 'system-prompt',
        runId: event.runId,
        occurredAt: event.occurredAt,
        text: event.text,
      },
    ];
  }
  if (event.type === 'context') {
    return [
      {
        id: event.id,
        kind: 'context',
        runId: event.runId,
        occurredAt: event.occurredAt,
        text: event.text,
      },
    ];
  }
  if (event.type === 'question') {
    return [
      {
        id: event.id,
        kind: 'question',
        runId: event.runId,
        questionId: event.questionId,
        toolCalls: event.toolCalls,
        prompts: event.questions,
        answers: event.status === 'answered' ? (event.answers ?? []) : undefined,
        cleared: event.status === 'cleared' || event.status === 'lapsed' ? true : undefined,
        approver: event.approver,
        approverName: event.approverName,
        decision: event.decision,
        deliveryUnknown: event.deliveryUnknown === true ? true : undefined,
        deliveryNote: event.deliveryNote,
        occurredAt: event.occurredAt,
      },
    ];
  }
  if (event.type === 'ready-answers') {
    return [
      {
        id: event.id,
        kind: 'ready-answers',
        runId: event.runId,
        answers: event.answers,
        occurredAt: event.occurredAt,
      },
    ];
  }
  return [];
}

export function wordsOf(entry: ThreadSignalEntry): { readonly sender: ChatWordsSender | null } | null {
  if (entry.addressee === 'reader') return entry.signalType === USER_MESSAGE_SIGNAL_TYPE ? { sender: null } : null;
  const name = entry.title ?? entry.senderThreadId;
  return name === undefined ? null : { sender: { name, threadId: entry.senderThreadId, projectId: entry.senderProjectId } };
}

function isToolConfirmationPrompt(
  prompt: ThreadQuestionEntry['questions'][number] | undefined,
): prompt is ThreadQuestionEntry['questions'][number] {
  return prompt?.kind === THREAD_TOOL_CONFIRM_KIND;
}
