import type { ThreadAttachmentRef } from '../transcript/attachments';
import type { ThreadQueuedTurn } from '../transcript/live';
import type { ThreadCompactionEntry } from '../transcript/entries';
import { type PendingRuntimeGuide, USER_MESSAGE_SIGNAL_TYPE } from '../agent/contracts';
import { agentSignalGuides, agentSignalMarkup, agentSignalWords } from '../agent/AgentSignal';
import type { ThreadSignal } from '../transcript/parts';
import { mintThreadSignalId } from './identity';
import { answersSummarizer, type ThreadSummarizerSelection } from './compaction/summarizer';
import type { ThreadCompactionPoint, ThreadInboxItem, ThreadInboxItemValues, ThreadInboxSender } from './storage/inbox';

type ThreadInboxItemLike = ThreadInboxItem | ThreadInboxItemValues;

export type ThreadInboxWords<T extends ThreadInboxItemLike = ThreadInboxItemLike> = Exclude<T, { kind: 'compaction' }>;
export type ThreadCompactionRequest<T extends ThreadInboxItemLike = ThreadInboxItem> = Extract<T, { kind: 'compaction' }>;

export function queuedTurnText(queued: readonly ThreadInboxItem[]): string {
  return queuedWords(queued, agentSignalWords);
}

export function queuedTurnSaid(queued: readonly ThreadInboxItem[]): {
  readonly text: string;
  readonly guides: readonly PendingRuntimeGuide[];
} {
  const signals = queued.filter(carriesWords).filter((item) => !isReaderWordsItem(item) && !saidAsOperator(item));
  return {
    text: queuedWords(queued, agentSignalMarkup),
    guides: signals.flatMap((item) => agentSignalGuides(threadSignalOfInboxItem(item))),
  };
}

function queuedWords(queued: readonly ThreadInboxItem[], said: (signal: ThreadSignal) => string): string {
  return queued
    .filter(carriesWords)
    .map((item) => (isReaderWordsItem(item) || saidAsOperator(item) ? item.body.text : said(threadSignalOfInboxItem(item))))
    .join('\n');
}

export function saidAsOperator(item: ThreadInboxItemLike): boolean {
  return item.sender.kind === 'thread' && item.sender.asOperator === true;
}

export function spokenByAgent(item: ThreadInboxItemLike): boolean {
  return item.sender.kind === 'thread' && item.sender.asOperator !== true;
}

export function threadSignalOfInboxItem(item: ThreadInboxWords): ThreadSignal {
  const address = senderAddress(item.sender);
  switch (item.kind) {
    case 'turn':
      return { id: item.id, type: USER_MESSAGE_SIGNAL_TYPE, addressee: 'reader', text: item.body.text, occurredAt: item.occurredAt };
    case 'task':
    case 'envelope':
      if (saidAsOperator(item)) {
        return { id: item.id, type: USER_MESSAGE_SIGNAL_TYPE, addressee: 'reader', text: item.body.text, occurredAt: item.occurredAt };
      }
      return {
        id: item.id,
        type: item.body.intent,
        addressee: 'transport',
        text: item.body.text,
        from: address?.from,
        senderThreadId: address?.senderThreadId,
        senderProjectId: address?.senderProjectId,
        envelopeId: address === null ? undefined : item.id,
        context: item.kind === 'envelope' ? item.body.context : undefined,
        occurredAt: item.occurredAt,
      };
    case 'signal':
      return {
        id: item.id,
        type: item.body.type,
        addressee: item.body.addressee,
        text: item.body.text,
        attachments: item.body.attachments?.length ? item.body.attachments : undefined,
        ...(address ?? {}),
        notice: item.body.notice,
        occurredAt: item.occurredAt,
      };
  }
}

function intentOf(item: ThreadInboxWords): string | undefined {
  if (item.kind === 'turn') return undefined;
  return item.kind === 'signal' ? item.body.type : item.body.intent;
}

function senderAddress(sender: ThreadInboxSender): { from: string; senderThreadId: string; senderProjectId?: number } | null {
  if (sender.kind !== 'thread') return null;
  const address = { from: sender.name ?? sender.threadId, senderThreadId: sender.threadId };
  return sender.projectId === undefined ? address : { ...address, senderProjectId: sender.projectId };
}

