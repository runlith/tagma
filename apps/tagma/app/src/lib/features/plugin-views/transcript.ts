import type {
  TranscriptEntry,
  TranscriptEvent,
  TranscriptPage,
  TranscriptTail,
  TranscriptToolState,
} from '@tagma/server/threads/contract/wire/transcript';
import { appendedFrom } from '@runlith/chat-ui/appended';
import type { ChatFold } from '@runlith/chat-ui/ChatFold.svelte';
import { type ChatEntry, questionOpen } from '@runlith/chat-ui/entries';

const PAGE = 40;

type ToolEntry = Extract<ChatEntry, { kind: 'tool' }>;

type Shown = { readonly entry: TranscriptEntry; readonly flying: boolean };

type Scan = {
  readonly kept: readonly ChatEntry[];
  readonly lowest: number;
  readonly anchor: string | null;
  readonly hungry: boolean;
};

export const toolStateOf = (state: ToolEntry['toolState']): typeof TranscriptToolState.Type => {
  switch (state) {
    case 'input-streaming':
    case 'input-available':
      return 'running';
    case 'output-available':
      return 'done';
    case 'output-refused':
    case 'output-denied':
      return 'refused';
    case 'input-interrupted':
    case 'output-error':
    case 'output-cancelled':
    case 'output-unknown':
      return 'failed';
  }
};

const toolOf = (entry: ToolEntry): NonNullable<TranscriptEntry['tool']> => ({
  name: entry.toolName,
  state: toolStateOf(entry.toolState),
  input: entry.toolInput ?? null,
  ...(entry.toolOutput === undefined ? {} : { output: entry.toolOutput }),
});

function shownOf(entry: ChatEntry): Shown | null {
  if (entry.rewound !== undefined) return null;
  const base = { id: entry.id, runId: entry.runId ?? null };
  switch (entry.kind) {
    case 'user':
      return { entry: { ...base, role: 'user', text: entry.text }, flying: false };
    case 'words': {
      const sender = entry.sender;
      const from =
        sender === null ? {} : { sender: { name: sender.name, ...(sender.threadId === undefined ? {} : { threadId: sender.threadId }) } };
      return { entry: { ...base, role: 'user', ...from, text: entry.text }, flying: false };
    }
    case 'assistant':
      return { entry: { ...base, role: 'assistant', text: entry.text }, flying: entry.assistantState === 'streaming' };
    case 'tool':
      return { entry: { ...base, role: 'tool', tool: toolOf(entry) }, flying: entry.toolState === 'input-streaming' };
    case 'question':
      return {
        entry: { ...base, role: 'question', question: { id: entry.questionId, prompts: entry.prompts, answered: !questionOpen(entry) } },
        flying: false,
      };
    case 'error':
    case 'signal':
      return { entry: { ...base, role: 'notice', text: entry.text }, flying: false };
    case 'interruption':
      return { entry: { ...base, role: 'notice', ...(entry.text === undefined ? {} : { text: entry.text }) }, flying: false };
    case 'run-end':
      return { entry: { ...base, role: 'notice', text: entry.status }, flying: false };
    case 'context':
    case 'compaction':
    case 'unreadable':
    case 'restart':
    case 'product':
    case 'retry':
    case 'runtime-guidance':
    case 'ready-answers':
    case 'system-prompt':
    case 'reasoning':
      return null;
  }
}

export class TranscriptFollow {
  private revision = 0;
  private floor: string | null = null;
  private last: string | null = null;
  private readonly sent = new Map<string, ChatEntry>();
  private readonly flying = new Map<string, ChatEntry>();
  private tail: readonly ChatEntry[] = [];

  constructor(
    private readonly threadId: string,
    private readonly fold: ChatFold,
    private readonly count: number = PAGE,
  ) {}

  start(): Extract<TranscriptEvent, { type: 'initial' }> {
    this.revision = this.fold.revision;
    this.sent.clear();
    this.flying.clear();
    const entries = this.fold.snapshot();
    const flying: ChatEntry[] = [];
    const scan = this.scan(entries, entries.length, flying);
    for (const kept of scan.kept) this.sent.set(kept.id, kept);
    for (const flown of flying) this.flying.set(flown.id, flown);
    this.tail = flying;
    this.floor = scan.anchor;
    this.last = scan.kept.at(-1)?.id ?? null;
    return {
      type: 'initial',
      threadId: this.threadId,
      entries: this.shown(scan.kept),
      more: scan.lowest > 0 || this.fold.before !== null,
      tail: this.shown(flying),
    };
  }

  older(): Scan {
    return this.scan(this.fold.snapshot(), this.floorAt(), null);
  }

  taken(read: Scan): TranscriptPage {
    for (const kept of read.kept) this.sent.set(kept.id, kept);
    if (read.anchor !== null) this.floor = read.anchor;
    return { threadId: this.threadId, entries: this.shown(read.kept), more: read.lowest > 0 || this.fold.before !== null };
  }

