const NANOS_PER_MS = 1_000_000;
const PRECISION_MS = 0.5;

export const msOf = (origin: bigint, at: bigint): number => Number(at - origin) / NANOS_PER_MS;

export class Timeline {
  private frames = new Float64Array(16);
  private times = new Float64Array(16);
  private first = 0;
  private count = 0;
  private recorded = 0;
  private startTime = 0;

  constructor(
    readonly rate: number,
    readonly origin: bigint,
  ) {}

  get length(): number {
    return this.recorded;
  }

  get start(): number | undefined {
    return this.count === 0 ? undefined : this.startTime;
  }

  record(at: bigint, frames: number): void {
    const time = msOf(this.origin, at);
    if (this.count === 0) this.startTime = time;
    else if (Math.abs(time - this.at(this.recorded)) < PRECISION_MS) {
      this.recorded += frames;
      return;
    }
    if (this.first + this.count === this.frames.length) this.grow();
    this.frames[this.first + this.count] = this.recorded;
    this.times[this.first + this.count] = time;
    this.count += 1;
    this.recorded += frames;
  }

  forget(frame: number): void {
    let drop = 0;
    while (drop + 1 < this.count && (this.frames[this.first + drop + 1] ?? 0) <= frame) drop += 1;
    this.first += drop;
    this.count -= drop;
  }

  at(frame: number): number {
    if (this.count === 0) return 0;
    let low = this.first;
    let high = this.first + this.count - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if ((this.frames[middle] ?? 0) <= frame) low = middle;
      else high = middle - 1;
    }
    return (this.times[low] ?? 0) + ((frame - (this.frames[low] ?? 0)) * 1000) / this.rate;
  }

  get end(): number {
    return this.at(this.recorded);
  }

  private grow(): void {
    const size = Math.max(16, this.count * 2);
    const frames = new Float64Array(size);
    const times = new Float64Array(size);
    frames.set(this.frames.subarray(this.first, this.first + this.count));
    times.set(this.times.subarray(this.first, this.first + this.count));
    this.frames = frames;
    this.times = times;
    this.first = 0;
  }
}
