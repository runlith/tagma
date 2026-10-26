import * as Context from 'effect/Context';
import type * as Tracer from 'effect/Tracer';
import type { SpanPayload } from './protocol/records.js';

export const TRACE_BUFFER_MS = 2_000;
export const TRACE_BUFFER_BYTES = 256 * 1024;
export const KEEP_ONE_TRACE_IN = 100;

export type TraceKeep = 'slow' | 'failed' | 'stalled' | 'hash';
export type TraceVerdict = TraceKeep | 'dropped';

export type SampledSpan = {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentId: string | null;
  readonly name: string;
  readonly spanKind: Tracer.SpanKind;
  readonly attributes: SpanPayload['attributes'];
  readonly exit: SpanPayload['exit'];
  readonly wallTime: number;
  readonly monotonicStart: number;
  readonly monotonicEnd: number;
  readonly durationMicros: number;
  readonly failed: boolean;
  readonly root: boolean;
  readonly unit: string | null;
  readonly slow: boolean;
  readonly byteSize: number;
};

export type TraceHandover = {
  readonly traceId: string;
  readonly keep: TraceKeep;
  readonly spans: ReadonlyArray<SampledSpan>;
};

export type TraceProducer = {
  readonly keepOneTraceIn: () => number;
  readonly submit: (handover: TraceHandover) => void;
};

export type TraceSamplerCounts = {
  readonly slow: number;
  readonly failed: number;
  readonly stalled: number;
  readonly hash: number;
  readonly dropped: number;
  readonly droppedSpans: number;
};

type Held = {
  spans: Array<SampledSpan>;
  ends: Array<number>;
  bytes: number;
  failed: boolean;
  slow: boolean;
  crossing: Set<SampledSpan> | null;
  readonly openedAtMs: number;
  lastEndedAtMs: number;
};

type Parcel = {
  readonly spans: Array<SampledSpan>;
  readonly ends: Array<number>;
  readonly bytes: number;
  readonly lastEndedAtMs: number;
};

type Trace = {
  readonly producer: TraceProducer;
  readonly headKeep: boolean;
  openSpans: number;
  openRoots: number;
  window: Held;
  held: Held | null;
  windowed: boolean;
  final: TraceVerdict | null;
  expiresAtMs: number;
};

type Unit = Held & {
  readonly id: string;
  readonly enclosing: string | null;
  openSpans: number;
  decided: TraceKeep | 'dropped' | 'joined' | null;
};

export class TraceSampler {
  constructor(private readonly now: () => number = () => performance.now()) {}

  private readonly traces = new Map<string, Trace>();
  private readonly units = new Map<string, Unit>();
  private stallEndMs = Number.NEGATIVE_INFINITY;
  private slow = 0;
  private failed = 0;
  private stalled = 0;
  private hash = 0;
  private dropped = 0;
  private droppedSpans = 0;

  open(traceId: string, producer: TraceProducer, root: boolean, unit: string | null): void {
    const trace = this.opened(traceId, producer);
    trace.openSpans += 1;
    if (root) trace.openRoots += 1;
    if (unit === null) return;
    const held = this.units.get(unit);
    if (held !== undefined) held.openSpans += 1;
  }

  openUnit(traceId: string, producer: TraceProducer, unit: string, enclosing: string | null): void {
    this.opened(traceId, producer).openSpans += 1;
    const around = enclosing === null ? undefined : this.units.get(enclosing);
    if (around !== undefined) around.openSpans += 1;
    this.units.set(unit, { ...emptyHeld(this.now()), id: unit, enclosing, openSpans: 1, decided: null });
  }

  end(span: SampledSpan): void {
    const endedAtMs = this.now();
    this.record(span, endedAtMs, endedAtMs - span.durationMicros / 1_000 <= this.stallEndMs);
    this.sweep(endedAtMs);
  }

