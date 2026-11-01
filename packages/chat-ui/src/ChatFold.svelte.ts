import type { ThreadAttachment } from '@runlith/agent/transcript/entries';
import { markThreadEntry, type ThreadEntryPlacement, type ThreadRewindMark } from '@runlith/agent/transcript/eventFold';
import type { FeedApply, FeedHeld } from '@runlith/agent/transcript/feedFold';
import type { FeedPosition, ThreadOpenEntry } from '@runlith/agent/transcript/live';
import { appendedEntry, openText, withOpenText } from '@runlith/agent/transcript/openText';
import type { ThreadTranscriptEntry } from '@runlith/agent/transcript/rows';
import { userMessageEntryId } from '@runlith/agent/transcript/entryNames';
import { untrack } from 'svelte';
import { markAppended } from './appended';
import { ChunkedList } from './ChunkedList';
import { EntryIndex } from './EntryIndex.svelte';
import { FeedRecords } from './FeedRecords';
import { type ChatAnswerSending, type ChatEntry, type ChatEntryHandlers, questionOpen } from './entries';
import { ChangeLog, type FeedChange, type FeedChanges, type FeedSource, patchOf, spliceOf } from './feedChanges';
import { TranscriptProjection } from './entryProjection';

const weights = new WeakMap<ChatEntry, number>();

function entryWeight(entry: ChatEntry): number {
  const held = weights.get(entry);
  if (held !== undefined) return held;
  const weight = bytesOf(entry);
  weights.set(entry, weight);
  return weight;
}

function bytesOf(value: unknown): number {
  if (typeof value === 'string') return value.length * 2;
  if (typeof value !== 'object' || value === null) return 8;
  let total = 16;
  for (const field of Array.isArray(value) ? value : Object.values(value)) total += bytesOf(field);
  return total;
}

export type ChatStreamTurn = {
  anchorId: string | null;
  turnKey?: string;
};

type QuestionEntry = Extract<ChatEntry, { kind: 'question' }>;

export class ChatFold implements FeedSource {
  private revisionState = $state.raw(0);
  private nextLocalUserId = 0;
  private bytes = 0;
  private readonly pendingUserIds = new Set<string>();
  private readonly sending = new Map<string, ChatAnswerSending>();
  private readonly list = new ChunkedList<ChatEntry>((entry) => entry.id);
  private readonly log = new ChangeLog<FeedChanges<ChatEntry>>();
  private pendingChanges: FeedChange<ChatEntry>[] | null = null;
  private materialized: { readonly revision: number; readonly entries: ChatEntry[] } | null = null;
  private readonly projection: TranscriptProjection;
  private readonly records = new FeedRecords();
  readonly index = new EntryIndex((entryId) => this.list.indexOf(entryId));
  before: number | null = null;

  constructor(private readonly handlers?: ChatEntryHandlers) {
    this.projection = new TranscriptProjection(handlers);
  }

  readAttachment(url: string, signal: AbortSignal): Promise<string> {
    const read = this.handlers?.readAttachment;
    return read === undefined ? Promise.reject(new Error('This chat reads no attachments.')) : read.call(this.handlers, url, signal);
  }

  get revision(): number {
    return this.revisionState;
  }

  get length(): number {
    this.revisionState;
    return this.list.length;
  }

  get entries(): readonly ChatEntry[] {
    const revision = this.revisionState;
    if (this.materialized?.revision !== revision) this.materialized = { revision, entries: this.list.slice() };
    return this.materialized.entries;
  }

  get weight(): number {
    return this.bytes;
  }

  get openQuestion(): boolean {
    return this.index.of('question').some(questionOpen);
  }

  asking(questionId: string): boolean {
    return this.index.of('question').some((entry) => entry.questionId === questionId && questionOpen(entry));
  }

  set entries(next: readonly ChatEntry[]) {
    this.mutate(() => this.replace(next.slice()));
  }

  since(revision: number): readonly FeedChanges<ChatEntry>[] | null {
    return this.log.since(revision);
  }

  snapshot(): ChatEntry[] {
    return this.list.slice();
  }

  at(entryId: string): number | undefined {
    const at = this.list.indexOf(entryId);
    return at < 0 ? undefined : at;
  }

