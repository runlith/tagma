import { defaultRangeExtractor, type Range, type VirtualItem } from '@tanstack/virtual-core';

type Span = { from: number; to: number; start: number; end: number };

export class RowWindow {
  private span: Span | undefined;
  private landing: { start: number; end: number } | undefined;

  land(start: number, end: number): void {
    this.landing = { start, end };
  }

  unland(): void {
    this.landing = undefined;
  }

  indexes(range: Range, laid: readonly VirtualItem[], reach: number): number[] {
    const around = this.around(range, laid, reach);
    const landing = this.landing;
    if (landing === undefined) return around;
    const landed = new Set(around);
    for (let index = landing.start; index <= Math.min(landing.end, range.count - 1); index += 1) landed.add(index);
    return [...landed].sort((left, right) => left - right);
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
  }
}
