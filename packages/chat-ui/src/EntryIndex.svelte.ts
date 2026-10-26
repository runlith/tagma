import { SvelteMap } from 'svelte/reactivity';
import { ChunkedList } from './ChunkedList';
import type { ChatEntry, ChatEntryKind } from './entries';

type EntryOf<K extends ChatEntryKind> = Extract<ChatEntry, { kind: K }>;

const NONE: readonly ChatEntry[] = [];

const idOf = (entry: ChatEntry): string => entry.id;

export class EntryIndex {
  private readonly lists = new Map<ChatEntryKind, ChunkedList<ChatEntry>>();
  private readonly snapshots = new Map<ChatEntryKind, readonly ChatEntry[]>();
  private readonly versions = new SvelteMap<ChatEntryKind, number>();
  private readonly members = new SvelteMap<ChatEntryKind, number>();
  private readonly counts = new Map<ChatEntryKind, number>();

  constructor(private readonly positionOf: (entryId: string) => number) {}

  of<K extends ChatEntryKind>(kind: K): readonly EntryOf<K>[] {
    this.versions.get(kind);
    let snapshot = this.snapshots.get(kind);
    if (snapshot === undefined) {
      snapshot = this.lists.get(kind)?.slice() ?? NONE;
      this.snapshots.set(kind, snapshot);
    }
    return snapshot as readonly EntryOf<K>[];
  }

  after<K extends ChatEntryKind>(kind: K, position: number): EntryOf<K> | undefined {
    this.versions.get(kind);
    const list = this.lists.get(kind);
    if (list === undefined) return undefined;
    return list.at(this.rankAt(list, position + 1)) as EntryOf<K> | undefined;
  }

  before<K extends ChatEntryKind>(kind: K, position: number): EntryOf<K> | undefined {
    this.versions.get(kind);
    const list = this.lists.get(kind);
    if (list === undefined) return undefined;
    return list.at(this.rankAt(list, position) - 1) as EntryOf<K> | undefined;
  }

  closesRun(kind: ChatEntryKind, position: number, runId: string): boolean {
    this.members.get(kind);
    const list = this.lists.get(kind);
    if (list === undefined) return true;
    return list.at(this.rankAt(list, position + 1))?.runId !== runId;
  }

  patch(at: number, held: ChatEntry, next: ChatEntry): void {
    if (held.kind === next.kind) {
      const list = this.lists.get(next.kind);
      const rank = list?.indexOf(held.id) ?? -1;
      if (list === undefined || rank < 0) return;
      list.set(rank, next);
      this.touch(next.kind, held.id !== next.id || held.runId !== next.runId);
      return;
    }
    this.take(held);
    const list = this.listOf(next.kind);
    list.splice(this.rankAt(list, at), 0, [next]);
    this.touch(next.kind, true);
  }

  splice(from: number, removed: readonly ChatEntry[], inserted: readonly ChatEntry[]): void {
    const touched = new Set<ChatEntryKind>();
    for (const entry of removed) {
      this.take(entry);
      touched.add(entry.kind);
    }
    const byKind = new Map<ChatEntryKind, ChatEntry[]>();
    for (const entry of inserted) {
      const group = byKind.get(entry.kind);
      if (group === undefined) byKind.set(entry.kind, [entry]);
      else group.push(entry);
    }
    for (const [kind, group] of byKind) {
      const list = this.listOf(kind);
      list.splice(this.rankAt(list, from), 0, group);
      touched.add(kind);
    }
    for (const kind of touched) this.touch(kind, true);
  }

  private take(entry: ChatEntry): void {
    const list = this.lists.get(entry.kind);
    const rank = list?.indexOf(entry.id) ?? -1;
    if (list === undefined || rank < 0) return;
    list.splice(rank, 1, []);
    this.touch(entry.kind, true);
  }

  private rankAt(list: ChunkedList<ChatEntry>, position: number): number {
    let low = 0;
    let high = list.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (this.positionOf(list.at(middle)!.id) < position) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  private touch(kind: ChatEntryKind, moved: boolean): void {
    this.snapshots.delete(kind);
    const count = (this.counts.get(kind) ?? 0) + 1;
    this.counts.set(kind, count);
    this.versions.set(kind, count);
    if (moved) this.members.set(kind, count);
  }

  private listOf(kind: ChatEntryKind): ChunkedList<ChatEntry> {
    let list = this.lists.get(kind);
    if (list === undefined) {
      list = new ChunkedList<ChatEntry>(idOf);
      this.lists.set(kind, list);
    }
    return list;
  }
}
