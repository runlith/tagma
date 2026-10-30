import type { TailEnd, TailReader, TailWindow } from '@runlith/tagma/adapter/metadata';

export class TailScan {
  private readonly seen: unknown[] = [];
  private ended: TailEnd | null = null;

  constructor(
    private readonly reader: TailReader,
    private readonly window: TailWindow,
  ) {}

  feed(newestFirst: readonly unknown[]): TailEnd | null {
    if (this.ended !== null) return this.ended;
    let exhausted = false;
    for (const record of newestFirst) {
      const at = this.reader.window === 'time' ? this.reader.stampOf(record) : null;
      if (at !== null && at + this.reader.grain <= this.window.since) {
        exhausted = true;
        break;
      }
      this.seen.push(record);
    }
    return this.settle(exhausted);
  }

  finish(): TailEnd {
    return this.ended ?? this.settle(true) ?? { _tag: 'Open' };
  }

  private settle(exhausted: boolean): TailEnd | null {
    const judged = this.reader.judge(this.seen, exhausted, this.window.turn);
    if (judged !== null) this.ended = judged;
    else if (exhausted) this.ended = { _tag: 'Open' };
    return this.ended;
  }
}
