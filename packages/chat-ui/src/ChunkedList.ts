const CHUNK = 128;

type Chunk<T> = { items: T[]; slot: number };

export class ChunkedList<T> {
  private chunks: Chunk<T>[] = [];
  private readonly owners = new Map<string, Chunk<T>>();
  private total = 0;
  private tree: number[] = [0];
  private base = 0;
  private top = 0;
  private seen: Chunk<T> | undefined;
  private seenStart = 0;

  constructor(private readonly keyOf: (item: T) => string) {}

  get length(): number {
    return this.total;
  }

  at(index: number): T | undefined {
    if (index < 0 || index >= this.total) return undefined;
    const seen = this.seen;
    if (seen !== undefined && index >= this.seenStart && index < this.seenStart + seen.items.length)
      return seen.items[index - this.seenStart];
    const chunk = this.locate(index);
    this.seen = chunk;
    this.seenStart = this.base;
    return chunk.items[index - this.base];
  }

  has(key: string): boolean {
    return this.owners.has(key);
  }

  indexOf(key: string): number {
    const chunk = this.owners.get(key);
    if (chunk === undefined) return -1;
    const offset = chunk.items.findIndex((item) => this.keyOf(item) === key);
    return this.startOf(chunk) + offset;
  }

  get(key: string): T | undefined {
    const chunk = this.owners.get(key);
    if (chunk === undefined) return undefined;
    return chunk.items.find((item) => this.keyOf(item) === key);
  }

  set(index: number, item: T): T {
    const chunk = this.locate(index);
    const offset = index - this.base;
    const held = chunk.items[offset]!;
    const heldKey = this.keyOf(held);
    const key = this.keyOf(item);
    if (heldKey !== key) {
      this.owners.delete(heldKey);
      this.owners.set(key, chunk);
    }
    chunk.items[offset] = item;
    return held;
  }

  splice(from: number, removed: number, inserted: readonly T[]): T[] {
    this.seen = undefined;
    const at = Math.min(Math.max(from, 0), this.total);
    const count = Math.min(removed, this.total - at);
    if (this.chunks.length === 0) this.open(0);
    const first = this.locate(Math.min(at, Math.max(this.total - 1, 0)));
    const offset = at - this.base;
    if (count === 0 || offset + count <= first.items.length) return this.within(first, offset, count, inserted);
    return this.across(first, offset, count, inserted);
  }

  slice(from = 0, to = this.total): T[] {
    const out: T[] = [];
    const end = Math.min(to, this.total);
    if (from >= end) return out;
    let chunk = this.locate(from);
    let offset = from - this.base;
    while (out.length < end - from) {
      const take = Math.min(chunk.items.length - offset, end - from - out.length);
      for (let index = 0; index < take; index += 1) out.push(chunk.items[offset + index]!);
      offset = 0;
      const next = this.chunks[chunk.slot + 1];
      if (next === undefined) break;
      chunk = next;
    }
    return out;
  }

  findLast(match: (item: T) => boolean): T | undefined {
    for (let slot = this.chunks.length - 1; slot >= 0; slot -= 1) {
      const found = this.chunks[slot]!.items.findLast(match);
      if (found !== undefined) return found;
    }
    return undefined;
  }

  eachBack(visit: (item: T, index: number) => boolean): void {
    let index = this.total;
    for (let slot = this.chunks.length - 1; slot >= 0; slot -= 1) {
      const items = this.chunks[slot]!.items;
      for (let offset = items.length - 1; offset >= 0; offset -= 1) {
        index -= 1;
        if (!visit(items[offset]!, index)) return;
      }
    }
  }

  clear(): void {
    this.seen = undefined;
    this.chunks = [];
    this.owners.clear();
    this.total = 0;
    this.tree = [0];
    this.top = 0;
  }

  *[Symbol.iterator](): IterableIterator<T> {
    for (const chunk of this.chunks) yield* chunk.items;
  }

  private within(chunk: Chunk<T>, offset: number, count: number, inserted: readonly T[]): T[] {
    let gone: T[];
    if (inserted.length > 1024) {
      gone = chunk.items.slice(offset, offset + count);
      chunk.items = chunk.items.slice(0, offset).concat(inserted, chunk.items.slice(offset + count));
    } else gone = chunk.items.splice(offset, count, ...inserted);
    for (const item of gone) {
      const key = this.keyOf(item);
      if (this.owners.get(key) === chunk && !chunk.items.some((held) => this.keyOf(held) === key)) this.owners.delete(key);
    }
    for (const item of inserted) this.owners.set(this.keyOf(item), chunk);
    this.total += inserted.length - count;
    this.bump(chunk.slot, inserted.length - count);
    this.refit(chunk);
    return gone;
  }