  opensRun(entryId: string): boolean {
    const at = this.at(entryId);
    const runId = at === undefined ? undefined : this.list.at(at)?.runId;
    if (at === undefined || runId === undefined) return false;
    if (this.index.before('user', at)?.runId === runId) return false;
    let said = this.index.before('words', at);
    while (said !== undefined && said.runId === runId) {
      if (said.opensTurn) return false;
      const prior = this.at(said.id);
      said = prior === undefined ? undefined : this.index.before('words', prior);
    }
    return true;
  }

  held(at: FeedPosition | null): FeedHeld {
    return this.records.held(at);
  }

  apply(ops: readonly FeedApply[]): void {
    this.mutate(() => {
      for (const op of ops) this.take(op);
    });
  }

  prepend(entries: readonly ThreadTranscriptEntry[], before: number | null): void {
    this.mutate(() => {
      for (const raw of entries) this.records.store(raw);
      const shown = this.marked(this.projection.entries(entries));
      if (shown.length > 0) this.spliceAt(0, 0, shown);
    });
    this.before = before;
  }

  lacking(): readonly { readonly id: string; readonly from: number }[] {
    return this.records.lacking();
  }

  prefix(id: string, from: number, text: string): boolean {
    const raw = this.records.get(id);
    const held = raw === undefined ? null : openText(raw);
    if (raw === undefined || held === null || !this.records.open.has(id) || from + text.length !== this.records.startOf(id)) return false;
    const whole = withOpenText(raw, text + held);
    this.records.store(whole, from);
    this.mutate(() => {
      for (const entry of this.present(whole)) {
        const at = this.list.indexOf(entry.id);
        if (at >= 0) this.patchAt(at, entry);
      }
    });
    return true;
  }

  replaceEntry(raw: ThreadTranscriptEntry, entryId: string): void {
    const at = this.list.indexOf(entryId);
    const entry = this.present(raw).find((candidate) => candidate.id === entryId);
    if (at < 0 || entry === undefined) return;
    this.records.store(raw);
    this.mutate(() => this.patchAt(at, entry));
  }

  clearQuestion(questionId: string): void {
    this.mutate(() => {
      for (const entry of untrack(() => this.index.of('question'))) {
        if (entry.questionId === questionId && questionOpen(entry)) this.patchAt(this.list.indexOf(entry.id), { ...entry, cleared: true });
      }
    });
  }

  beginUserMessage(input: { text: string; turnKey: string; attachments?: readonly ThreadAttachment[] }): ChatStreamTurn {
    const id = `user-${Date.now().toString(36)}-${(this.nextLocalUserId++).toString(36)}`;
    const pending: ChatEntry = {
      id,
      kind: 'user',
      turnKey: input.turnKey,
      text: input.text,
      occurredAt: new Date().toISOString(),
      attachments: input.attachments ? input.attachments.map((attachment) => ({ ...attachment })) : undefined,
    };
    this.spliceAt(this.list.length, 0, [pending]);
    this.pendingUserIds.add(pending.id);
    return { anchorId: pending.id, turnKey: input.turnKey };
  }

  adoptUserMessage(turn: ChatStreamTurn, runId: string): void {
    const pending = turn.anchorId;
    if (!pending || !this.pendingUserIds.delete(pending)) return;
    const durable = userMessageEntryId(runId);
    this.pendingUserIds.add(durable);
    turn.anchorId = durable;
    const at = this.list.indexOf(pending);
    if (at < 0) return;
    if (this.list.has(durable)) {
      this.spliceAt(at, 1, []);
      return;
    }
    this.patchAt(at, { ...this.list.at(at)!, id: durable, runId });
  }

  sendAnswer(questionId: string, sending: ChatAnswerSending): void {
    this.sending.set(questionId, sending);
    this.markQuestion(questionId);
  }

  unconfirmedAnswer(key: string): void {
    const questionId = this.sentFor(key);
    const sent = questionId === undefined ? undefined : this.sending.get(questionId);
    if (questionId === undefined || sent === undefined || sent.unconfirmed) return;
    this.sending.set(questionId, { ...sent, unconfirmed: true });
    this.markQuestion(questionId);
  }

  withdrawAnswer(key: string): void {
    const questionId = this.sentFor(key);
    if (questionId === undefined) return;
    this.sending.delete(questionId);
    this.markQuestion(questionId);
  }

  withdrawAnswers(): void {
    for (const sent of [...this.sending.values()]) this.withdrawAnswer(sent.key);
  }

