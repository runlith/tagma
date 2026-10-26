import type { ArtifactRecord, ThreadPage, ThreadPages } from './contract/wire/artifacts.js';

type Member = { readonly thread: string; readonly rank: number; readonly ordinal: number; entry: Candidate | null };
type Candidate = { readonly member: Member; readonly artifact: ArtifactRecord; index: number };

class Heap<A> {
  readonly rows: A[] = [];
  private ordered = true;

  constructor(
    private readonly rank: (left: A, right: A) => number,
    private readonly placed: (value: A, at: number) => void = () => {},
  ) {}

  append(value: A): void {
    this.put(value, this.rows.length);
    this.ordered = false;
  }

  order(): void {
    if (this.ordered) return;
    for (let at = Math.floor(this.rows.length / 2) - 1; at >= 0; at -= 1) this.down(at);
    this.ordered = true;
  }

  insert(value: A): void {
    this.order();
    this.rows.push(value);
    this.up(this.rows.length - 1);
  }

  remove(at: number): A {
    const removed = this.rows[at]!;
    const last = this.rows.pop()!;
    if (at < this.rows.length) {
      this.rows[at] = last;
      this.placed(last, at);
      this.down(this.up(at));
    }
    return removed;
  }

  private put(value: A, at: number): void {
    this.rows[at] = value;
    this.placed(value, at);
  }

  private up(start: number): number {
    const value = this.rows[start]!;
    let at = start;
    while (at > 0) {
      const parent = Math.floor((at - 1) / 2);
      if (this.rank(value, this.rows[parent]!) <= 0) break;
      this.put(this.rows[parent]!, at);
      at = parent;
    }
    this.put(value, at);
    return at;
  }

  private down(start: number): void {
    const value = this.rows[start]!;
    let at = start;
    while (at * 2 + 1 < this.rows.length) {
      let child = at * 2 + 1;
      if (child + 1 < this.rows.length && this.rank(this.rows[child + 1]!, this.rows[child]!) > 0) child += 1;
      if (this.rank(value, this.rows[child]!) >= 0) break;
      this.put(this.rows[child]!, at);
      at = child;
    }
    this.put(value, at);
  }
}

const rank = (left: Candidate, right: Candidate): number => {
  const a = left.artifact.publishedAt;
  const b = right.artifact.publishedAt;
  return a < b ? -1 : a > b ? 1 : right.member.rank - left.member.rank || right.member.ordinal - left.member.ordinal;
};

export class Selection {
  readonly threads: readonly string[];
  private readonly team = new Map<string, { readonly rank: number; next: number }>();
  private readonly members = new Map<string, Member>();
  private readonly heap = new Heap<Candidate>(rank, (entry, at) => {
    entry.index = at;
  });

  constructor(
    threads: readonly string[],
    private readonly limit: number,
  ) {
    this.threads = [...new Set(threads)];
    for (const [rank, thread] of this.threads.entries()) this.team.set(thread, { rank, next: 0 });
  }

  has(id: string): boolean {
    return this.members.has(id);
  }

  include(thread: string, id: string, artifact: ArtifactRecord | null): void {
    const owner = this.team.get(thread)!;
    const ordinal = owner.next++;
    if (this.members.has(id)) return;
    const member: Member = { thread, rank: owner.rank, ordinal, entry: null };
    this.members.set(id, member);
    if (artifact !== null) {
      const entry: Candidate = { member, artifact, index: -1 };
      member.entry = entry;
      this.heap.append(entry);
    }
  }

  publish(thread: string, artifact: ArtifactRecord): boolean {
    this.heap.order();
    const owner = this.team.get(thread);
    let member = this.members.get(artifact.id);
    if (member === undefined && owner === undefined) return false;
    if (member === undefined || (owner !== undefined && owner.rank < member.rank)) {
      const previous = member?.entry;
      if (previous != null) this.heap.remove(previous.index);
      member = { thread, rank: owner!.rank, ordinal: owner!.next++, entry: null };
      this.members.set(artifact.id, member);
    }
    this.replace(member, artifact);
    return true;
  }

  snapshot(): ThreadPages {
    this.heap.order();
    const pages: ThreadPage[] = [];
    const frontier = new Heap<number>((left, right) => rank(this.heap.rows[left]!, this.heap.rows[right]!));
    if (this.heap.rows.length > 0 && this.limit > 0) frontier.insert(0);
    while (frontier.rows.length > 0 && pages.length < this.limit) {
      const at = frontier.remove(0);
      const entry = this.heap.rows[at]!;
      pages.push({ thread: entry.member.thread, artifact: entry.artifact });
      if (at * 2 + 1 < this.heap.rows.length) frontier.insert(at * 2 + 1);
      if (at * 2 + 2 < this.heap.rows.length) frontier.insert(at * 2 + 2);
    }
    return { pages, total: this.heap.rows.length };
  }

  private replace(member: Member, artifact: ArtifactRecord): void {
    if (member.entry !== null) this.heap.remove(member.entry.index);
    const entry: Candidate = { member, artifact, index: -1 };
    member.entry = entry;
    this.heap.insert(entry);
  }
}