  private across(first: Chunk<T>, offset: number, count: number, inserted: readonly T[]): T[] {
    const end = this.startOf(first) + offset + count;
    const last = this.locate(end - 1);
    const lastOffset = end - this.base;
    const gone: T[] = first.items.slice(offset);
    for (let slot = first.slot + 1; slot < last.slot; slot += 1) gone.push(...this.chunks[slot]!.items);
    gone.push(...last.items.slice(0, lastOffset));
    const replaced = new Set(this.chunks.slice(first.slot, last.slot + 1));
    for (const item of gone) {
      const key = this.keyOf(item);
      if (replaced.has(this.owners.get(key)!)) this.owners.delete(key);
    }
    const head = first.items.slice(0, offset);
    const tail = last.items.slice(lastOffset);
    const joined = head.concat(inserted, tail);
    const pieces: Chunk<T>[] = [];
    for (let index = 0; index < joined.length || pieces.length === 0; index += CHUNK) {
      const items = joined.slice(index, index + CHUNK);
      pieces.push({ items, slot: 0 });
    }
    this.chunks.splice(first.slot, last.slot - first.slot + 1, ...pieces);
    for (const piece of pieces) for (const item of piece.items) this.owners.set(this.keyOf(item), piece);
    this.total += inserted.length - count;
    this.renumber(first.slot);
    if (this.chunks.length > 1) this.dropEmpty();
    return gone;
  }

  private refit(chunk: Chunk<T>): void {
    if (chunk.items.length === 0 && this.chunks.length > 1) {
      this.chunks.splice(chunk.slot, 1);
      this.renumber(chunk.slot);
      return;
    }
    if (chunk.items.length <= CHUNK * 2) return;
    const pieces: Chunk<T>[] = [];
    for (let index = 0; index < chunk.items.length; index += CHUNK) {
      pieces.push({ items: chunk.items.slice(index, index + CHUNK), slot: 0 });
    }
    this.chunks.splice(chunk.slot, 1, ...pieces);
    for (const piece of pieces) for (const item of piece.items) this.owners.set(this.keyOf(item), piece);
    this.renumber(chunk.slot);
  }

  private dropEmpty(): void {
    const kept = this.chunks.filter((chunk) => chunk.items.length > 0);
    if (kept.length === this.chunks.length || kept.length === 0) return;
    this.chunks = kept;
    this.renumber(0);
  }

  private open(slot: number): Chunk<T> {
    const chunk: Chunk<T> = { items: [], slot };
    this.chunks.splice(slot, 0, chunk);
    this.renumber(slot);
    return chunk;
  }

  private renumber(from: number): void {
    for (let slot = from; slot < this.chunks.length; slot += 1) this.chunks[slot]!.slot = slot;
    this.rebuild();
  }

  private rebuild(): void {
    const size = this.chunks.length;
    const tree = new Array<number>(size + 1).fill(0);
    for (let slot = 0; slot < size; slot += 1) {
      const at = slot + 1;
      tree[at]! += this.chunks[slot]!.items.length;
      const parent = at + (at & -at);
      if (parent <= size) tree[parent]! += tree[at]!;
    }
    this.tree = tree;
    this.top = highestBit(size);
  }

  private bump(slot: number, delta: number): void {
    if (delta === 0) return;
    for (let at = slot + 1; at < this.tree.length; at += at & -at) this.tree[at]! += delta;
  }

  private startOf(chunk: Chunk<T>): number {
    let sum = 0;
    for (let at = chunk.slot; at > 0; at -= at & -at) sum += this.tree[at]!;
    return sum;
  }

  private locate(index: number): Chunk<T> {
    const size = this.chunks.length;
    let position = 0;
    let remaining = index;
    for (let step = this.top; step > 0; step >>= 1) {
      const next = position + step;
      if (next <= size && this.tree[next]! <= remaining) {
        position = next;
        remaining -= this.tree[next]!;
      }
    }
    if (position < size) {
      this.base = index - remaining;
      return this.chunks[position]!;
    }
    const last = this.chunks[size - 1]!;
    this.base = this.total - last.items.length;
    return last;
  }
}

function highestBit(value: number): number {
  let bit = 1;
  while (bit * 2 <= value) bit *= 2;
  return value === 0 ? 0 : bit;
}
