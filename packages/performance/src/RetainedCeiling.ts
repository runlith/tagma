export type RetainedWindows = {
  readonly bytes: number;
  readonly windowMs: number;
  readonly windows: number;
};

export type RetainedVerdict = 'hold' | 'pressed' | 'sustained';

export class RetainedCeiling {
  private opened: number | null = null;
  private trough = Number.POSITIVE_INFINITY;
  private above = 0;

  constructor(private readonly bounds: RetainedWindows) {}

  observe(at: number, retainedBytes: number): RetainedVerdict {
    if (this.opened === null) this.opened = at;
    let verdict: RetainedVerdict = 'hold';
    if (at - this.opened >= this.bounds.windowMs) {
      this.above = this.trough > this.bounds.bytes ? this.above + 1 : 0;
      this.opened = at;
      this.trough = Number.POSITIVE_INFINITY;
      verdict = this.above >= this.bounds.windows ? 'sustained' : this.above > 0 ? 'pressed' : 'hold';
    }
    this.trough = Math.min(this.trough, retainedBytes);
    return verdict;
  }

  cleared(): void {
    this.above = 0;
  }
}
