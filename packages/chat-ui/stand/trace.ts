import { Schema } from 'effect';
import type { CDPSession, Page } from 'playwright-core';

const Event = Schema.Struct({
  name: Schema.optional(Schema.String),
  ph: Schema.String,
  pid: Schema.Number,
  tid: Schema.Number,
  ts: Schema.optional(Schema.Number),
  dur: Schema.optional(Schema.Number),
  tts: Schema.optional(Schema.Number),
  tdur: Schema.optional(Schema.Number),
  cat: Schema.optional(Schema.String),
  args: Schema.optional(Schema.Unknown),
});
type Event = typeof Event.Type;

export const Distribution = Schema.Struct({
  count: Schema.Number,
  p50: Schema.Number,
  p95: Schema.Number,
  p99: Schema.Number,
  max: Schema.Number,
});
export type Distribution = typeof Distribution.Type;

export const FrameWork = Schema.Struct({
  time: Schema.Number,
  interval: Schema.Number,
  script: Schema.Number,
  layout: Schema.Number,
  paint: Schema.Number,
  other: Schema.Number,
  total: Schema.Number,
});
export type FrameWork = typeof FrameWork.Type;

export const WorkSummary = Schema.Struct({
  interval: Distribution,
  script: Distribution,
  layout: Distribution,
  paint: Distribution,
  other: Distribution,
  total: Distribution,
  overRefresh: Schema.Number,
  over120Hz: Schema.Number,
});
export type WorkSummary = typeof WorkSummary.Type;

type Kind = 'script' | 'layout' | 'paint' | 'other';
type Span = { start: number; end: number; kind: Kind };
type Edge = { time: number; id: number; start: boolean };
type Thread = { pid: number; tid: number };

export type Capture<A> = {
  result: A;
  events: readonly Event[];
  marker: string;
  markerTime: number;
};

export type Accounting = {
  thread: Thread;
  frames: FrameWork[];
  summary: WorkSummary;
};

const SCRIPT = new Set([
  'FunctionCall',
  'EvaluateScript',
  'EvaluateModule',
  'EventDispatch',
  'FireAnimationFrame',
  'TimerFire',
  'FireIdleCallback',
  'RunMicrotasks',
  'V8.Execute',
  'v8.callFunction',
  'v8.compile',
  'v8.evaluateModule',
  'MajorGC',
  'MinorGC',
  'GCEvent',
]);
const LAYOUT = new Set(['Layout', 'UpdateLayoutTree', 'RecalculateStyles', 'RecalculateStyle']);
const PAINT = new Set(['PrePaint', 'Paint', 'PaintImage', 'UpdateLayerTree', 'Layerize', 'CompositeLayers', 'Commit']);
const TASKS = new Set(['RunTask', 'ThreadControllerImpl::RunTask', 'Program']);

export function distribution(values: readonly number[]): Distribution {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (share: number) => sorted[Math.max(0, Math.ceil(share * sorted.length) - 1)] ?? 0;
  return { count: sorted.length, p50: at(0.5), p95: at(0.95), p99: at(0.99), max: sorted.at(-1) ?? 0 };
}

function kindOf(name: string): Kind | undefined {
  if (SCRIPT.has(name) || name.startsWith('V8.GC')) return 'script';
  if (LAYOUT.has(name)) return 'layout';
  if (PAINT.has(name)) return 'paint';
  if (TASKS.has(name)) return 'other';
  return undefined;
}

export async function capture<A>(cdp: CDPSession, page: Page, action: () => Promise<A>): Promise<Capture<A>> {
  const events: unknown[] = [];
  const collected = (batch: { value: unknown[] }) => {
    for (const event of batch.value) events.push(event);
  };
  let completed!: (event: unknown) => void;
  const completion = new Promise<unknown>((resolve) => {
    completed = resolve;
  });
  const marker = `feed-stand-clock-${crypto.randomUUID()}`;
  let started = false;
  let end: unknown;
  let result: A;
  let markerTime: number;
  cdp.on('Tracing.dataCollected', collected);
  cdp.on('Tracing.tracingComplete', completed);
  try {
    await cdp.send('Tracing.start', {
      categories: 'devtools.timeline,disabled-by-default-devtools.timeline,v8,blink.user_timing',
      transferMode: 'ReportEvents',
    });
    started = true;
    markerTime = await page.evaluate((name) => {
      const time = performance.now();
      performance.mark(name, { startTime: time });
      return time;
    }, marker);
    result = await action();
  } finally {
    try {
      if (started) {
        await cdp.send('Tracing.end');
        end = await completion;
      }
    } finally {
      cdp.off('Tracing.dataCollected', collected);
      cdp.off('Tracing.tracingComplete', completed);
    }
  }
  const status = Schema.decodeUnknownSync(Schema.Struct({ dataLossOccurred: Schema.optional(Schema.Boolean) }))(end);
  if (status.dataLossOccurred === true) throw new Error('Chromium lost trace data; this measurement is incomplete');
  return { result, events: Schema.decodeUnknownSync(Schema.Array(Event))(events), marker, markerTime };
}