  confirmAnswer(key: string): void {
    const questionId = this.sentFor(key);
    const sent = questionId === undefined ? undefined : this.sending.get(questionId);
    if (questionId === undefined || sent === undefined) return;
    this.sending.delete(questionId);
    this.mutate(() => {
      for (const entry of untrack(() => this.index.of('question'))) {
        if (entry.questionId === questionId && entry.sending?.key === key)
          this.patchAt(this.list.indexOf(entry.id), { ...unmarked(entry), answers: sent.answers });
      }
    });
  }

  settledAnswers(): readonly string[] {
    if (this.sending.size === 0) return [];
    const settled: string[] = [];
    for (const entry of untrack(() => this.index.of('question'))) {
      const sent = this.sending.get(entry.questionId);
      if (sent !== undefined && !asks(entry)) settled.push(sent.key);
    }
    return settled;
  }

  retract(turn: ChatStreamTurn): void {
    if (turn.anchorId) this.retireUserMessage(turn.anchorId);
  }

  runWithdrawn(runId: string): void {
    this.retireUserMessage(userMessageEntryId(runId));
  }

  retireUserMessage(entryId: string): void {
    if (!this.pendingUserIds.delete(entryId)) return;
    const at = this.list.indexOf(entryId);
    if (at >= 0) this.spliceAt(at, 1, []);
  }

  standing(entryId: string): boolean {
    return this.list.has(entryId) && !this.pendingUserIds.has(entryId);
  }

  pending(entryId: string): boolean {
    return this.pendingUserIds.has(entryId);
  }

  unconfirmed(turn: ChatStreamTurn): void {
    const at = turn.anchorId === null || !this.pendingUserIds.has(turn.anchorId) ? -1 : this.list.indexOf(turn.anchorId);
    const held = this.list.at(at);
    if (held?.kind !== 'user' || held.unconfirmed) return;
    this.patchAt(at, { ...held, unconfirmed: true });
  }

  private sentFor(key: string): string | undefined {
    for (const [questionId, sent] of this.sending) if (sent.key === key) return questionId;
    return undefined;
  }

  private markQuestion(questionId: string): void {
    this.mutate(() => {
      for (const entry of untrack(() => this.index.of('question'))) {
        if (entry.questionId !== questionId) continue;
        const next = this.sendingOn(unmarked(entry));
        if (!sameEntry(entry, next)) this.patchAt(this.list.indexOf(entry.id), next);
      }
    });
  }

  private marked(entries: ChatEntry[]): ChatEntry[] {
    return this.sending.size === 0 ? entries : entries.map((entry) => this.sendingOn(entry));
  }

  private sendingOn(entry: ChatEntry): ChatEntry {
    if (entry.kind !== 'question' || !asks(entry)) return entry;
    const sending = this.sending.get(entry.questionId);
    return sending === undefined ? entry : { ...entry, sending };
  }

  private take(op: FeedApply): void {
    switch (op.op) {
      case 'reset':
        this.reset(op.transcript, op.open, op.before);
        return;
      case 'place':
        this.place(op.placement, op.closesOpen);
        return;
      case 'put':
        this.put(op.entry, op.from);
        return;
      case 'append':
        this.grow(op.id, op.text);
        return;
      case 'drop':
        this.remove(op.id);
        return;
      case 'progress':
        return;
    }
  }

  private reset(transcript: readonly ThreadTranscriptEntry[], open: readonly ThreadOpenEntry[], before: number | null): void {
    const held = this.list.slice();
    this.records.clear();
    for (const raw of transcript) this.records.store(raw);
    for (const one of open) {
      this.records.store(one.entry, one.from);
      this.records.open.add(one.entry.id);
    }
    const streaming = this.projection.entries(open.map((one) => one.entry)).map(streamingEntry);
    this.replace(this.keepPendingTurns(this.marked([...this.projection.entries(transcript), ...streaming])));
    this.carry(held);
    this.before = before;
  }

  private place(placement: ThreadEntryPlacement, settles: boolean): void {
    if (settles && 'entry' in placement) this.records.open.delete(placement.entry.id);
    switch (placement.kind) {
      case 'append':
        this.append(placement.entry);
        return;
      case 'prepend': {
        this.records.store(placement.entry);
        const shown = this.present(placement.entry);
        if (shown.length > 0) this.spliceAt(0, 0, shown);
        return;
      }
      case 'replace':
        this.replaceRecord(placement.entry, settles);
        return;
      case 'withdraw':
        for (const id of placement.ids) this.remove(id);
        return;
      case 'mark':
        for (const id of placement.ids) this.mark(id, placement.rewound);
        return;
    }
  }