export function threadQueuedTurnOf(runId: string, item: ThreadInboxItemLike): ThreadQueuedTurn {
  if (item.kind === 'compaction') {
    return {
      id: item.id,
      runId,
      kind: 'compaction',
      text: '',
      keep: item.body.keep,
      summarizer: item.body.summarizer,
      occurredAt: item.occurredAt,
    };
  }
  const attachments = item.kind === 'turn' || item.kind === 'signal' ? item.body.attachments : undefined;
  const address = spokenByAgent(item) ? senderAddress(item.sender) : null;
  return {
    id: item.id,
    runId,
    text: item.body.text,
    attachments: attachments?.length ? attachments : undefined,
    from: address?.from,
    senderThreadId: address?.senderThreadId,
    senderProjectId: address?.senderProjectId,
    intent: intentOf(item),
    notice: item.kind === 'signal' ? item.body.notice : undefined,
    occurredAt: item.occurredAt,
  };
}

export function inboxTurnValues(
  threadId: string,
  input: { readonly id?: string; readonly text: string; readonly attachments?: readonly ThreadAttachmentRef[] },
): ThreadInboxItemValues {
  return {
    id: input.id ?? mintThreadSignalId(),
    threadId,
    sender: { kind: 'reader' },
    kind: 'turn',
    body: { text: input.text, attachments: input.attachments?.length ? input.attachments : undefined },
    occurredAt: new Date().toISOString(),
  };
}

export function inboxSteerValues(
  threadId: string,
  input: { readonly id?: string; readonly text: string; readonly attachments?: readonly ThreadAttachmentRef[] },
): ThreadInboxItemValues {
  return inboxSignalValues(threadId, {
    id: input.id ?? mintThreadSignalId(),
    type: USER_MESSAGE_SIGNAL_TYPE,
    addressee: 'reader',
    text: input.text,
    attachments: input.attachments?.length ? input.attachments : undefined,
    occurredAt: new Date().toISOString(),
  });
}

export function inboxSignalValues(threadId: string, signal: ThreadSignal, waits = false): ThreadInboxItemValues {
  return {
    id: signal.id,
    threadId,
    sender:
      signal.senderThreadId === undefined
        ? { kind: 'host' }
        : {
            kind: 'thread',
            threadId: signal.senderThreadId,
            name: signal.from ?? null,
            ...(signal.senderProjectId === undefined ? {} : { projectId: signal.senderProjectId }),
          },
    kind: 'signal',
    body: {
      type: signal.type,
      addressee: signal.addressee,
      text: signal.text,
      attachments: signal.attachments?.length ? signal.attachments : undefined,
      notice: signal.notice,
      waits: waits || undefined,
    },
    occurredAt: signal.occurredAt,
  };
}

export function waitsForTurn(item: ThreadInboxItemLike): boolean {
  return item.kind === 'signal' && item.body.waits === true;
}

export function inboxCompactionValues(
  threadId: string,
  input: {
    readonly at: ThreadCompactionPoint;
    readonly mode?: ThreadCompactionEntry['mode'];
    readonly keep?: string;
    readonly summarizer?: ThreadSummarizerSelection;
  },
  id: string = mintThreadSignalId(),
): ThreadCompactionRequest<ThreadInboxItemValues> {
  return {
    id,
    threadId,
    sender: { kind: 'reader' },
    kind: 'compaction',
    body: {
      at: input.at,
      mode: input.mode,
      keep: input.keep,
      summarizer: input.summarizer,
    },
    occurredAt: new Date().toISOString(),
  };
}

export function barrierIdAhead(item: Pick<ThreadInboxItemValues, 'id'>): string {
  return `compaction:${item.id}`;
}

export function behindBarrierId(barrier: string, item: string): string {
  return `${barrier}:${item}`;
}

export function behindBarrier<T extends ThreadInboxItemValues>(barrier: ThreadCompactionRequest<ThreadInboxItemValues>, item: T): T {
  return { ...item, id: behindBarrierId(barrier.id, item.id), occurredAt: barrier.occurredAt };
}

export function namedSummarizerOf(requests: readonly ThreadCompactionRequest[]): ThreadSummarizerSelection | undefined {
  return requests.find((item) => item.body.summarizer !== undefined)?.body.summarizer;
}

export function summarizerCohort<T extends ThreadCompactionRequest>(
  requests: readonly T[],
  lead: ThreadSummarizerSelection | undefined = namedSummarizerOf(requests),
): readonly T[] {
  return lead === undefined ? requests : requests.filter((item) => answersSummarizer(lead, item.body.summarizer));
}