  coverStall(fromMs: number, toMs: number): void {
    this.stallEndMs = Math.max(this.stallEndMs, toMs);
    for (const [traceId, trace] of this.traces) {
      if (trace.final === null) cross(trace.window, fromMs, toMs);
      const held = trace.held;
      if (held === null || !cross(held, fromMs, toMs)) continue;
      this.handOverCrossing(traceId, trace, held);
      if (held.spans.length > 0) continue;
      trace.held = null;
      this.dropped -= 1;
    }
    for (const unit of this.units.values()) {
      if (unit.decided === null) cross(unit, fromMs, toMs);
    }
  }

  get counts(): TraceSamplerCounts {
    return {
      slow: this.slow,
      failed: this.failed,
      stalled: this.stalled,
      hash: this.hash,
      dropped: this.dropped,
      droppedSpans: this.droppedSpans,
    };
  }

  private opened(traceId: string, producer: TraceProducer): Trace {
    const known = this.traces.get(traceId);
    if (known !== undefined) return known;
    const startedAtMs = this.now();
    const trace: Trace = {
      producer,
      headKeep: keepsByHash(traceId, producer.keepOneTraceIn()),
      openSpans: 0,
      openRoots: 0,
      window: emptyHeld(startedAtMs),
      held: null,
      windowed: false,
      final: null,
      expiresAtMs: startedAtMs + TRACE_BUFFER_MS,
    };
    this.traces.set(traceId, trace);
    return trace;
  }

  private record(span: SampledSpan, endedAtMs: number, crossed: boolean): void {
    const trace = this.traces.get(span.traceId);
    if (trace === undefined) return;
    trace.openSpans = Math.max(0, trace.openSpans - 1);
    if (span.root) trace.openRoots = Math.max(0, trace.openRoots - 1);
    const unit = span.unit === null ? undefined : this.units.get(span.unit);
    if (unit !== undefined) unit.openSpans = Math.max(0, unit.openSpans - 1);
    this.place(span.traceId, trace, unit, span, endedAtMs, crossed);
    this.retire(unit);
  }

  private retire(unit: Unit | undefined): void {
    for (let at = unit; at !== undefined && at.decided !== null && at.openSpans === 0;) {
      this.units.delete(at.id);
      at = this.enclosingOf(at);
      if (at !== undefined) at.openSpans = Math.max(0, at.openSpans - 1);
    }
  }

  private place(traceId: string, trace: Trace, unit: Unit | undefined, span: SampledSpan, atMs: number, crossed: boolean): void {
    if (unit === undefined) {
      this.placeInWindow(traceId, trace, span, atMs, crossed);
      return;
    }
    switch (unit.decided) {
      case null:
        break;
      case 'joined':
        this.place(traceId, trace, this.enclosingOf(unit), span, atMs, crossed);
        return;
      case 'dropped': {
        const head = span.spanId === unit.id;
        this.alone(traceId, trace, span, head && span.failed ? 'failed' : head && span.slow ? 'slow' : crossed ? 'stalled' : null);
        return;
      }
      default:
        trace.producer.submit({ traceId, keep: unit.decided, spans: [span] });
        return;
    }
    hold(unit, span, atMs, crossed);
    if (span.spanId === unit.id) this.settle(traceId, trace, unit, atMs);
    else if (unit.bytes > TRACE_BUFFER_BYTES) this.overflow(traceId, trace, unit);
  }

  private placeInWindow(traceId: string, trace: Trace, span: SampledSpan, atMs: number, crossed: boolean): void {
    if (trace.final !== null) {
      if (trace.final === 'dropped') this.alone(traceId, trace, span, crossed ? 'stalled' : null);
      else trace.producer.submit({ traceId, keep: trace.final, spans: [span] });
      return;
    }
    hold(trace.window, span, atMs, crossed);
    const over = trace.openSpans === 0 || (span.root && trace.openRoots === 0);
    if (span.root || over || this.due(trace.window, atMs)) this.close(traceId, trace, atMs, over);
  }

  private alone(traceId: string, trace: Trace, span: SampledSpan, keep: TraceKeep | null): void {
    if (keep === null) {
      this.droppedSpans += 1;
      return;
    }
    this[keep] += 1;
    trace.producer.submit({ traceId, keep, spans: [span] });
  }