  private append(raw: ThreadTranscriptEntry): void {
    if (this.list.has(raw.id)) {
      this.replaceRecord(raw, true);
      return;
    }
    this.records.store(raw);
    for (const entry of this.present(raw)) {
      const echoed = entry.kind === 'user' && entry.turnKey !== undefined ? this.pendingTurn(entry.turnKey) : -1;
      if (echoed >= 0) {
        this.pendingUserIds.delete(this.list.at(echoed)!.id);
        this.spliceAt(echoed, 1, [entry]);
        continue;
      }
      this.spliceAt(this.tail(), 0, [entry]);
    }
  }

  private replaceRecord(raw: ThreadTranscriptEntry, settles: boolean): void {
    this.records.store(raw);
    for (const entry of this.present(raw)) {
      this.pendingUserIds.delete(entry.id);
      const at = this.list.indexOf(entry.id);
      if (at < 0) {
        this.spliceAt(this.tail(), 0, [entry]);
        continue;
      }
      const held = this.list.at(at)!;
      const target = settles ? this.tail() : at;
      if (target < at) {
        this.spliceAt(at, 1, []);
        this.spliceAt(target, 0, [entry]);
      } else if (held !== entry && !sameEntry(held, entry)) this.patchAt(at, entry);
    }
  }

  private mark(id: string, rewound: ThreadRewindMark | null): void {
    const raw = this.records.get(id);
    if (raw === undefined) return;
    const marked = markThreadEntry(raw, rewound);
    this.records.store(marked, this.records.startOf(id));
    for (const entry of this.present(marked)) {
      const at = this.list.indexOf(entry.id);
      if (at >= 0) this.patchAt(at, entry);
    }
  }

  private put(raw: ThreadTranscriptEntry, from: number): void {
    this.records.store(raw, from);
    this.records.open.add(raw.id);
    for (const entry of this.present(raw)) {
      const at = this.list.indexOf(entry.id);
      if (at < 0) this.spliceAt(this.list.length, 0, [entry]);
      else if (!sameEntry(this.list.at(at)!, entry)) this.patchAt(at, entry);
    }
  }

  private grow(id: string, text: string): void {
    const raw = this.records.get(id);
    if (raw === undefined) return;
    const grown = appendedEntry(raw, text);
    if (grown === raw) return;
    this.records.store(grown, this.records.startOf(id));
    for (const entry of this.present(grown)) {
      const at = this.list.indexOf(entry.id);
      if (at < 0) continue;
      const held = this.list.at(at)!;
      if ((held.kind === 'assistant' || held.kind === 'reasoning') && entry.kind === held.kind) markAppended(entry, held.text);
      this.patchAt(at, entry, text.length * 2);
    }
  }

  private remove(id: string): void {
    this.records.forget(id);
    const at = this.list.indexOf(id);
    if (at >= 0) this.spliceAt(at, 1, []);
  }

  private present(raw: ThreadTranscriptEntry): ChatEntry[] {
    const shown = this.marked(this.projection.entries([raw]));
    return this.records.open.has(raw.id) ? shown.map(streamingEntry) : shown;
  }

  private tail(): number {
    let start = this.list.length;
    this.list.eachBack((entry, index) => {
      if (!this.pendingUserIds.has(entry.id)) return false;
      start = index;
      return true;
    });
    for (const id of this.records.open) {
      const at = this.list.indexOf(id);
      if (at >= 0 && at < start) start = at;
    }
    return start;
  }

  private pendingTurn(turnKey: string): number {
    for (const id of this.pendingUserIds) {
      const at = this.list.indexOf(id);
      const entry = at < 0 ? undefined : this.list.at(at);
      if (entry?.kind === 'user' && entry.turnKey === turnKey) return at;
    }
    return -1;
  }

  private mutate(work: () => void): void {
    if (this.pendingChanges !== null) {
      work();
      return;
    }
    const changes: FeedChange<ChatEntry>[] = [];
    this.pendingChanges = changes;
    try {
      work();
    } finally {
      this.pendingChanges = null;
      if (changes.length > 0) {
        this.log.record(changes);
        this.revisionState = this.log.revision;
      }
    }
  }