  step(): TranscriptEvent[] {
    const revision = this.fold.revision;
    if (revision === this.revision) return [];
    const batches = this.fold.since(this.revision);
    this.revision = revision;
    if (batches === null) return [this.start()];
    const now = new Map<string, ChatEntry | null>();
    for (const batch of batches) {
      for (const change of batch) {
        if (change.kind === 'patch') {
          now.set(change.item.id, change.item);
          continue;
        }
        for (const gone of change.removed) now.set(gone.id, null);
        for (const added of change.inserted) now.set(added.id, added);
      }
    }
    const floor = this.floorAt();
    const gone: string[] = [];
    const settled: TranscriptEntry[] = [];
    let moved = false;
    for (const [id, entry] of now) {
      const at = entry === null ? undefined : this.fold.at(id);
      const shown = entry === null || at === undefined || at < floor || this.fold.pending(id) ? null : shownOf(entry);
      if (this.flying.delete(id)) moved = true;
      if (shown === null || entry === null) {
        if (this.drop(id)) gone.push(id);
        continue;
      }
      if (shown.flying) {
        if (this.drop(id)) gone.push(id);
        this.flying.set(id, entry);
        moved = true;
        continue;
      }
      if (this.sent.get(id) === entry) continue;
      if (!this.sent.has(id)) {
        if (this.behind(at!)) return [this.start()];
        this.last = id;
      }
      this.sent.set(id, entry);
      settled.push(shown.entry);
    }
    return this.events(gone, settled, moved);
  }

  private drop(id: string): boolean {
    const held = this.sent.delete(id);
    if (!held || id !== this.last) return held;
    let newest = -1;
    this.last = null;
    for (const standing of this.sent.keys()) {
      const index = this.fold.at(standing) ?? -1;
      if (index <= newest) continue;
      newest = index;
      this.last = standing;
    }
    return held;
  }

  private behind(at: number): boolean {
    const last = this.last === null ? undefined : this.fold.at(this.last);
    return last !== undefined && at < last;
  }

  private events(gone: readonly string[], settled: readonly TranscriptEntry[], moved: boolean): TranscriptEvent[] {
    const events: TranscriptEvent[] = [];
    if (gone.length > 0) events.push({ type: 'removed', threadId: this.threadId, ids: gone });
    for (const entry of settled) events.push({ type: 'entry', threadId: this.threadId, entry });
    const tail = moved ? this.tailEvent() : null;
    if (tail !== null) events.push({ type: 'tail', threadId: this.threadId, tail });
    return events;
  }

  private tailEvent(): TranscriptTail | null {
    const now = [...this.flying.values()].sort((a, b) => (this.fold.at(a.id) ?? 0) - (this.fold.at(b.id) ?? 0));
    const before = this.tail;
    this.tail = now;
    if (now.length === before.length && now.every((entry, at) => entry === before[at])) return null;
    return this.grown(before, now) ?? { restart: true, entries: this.shown(now) };
  }

  private grown(before: readonly ChatEntry[], now: readonly ChatEntry[]): TranscriptTail | null {
    if (before.length !== now.length) return null;
    let changed = -1;
    for (let at = 0; at < now.length; at += 1) {
      if (before[at] === now[at]) continue;
      if (changed >= 0 || before[at]!.id !== now[at]!.id) return null;
      changed = at;
    }
    const was = before[changed];
    const is = now[changed];
    if (was?.kind !== 'assistant' || is?.kind !== 'assistant' || appendedFrom(is) !== was.text) return null;
    return { restart: false, id: is.id, text: is.text.slice(was.text.length) };
  }

  private floorAt(): number {
    if (this.floor === null) return 0;
    const at = this.fold.at(this.floor);
    if (at !== undefined) return at;
    let lowest: number | undefined;
    let anchor: string | null = null;
    for (const id of this.sent.keys()) {
      const index = this.fold.at(id);
      if (index === undefined || (lowest !== undefined && index >= lowest)) continue;
      lowest = index;
      anchor = id;
    }
    this.floor = anchor;
    return lowest ?? 0;
  }

  private scan(entries: readonly ChatEntry[], end: number, flying: ChatEntry[] | null): Scan {
    const kept: ChatEntry[] = [];
    let at = end;
    while (at > 0 && kept.length < this.count) {
      at -= 1;
      const entry = entries[at]!;
      const shown = this.fold.pending(entry.id) ? null : shownOf(entry);
      if (shown === null) continue;
      if (shown.flying) flying?.unshift(entry);
      else kept.unshift(entry);
    }
    return {
      kept,
      lowest: at,
      anchor: at < end ? entries[at]!.id : null,
      hungry: kept.length < this.count && this.fold.before !== null,
    };
  }

  private shown(entries: readonly ChatEntry[]): TranscriptEntry[] {
    return entries.flatMap((entry) => shownOf(entry)?.entry ?? []);
  }
}