  private settle(traceId: string, trace: Trace, unit: Unit, atMs: number): void {
    const keep = unit.failed ? 'failed' : unit.slow ? 'slow' : null;
    if (keep !== null) {
      this.keep(traceId, trace, unit, keep);
      return;
    }
    this.handOverCrossing(traceId, trace, unit);
    unit.decided = 'joined';
    this.join(traceId, trace, this.enclosingOf(unit), detach(unit), atMs);
  }

  private overflow(traceId: string, trace: Trace, unit: Unit): void {
    const keep = unit.failed ? 'failed' : trace.headKeep ? 'hash' : null;
    if (keep !== null) {
      this.keep(traceId, trace, unit, keep);
      return;
    }
    this.handOverCrossing(traceId, trace, unit);
    unit.decided = 'dropped';
    this.dropped += 1;
    this.droppedSpans += detach(unit).spans.length;
  }

  private keep(traceId: string, trace: Trace, unit: Unit, keep: TraceKeep): void {
    unit.decided = keep;
    this[keep] += 1;
    trace.producer.submit({ traceId, keep, spans: detach(unit).spans });
  }

  private handOverCrossing(traceId: string, trace: Trace, held: Held): void {
    const spans = takeCrossing(held);
    if (spans.length === 0) return;
    this.stalled += 1;
    trace.producer.submit({ traceId, keep: 'stalled', spans });
  }

  private join(traceId: string, trace: Trace, into: Unit | undefined, parcel: Parcel, atMs: number): void {
    if (parcel.spans.length === 0) return;
    if (into === undefined) {
      if (trace.final !== null) {
        if (trace.final === 'dropped') this.droppedSpans += parcel.spans.length;
        else trace.producer.submit({ traceId, keep: trace.final, spans: parcel.spans });
        return;
      }
      absorb(trace.window, parcel);
      if (this.due(trace.window, atMs)) this.close(traceId, trace, atMs, trace.openSpans === 0);
      return;
    }
    switch (into.decided) {
      case null:
        absorb(into, parcel);
        if (into.bytes > TRACE_BUFFER_BYTES) this.overflow(traceId, trace, into);
        return;
      case 'joined':
        this.join(traceId, trace, this.enclosingOf(into), parcel, atMs);
        return;
      case 'dropped':
        this.droppedSpans += parcel.spans.length;
        return;
      default:
        trace.producer.submit({ traceId, keep: into.decided, spans: parcel.spans });
    }
  }

  private close(traceId: string, trace: Trace, atMs: number, over: boolean): void {
    const window = trace.window;
    const verdict: TraceVerdict = window.failed ? 'failed' : window.slow && !trace.windowed ? 'slow' : trace.headKeep ? 'hash' : 'dropped';
    if (verdict === 'dropped') {
      this.handOverCrossing(traceId, trace, window);
      if (window.spans.length > 0) {
        this.release(trace);
        this.dropped += 1;
        trace.held = window;
      }
    } else if (window.spans.length > 0) {
      this[verdict] += 1;
      trace.producer.submit({ traceId, keep: verdict, spans: window.spans });
    }
    trace.window = emptyHeld(atMs);
    if (over) trace.final = verdict;
    else trace.windowed = true;
    this.requeue(traceId, trace, atMs);
  }

  private due(window: Held, atMs: number): boolean {
    return window.bytes > TRACE_BUFFER_BYTES || atMs - window.openedAtMs > TRACE_BUFFER_MS;
  }

  private enclosingOf(unit: Unit): Unit | undefined {
    return unit.enclosing === null ? undefined : this.units.get(unit.enclosing);
  }

  private release(trace: Trace): void {
    if (trace.held === null) return;
    this.droppedSpans += trace.held.spans.length;
    trace.held = null;
  }

  private requeue(traceId: string, trace: Trace, nowMs: number): void {
    trace.expiresAtMs = nowMs + TRACE_BUFFER_MS;
    this.traces.delete(traceId);
    this.traces.set(traceId, trace);
  }