function spansOf(events: readonly Event[], thread: Thread, start: number, end: number): Span[] {
  const spans: Span[] = [];
  const stack: Event[] = [];
  const ordered = events
    .filter((event) => event.pid === thread.pid && event.tid === thread.tid && event.ts !== undefined)
    .sort((a, b) => a.ts! - b.ts!);
  let tasks = 0;
  const append = (event: Event, until: number) => {
    const kind = event.name === undefined ? undefined : kindOf(event.name);
    if (kind === undefined || event.ts === undefined) return;
    const from = Math.max(start, event.ts / 1000);
    const to = Math.min(end, until);
    if (to <= from) return;
    if (kind === 'other') tasks += 1;
    spans.push({ start: from, end: to, kind });
  };
  for (const event of ordered) {
    if (event.ph === 'X' && event.dur !== undefined) append(event, (event.ts! + event.dur) / 1000);
    else if (event.ph === 'B') stack.push(event);
    else if (event.ph === 'E') {
      const began = stack.pop();
      if (began !== undefined) append(began, event.ts! / 1000);
    }
  }
  for (const event of stack) append(event, end);
  if (tasks === 0) throw new Error('the renderer trace contains no top-level main-thread tasks in the recorded frames');
  return spans;
}

function partition(spans: readonly Span[]): Span[] {
  const edges: Edge[] = [];
  for (const [id, span] of spans.entries()) {
    edges.push({ time: span.start, id, start: true }, { time: span.end, id, start: false });
  }
  edges.sort((a, b) => a.time - b.time);
  const active = new Set<number>();
  const heap: number[] = [];
  const ahead = (left: number, right: number): boolean => {
    const a = spans[left]!;
    const b = spans[right]!;
    if ((a.kind === 'other') !== (b.kind === 'other')) return b.kind === 'other';
    return a.start > b.start || (a.start === b.start && (a.end < b.end || (a.end === b.end && left > right)));
  };
  const push = (id: number) => {
    heap.push(id);
    let at = heap.length - 1;
    while (at > 0) {
      const parent = (at - 1) >>> 1;
      if (!ahead(heap[at]!, heap[parent]!)) break;
      [heap[at], heap[parent]] = [heap[parent]!, heap[at]!];
      at = parent;
    }
  };
  const discard = () => {
    const last = heap.pop()!;
    if (heap.length === 0) return;
    heap[0] = last;
    let at = 0;
    for (;;) {
      const left = at * 2 + 1;
      if (left >= heap.length) return;
      const right = left + 1;
      const child = right < heap.length && ahead(heap[right]!, heap[left]!) ? right : left;
      if (!ahead(heap[child]!, heap[at]!)) return;
      [heap[at], heap[child]] = [heap[child]!, heap[at]!];
      at = child;
    }
  };
  const slices: Span[] = [];
  let at = 0;
  while (at < edges.length) {
    const time = edges[at]!.time;
    while (at < edges.length && edges[at]!.time === time) {
      const edge = edges[at++]!;
      if (edge.start) {
        active.add(edge.id);
        push(edge.id);
      } else active.delete(edge.id);
    }
    while (heap.length > 0 && !active.has(heap[0]!)) discard();
    const until = edges[at]?.time;
    const current = heap[0];
    if (until === undefined || current === undefined || until <= time) continue;
    const kind = spans[current]!.kind;
    const previous = slices.at(-1);
    if (previous?.end === time && previous.kind === kind) previous.end = until;
    else slices.push({ start: time, end: until, kind });
  }
  return slices;
}

export function account<A>(trace: Capture<A>, times: readonly number[], refresh: number, reference = 8.3): Accounting {
  if (times.length < 2) throw new Error('the scenario recorded fewer than two animation frames');
  if (!(refresh > 0) || !Number.isFinite(refresh)) throw new Error('the measured refresh interval is invalid');
  for (const [index, time] of times.entries()) {
    if (!Number.isFinite(time) || (index > 0 && time <= times[index - 1]!)) {
      throw new Error('recorder frame times must be strictly increasing requestAnimationFrame timestamps');
    }
  }
  const marker = trace.events.find((event) => event.name === trace.marker && event.ts !== undefined);
  if (marker?.ts === undefined) throw new Error('the trace did not contain the renderer clock marker');
  const thread = { pid: marker.pid, tid: marker.tid };
  const offset = marker.ts / 1000 - trace.markerTime;
  const slices = partition(spansOf(trace.events, thread, times[0]! + offset, times.at(-1)! + offset));
  const frames: FrameWork[] = [];
  let cursor = 0;
  for (let index = 0; index < times.length - 1; index += 1) {
    const time = times[index]!;
    const start = time + offset;
    const end = times[index + 1]! + offset;
    const frame = { time, interval: end - start, script: 0, layout: 0, paint: 0, other: 0, total: 0 };
    while (cursor < slices.length && slices[cursor]!.end <= start) cursor += 1;
    for (let slice = cursor; slice < slices.length && slices[slice]!.start < end; slice += 1) {
      const span = slices[slice]!;
      frame[span.kind] += Math.max(0, Math.min(end, span.end) - Math.max(start, span.start));
    }
    frame.total = frame.script + frame.layout + frame.paint + frame.other;
    frames.push(frame);
  }
  return {
    thread,
    frames,
    summary: {
      interval: distribution(frames.map((frame) => frame.interval)),
      script: distribution(frames.map((frame) => frame.script)),
      layout: distribution(frames.map((frame) => frame.layout)),
      paint: distribution(frames.map((frame) => frame.paint)),
      other: distribution(frames.map((frame) => frame.other)),
      total: distribution(frames.map((frame) => frame.total)),
      overRefresh: frames.filter((frame) => frame.total > refresh).length,
      over120Hz: frames.filter((frame) => frame.total > reference).length,
    },
  };
}
