import { defaultRangeExtractor, type Range, type VirtualItem } from '@tanstack/virtual-core';

type Span = { from: number; to: number; start: number; end: number };

export class RowWindow {
  private span: Span | undefined;
  private landing: { start: number; end: number } | undefined;
  private mounted = new Set<VirtualItem['key']>();
  private waiting = false;
  private admitted = false;

  get pending(): boolean {
    return this.waiting;
  }

  get awaitsFrame(): boolean {
    return this.waiting || this.admitted;
  }

  frame(): void {
    this.admitted = false;
  }

  land(start: number, end: number): void {
    this.landing = { start, end };
  }

  unland(): void {
    this.landing = undefined;
  }

  indexes(range: Range, laid: readonly VirtualItem[], reach: number, paced = false, held = false): number[] {
    const around = this.around(range, laid, reach);
    const chosen = paced && this.span !== undefined ? this.paced(around, range, laid, held) : around;
    if (!paced || this.span === undefined) this.waiting = false;
    const landing = this.landing;
    let shown = chosen;
    if (landing !== undefined) {
      const landed = new Set(chosen);
      for (let index = landing.start; index <= Math.min(landing.end, range.count - 1); index += 1) landed.add(index);
      shown = [...landed].sort((left, right) => left - right);
    }
    this.mounted = new Set(shown.map((index) => laid[index]?.key ?? index));
    return shown;
  }

  private paced(around: readonly number[], range: Range, laid: readonly VirtualItem[], held: boolean): number[] {
    const chosen: number[] = [];
    let next = -1;
    let nearest = Number.POSITIVE_INFINITY;
    for (const index of around) {
      if ((index >= range.startIndex && index <= range.endIndex) || this.mounted.has(laid[index]?.key ?? index)) {
        chosen.push(index);
        continue;
      }
      const distance = index < range.startIndex ? range.startIndex - index : index - range.endIndex;
      if (distance < nearest) {
        next = index;
        nearest = distance;
      }
    }
    if (next >= 0 && !this.admitted && !held) {
      this.admitted = true;
      chosen.push(next);
      chosen.sort((left, right) => left - right);
    }
    this.waiting = chosen.length < around.length;
    return chosen;
  }

  private around(range: Range, laid: readonly VirtualItem[], reach: number): number[] {
    this.span = undefined;
    if (laid.length < range.count) return defaultRangeExtractor(range);
    let start = range.startIndex;
    let end = range.endIndex;
    const above = laid[start]!.start - reach;
    const below = laid[end]!.end + reach;
    while (start > 0 && laid[start - 1]!.end > above) start -= 1;
    while (end < range.count - 1 && laid[end + 1]!.start < below) end += 1;
    this.span = { from: range.startIndex, to: range.endIndex, start, end };
    return defaultRangeExtractor({ ...range, startIndex: start, endIndex: end, overscan: 0 });
  }

  short(laid: readonly VirtualItem[], reach: number): boolean {
    const span = this.span;
    if (span === undefined || laid.length <= span.end) return false;
    if (span.start > 0 && laid[span.start]!.start > laid[span.from]!.start - reach) return true;
    return span.end < laid.length - 1 && laid[span.end]!.end < laid[span.to]!.end + reach;
  }

  clear(): void {
    this.span = undefined;
    this.landing = undefined;
    this.mounted = new Set();
    this.waiting = false;
    this.admitted = false;
  }
}