  private sweep(nowMs: number): void {
    for (const [traceId, trace] of this.traces) {
      if (trace.expiresAtMs > nowMs) break;
      this.release(trace);
      if (trace.final === null) this.close(traceId, trace, nowMs, trace.openSpans === 0);
      else if (trace.openSpans > 0) this.requeue(traceId, trace, nowMs);
      else this.traces.delete(traceId);
    }
  }
}

export const CurrentTraceSampler = Context.Reference<TraceSampler>('@runlith/performance/TraceSampler', {
  defaultValue: () => new TraceSampler(),
});

function emptyHeld(openedAtMs: number): Held {
  return {
    spans: [],
    ends: [],
    bytes: 0,
    failed: false,
    slow: false,
    crossing: null,
    openedAtMs,
    lastEndedAtMs: openedAtMs,
  };
}

function hold(held: Held, span: SampledSpan, atMs: number, crossed: boolean): void {
  held.spans.push(span);
  held.ends.push(atMs);
  held.bytes += span.byteSize;
  held.lastEndedAtMs = Math.max(held.lastEndedAtMs, atMs);
  if (span.failed) held.failed = true;
  if (span.slow) held.slow = true;
  if (crossed) (held.crossing ??= new Set()).add(span);
}

function cross(held: Held, fromMs: number, toMs: number): boolean {
  if (held.lastEndedAtMs < fromMs) return held.crossing !== null;
  for (let index = 0; index < held.spans.length; index += 1) {
    const endedAtMs = held.ends[index] ?? Number.NEGATIVE_INFINITY;
    const span = held.spans[index];
    if (span === undefined || endedAtMs < fromMs || endedAtMs - span.durationMicros / 1_000 > toMs) continue;
    (held.crossing ??= new Set()).add(span);
  }
  return held.crossing !== null;
}

function takeCrossing(held: Held): Array<SampledSpan> {
  const crossing = held.crossing;
  if (crossing === null) return [];
  held.crossing = null;
  const byId = new Map<string, SampledSpan>();
  for (const span of held.spans) byId.set(span.spanId, span);
  const taken = new Set(crossing);
  for (const span of crossing) {
    let above = span.parentId === null ? undefined : byId.get(span.parentId);
    while (above !== undefined && !taken.has(above)) {
      taken.add(above);
      above = above.parentId === null ? undefined : byId.get(above.parentId);
    }
  }
  const spans: Array<SampledSpan> = [];
  const ends: Array<number> = [];
  const kept: Array<SampledSpan> = [];
  let bytes = 0;
  for (let index = 0; index < held.spans.length; index += 1) {
    const span = held.spans[index];
    if (span === undefined) continue;
    if (taken.has(span)) {
      kept.push(span);
      continue;
    }
    spans.push(span);
    ends.push(held.ends[index] ?? held.lastEndedAtMs);
    bytes += span.byteSize;
  }
  held.spans = spans;
  held.ends = ends;
  held.bytes = bytes;
  return kept;
}

function detach(held: Held): Parcel {
  const parcel = { spans: held.spans, ends: held.ends, bytes: held.bytes, lastEndedAtMs: held.lastEndedAtMs };
  held.spans = [];
  held.ends = [];
  held.bytes = 0;
  held.crossing = null;
  return parcel;
}

function absorb(into: Held, parcel: Parcel): void {
  if (into.spans.length === 0) {
    into.spans = parcel.spans;
    into.ends = parcel.ends;
  } else {
    for (const span of parcel.spans) into.spans.push(span);
    for (const endedAtMs of parcel.ends) into.ends.push(endedAtMs);
  }
  into.bytes += parcel.bytes;
  into.lastEndedAtMs = Math.max(into.lastEndedAtMs, parcel.lastEndedAtMs);
}

function keepsByHash(traceId: string, keepOneTraceIn: number): boolean {
  if (keepOneTraceIn <= 1) return true;
  let hash = 0x811c9dc5;
  for (let index = 0; index < traceId.length; index += 1) {
    hash ^= traceId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % keepOneTraceIn === 0;
}
