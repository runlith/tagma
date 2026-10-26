export type Held<T> = { readonly seq: number; readonly entry: T };

export type RingRead<T> = {
  readonly entries: readonly Held<T>[];
  readonly total: number;
  readonly dropped: number;
};

type Slot<T> = { seq: number; entry: T; bytes: number } | null;

export class Ring<T> {
  readonly #limit: number;
  readonly #weigh: (entry: T) => number;
  #held: Slot<T>[] = [];
  #start = 0;
  #bytes = 0;
  #seq = 0;
  #dropped = 0;

  constructor(limitBytes: number, weigh: (entry: T) => number) {
    this.#limit = limitBytes;
    this.#weigh = weigh;
  }

  push(entry: T): number {
    const bytes = this.#weigh(entry);
    this.#seq += 1;
    this.#held.push({ seq: this.#seq, entry, bytes });
    this.#bytes += bytes;
    this.#evict();
    return this.#seq;
  }

  update(seq: number, change: (entry: T) => T): void {
    for (let index = this.#held.length - 1; index >= this.#start; index -= 1) {
      const held = this.#held[index]!;
      if (held.seq < seq) return;
      if (held.seq === seq) {
        const entry = change(held.entry);
        const bytes = this.#weigh(entry);
        this.#bytes += bytes - held.bytes;
        this.#held[index] = { seq, entry, bytes };
        this.#evict();
        return;
      }
    }
  }

  read(options: { readonly limit: number; readonly after?: number; readonly keep?: (entry: T) => boolean }): RingRead<T> {
    const keep = options.keep ?? (() => true);
    const after = options.after ?? 0;
    const matched: Held<T>[] = [];
    let total = 0;
    for (let index = this.#held.length - 1; index >= this.#start; index -= 1) {
      const held = this.#held[index]!;
      if (held.seq <= after) break;
      if (!keep(held.entry)) continue;
      total += 1;
      if (matched.length < options.limit) matched.push({ seq: held.seq, entry: held.entry });
    }
    return { entries: matched.reverse(), total, dropped: this.#dropped };
  }

  #evict(): void {
    while (this.#bytes > this.#limit && this.#start < this.#held.length) {
      this.#bytes -= this.#held[this.#start]!.bytes;
      this.#held[this.#start] = null;
      this.#start += 1;
      this.#dropped += 1;
    }
    if (this.#start > 1024 && this.#start * 2 > this.#held.length) {
      this.#held = this.#held.slice(this.#start);
      this.#start = 0;
    }
  }
}