  private patchAt(at: number, entry: ChatEntry, delta?: number): void {
    const held = this.list.at(at)!;
    if (held.id !== entry.id) {
      this.spliceAt(at, 1, [entry]);
      return;
    }
    this.mutate(() => {
      this.list.set(at, entry);
      const weight = delta === undefined ? entryWeight(entry) : entryWeight(held) + delta;
      weights.set(entry, weight);
      this.bytes += weight - entryWeight(held);
      this.index.patch(at, held, entry);
      this.pendingChanges!.push(patchOf(at, entry));
    });
  }

  private spliceAt(from: number, removed: number, inserted: readonly ChatEntry[]): void {
    this.mutate(() => {
      const gone = this.list.splice(from, removed, inserted);
      for (const entry of gone) this.bytes -= entryWeight(entry);
      for (const entry of inserted) this.bytes += entryWeight(entry);
      this.index.splice(from, gone, inserted);
      this.pendingChanges!.push(spliceOf(from, gone, inserted));
    });
  }

  private replace(next: ChatEntry[]): void {
    const held = this.list.slice();
    let head = 0;
    while (head < held.length && head < next.length && held[head]!.id === next[head]!.id) head += 1;
    let tail = 0;
    while (
      tail < held.length - head &&
      tail < next.length - head &&
      held[held.length - 1 - tail]!.id === next[next.length - 1 - tail]!.id
    ) {
      tail += 1;
    }
    this.mutate(() => {
      for (let at = 0; at < head; at += 1) {
        if (held[at] !== next[at] && !sameEntry(held[at]!, next[at]!)) this.patchAt(at, next[at]!);
      }
      const gone = held.slice(head, held.length - tail);
      const known = new Map(gone.map((entry) => [entry.id, entry]));
      const inserted = next.slice(head, next.length - tail).map((entry) => {
        const was = known.get(entry.id);
        return was !== undefined && sameEntry(was, entry) ? was : entry;
      });
      if (gone.length > 0 || inserted.length > 0) this.spliceAt(head, gone.length, inserted);
      const after = head + inserted.length;
      for (let offset = 0; offset < tail; offset += 1) {
        const was = held[held.length - tail + offset]!;
        const now = next[next.length - tail + offset]!;
        if (was !== now && !sameEntry(was, now)) this.patchAt(after + offset, now);
      }
    });
  }

  private carry(held: readonly ChatEntry[]): void {
    if (held.length === 0) return;
    const before = new Map(held.map((entry) => [entry.id, entry]));
    const restored: { at: number; entry: ChatEntry }[] = [];
    let at = 0;
    for (const entry of this.list) {
      const was = before.get(entry.id);
      if (was !== undefined && was !== entry && sameEntry(was, entry)) restored.push({ at, entry: was });
      at += 1;
    }
    for (const place of restored) this.patchAt(place.at, place.entry);
  }

  private keepPendingTurns(restored: ChatEntry[]): ChatEntry[] {
    if (this.pendingUserIds.size === 0) return restored;
    const present = new Set(restored.map((entry) => entry.id));
    const echoed = new Set(restored.flatMap((entry) => (entry.kind === 'user' && entry.turnKey ? [entry.turnKey] : [])));
    const kept: ChatEntry[] = [];
    for (const entry of this.list) {
      if (!this.pendingUserIds.has(entry.id)) continue;
      const answered = present.has(entry.id) || (entry.kind === 'user' && entry.turnKey !== undefined && echoed.has(entry.turnKey));
      if (answered) this.pendingUserIds.delete(entry.id);
      else kept.push(entry);
    }
    for (const id of [...this.pendingUserIds]) {
      if (present.has(id)) this.pendingUserIds.delete(id);
    }
    return kept.length === 0 ? restored : [...restored, ...kept];
  }
}

function asks(entry: QuestionEntry): boolean {
  return entry.answers === undefined && entry.cleared !== true;
}

function unmarked(entry: QuestionEntry): QuestionEntry {
  if (entry.sending === undefined) return entry;
  const { sending: _sending, ...rest } = entry;
  return rest;
}

function streamingEntry(entry: ChatEntry): ChatEntry {
  return entry.kind === 'assistant' ? { ...entry, assistantState: 'streaming' } : entry;
}

function sameEntry(held: ChatEntry, next: ChatEntry): boolean {
  const fields = Object.keys(held);
  if (fields.length !== Object.keys(next).length) return false;
  const a = held as unknown as Record<string, unknown>;
  const b = next as unknown as Record<string, unknown>;
  return fields.every((field) => a[field] === b[field]);
}