export function isReaderWordsItem(item: ThreadInboxItemLike): boolean {
  return (
    item.kind === 'turn' || (item.kind === 'signal' && item.body.addressee === 'reader' && item.body.type === USER_MESSAGE_SIGNAL_TYPE)
  );
}

export function isUnreadSteer(item: ThreadInboxItem): boolean {
  return item.state === 'queued' && item.kind === 'signal' && isReaderWordsItem(item);
}

export function isUnreadReport(item: ThreadInboxItem): boolean {
  return item.state === 'queued' && item.kind === 'envelope' && item.body.intent === 'report';
}

export function opensTurn(item: ThreadInboxItemLike): boolean {
  return item.kind === 'turn' || item.kind === 'task';
}

export function openingWords(items: readonly ThreadInboxItem[]): readonly ThreadInboxItem[] {
  if (!items.some((item) => opensTurn(item) && !spokenByAgent(item))) return [];
  return items.filter((item) => (opensTurn(item) || isReaderWordsItem(item)) && !spokenByAgent(item));
}

export function isInboxRequest(item: ThreadInboxItemLike): item is Extract<ThreadInboxItemLike, { kind: 'task' }> {
  return item.kind === 'task';
}

export function isCompactionRequest<T extends ThreadInboxItemLike>(item: T): item is ThreadCompactionRequest<T> {
  return item.kind === 'compaction';
}

export function carriesWords<T extends ThreadInboxItemLike>(item: T): item is ThreadInboxWords<T> {
  return item.kind !== 'compaction';
}

export function isStepRequest(item: ThreadInboxItem): item is ThreadCompactionRequest {
  return item.state === 'queued' && item.kind === 'compaction' && item.body.at === 'step';
}

export function isEndBarrier(item: ThreadInboxItem): item is ThreadCompactionRequest {
  return item.state === 'queued' && item.kind === 'compaction' && item.body.at === 'end';
}

export function compactionHead(waiting: readonly ThreadInboxItem[], lead?: ThreadSummarizerSelection): readonly ThreadCompactionRequest[] {
  const head: ThreadCompactionRequest[] = waiting.filter(isStepRequest);
  for (const item of waiting) {
    if (item.state !== 'queued' || isStepRequest(item) || waitsForTurn(item)) continue;
    if (!isEndBarrier(item)) break;
    head.push(item);
  }
  return summarizerCohort(head, lead ?? namedSummarizerOf(head));
}

export function opensOnBarrier(waiting: readonly ThreadInboxItem[]): boolean {
  const head = waiting.find((item) => item.state === 'queued' && !isStepRequest(item));
  return head !== undefined && isEndBarrier(head);
}

export function beforeBarrier(waiting: readonly ThreadInboxItem[]): readonly ThreadInboxItem[] {
  const line = waiting.filter((item) => item.state === 'queued' && !isStepRequest(item));
  const barrier = line.findIndex(isEndBarrier);
  return barrier < 0 ? line : line.slice(0, barrier);
}

export function readableBefore(pending: readonly ThreadInboxItem[], segment: readonly ThreadInboxItem[]): readonly ThreadInboxItem[] {
  const ahead = new Set(segment.map((item) => item.id));
  return pending.filter((item) => carriesWords(item) && !opensTurn(item) && (item.state !== 'queued' || ahead.has(item.id)));
}

export function keptWordsOf(words: readonly (string | undefined)[]): string | undefined {
  const kept = [...new Set(words.flatMap((word) => (word?.trim() ? [word.trim()] : [])))];
  return kept.length === 0 ? undefined : kept.join('\n\n');
}

export function keepsWith(standing: ThreadCompactionRequest, keep: string | undefined, summarizer?: ThreadSummarizerSelection): boolean {
  const asked = keep?.trim();
  return (!asked || asked === standing.body.keep?.trim()) && answersSummarizer(standing.body.summarizer, summarizer);
}

export function standingCompaction(
  waiting: readonly ThreadInboxItem[],
  at: ThreadCompactionPoint,
  keep?: string,
  summarizer?: ThreadSummarizerSelection,
): ThreadCompactionRequest | null {
  const step = waiting.find((item): item is ThreadCompactionRequest => isStepRequest(item) && keepsWith(item, keep, summarizer)) ?? null;
  if (at === 'step') return step;
  const line = waiting.filter((item) => item.state === 'queued' && !isStepRequest(item));
  const tail = line.at(-1);
  if (tail !== undefined) return isEndBarrier(tail) && keepsWith(tail, keep, summarizer) ? tail : null;
  return step;
}
