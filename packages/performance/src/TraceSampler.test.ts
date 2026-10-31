import { expect, test } from 'bun:test';
import { TraceSampler, type SampledSpan, type TraceHandover, type TraceProducer } from './TraceSampler.js';

const TRACE = 'trace-1';
const NEVER_BY_HASH = 1_000_000_000;
const EVERY_TRACE = 1;

function harness(keepOneTraceIn = NEVER_BY_HASH) {
  let clock = 0;
  const handed: TraceHandover[] = [];
  const sampler = new TraceSampler(() => clock);
  const producer: TraceProducer = { keepOneTraceIn: () => keepOneTraceIn, submit: (handover) => void handed.push(handover) };
  const places = new Map<string, Place>();
  return {
    sampler,
    at: (ms: number) => {
      clock = ms;
    },
    root: (spanId: string) => {
      places.set(spanId, { unit: null, root: true, parentId: null, openedAtMs: clock });
      sampler.open(TRACE, producer, true, null);
    },
    unit: (spanId: string, enclosing: string | null = null) => {
      places.set(spanId, { unit: spanId, root: false, parentId: enclosing, openedAtMs: clock });
      sampler.openUnit(TRACE, producer, spanId, enclosing);
    },
    member: (spanId: string, unit: string | null = null, parentId: string | null = unit) => {
      places.set(spanId, { unit, root: false, parentId, openedAtMs: clock });
      sampler.open(TRACE, producer, false, unit);
    },
    end: (spanId: string, outcome: { readonly failed?: boolean; readonly slow?: boolean; readonly bytes?: number } = {}) => {
      const place = places.get(spanId);
      if (place === undefined) throw new Error(`${spanId} was never opened`);
      sampler.end(sampled(spanId, place, clock - place.openedAtMs, outcome));
    },
    kept: () => handed.flatMap((handover) => handover.spans.map((span) => `${span.spanId}:${handover.keep}`)).sort(),
  };
}

type Place = {
  readonly unit: string | null;
  readonly root: boolean;
  readonly parentId: string | null;
  readonly openedAtMs: number;
};

function sampled(
  spanId: string,
  place: Place,
  durationMs: number,
  outcome: { readonly failed?: boolean; readonly slow?: boolean; readonly bytes?: number },
): SampledSpan {
  return {
    traceId: TRACE,
    spanId,
    parentId: place.parentId,
    name: spanId,
    spanKind: 'internal',
    attributes: {},
    exit: { _tag: 'Success' },
    wallTime: 0,
    monotonicStart: place.openedAtMs,
    monotonicEnd: place.openedAtMs + durationMs,
    durationMicros: durationMs * 1_000,
    failed: outcome.failed ?? false,
    root: place.root,
    unit: place.unit,
    slow: outcome.slow ?? false,
    byteSize: outcome.bytes ?? 100,
  };
}

test("a unit that fails or runs slow minutes into its run is handed over whole, and the run's other work is not, even when the run itself ends slow", () => {
  const run = harness();
  run.root('run');
  run.member('boot');
  run.at(100);
  run.end('boot');

  run.unit('tool-a');
  run.member('read-a', 'tool-a');
  run.at(300_000);
  run.end('read-a', { failed: true });
  run.at(300_100);
  run.end('tool-a');

  run.unit('tool-b');
  run.member('wait-b', 'tool-b');
  run.at(400_000);
  run.end('wait-b');
  run.at(486_000);
  run.end('tool-b', { slow: true });

  run.unit('tool-c');
  run.member('read-c', 'tool-c');
  run.at(500_000);
  run.end('read-c');
  run.at(500_050);
  run.end('tool-c');
  run.member('persist');
  run.at(500_100);
  run.end('persist');
  run.at(600_000);
  run.end('run', { slow: true });

  expect(run.kept()).toEqual(['read-a:failed', 'tool-a:failed', 'tool-b:slow', 'wait-b:slow']);
});

test('a stall keeps the spans that ran across it and their ancestors up to their unit, and nothing else of that unit or window', () => {
  const run = harness();
  run.root('run');
  run.member('before');
  run.at(1_000);
  run.end('before');

  run.unit('step');
  run.member('plan', 'step');
  run.member('forked', 'step', 'plan');
  run.at(1_500);
  run.end('plan');
  run.member('call', 'step');
  run.at(3_000);
  run.member('query', 'step', 'call');
  run.member('resumed');
  run.at(3_100);
  run.end('query');
  run.at(3_120);
  run.end('forked');
  run.at(3_180);
  run.end('resumed');
  run.at(3_200);
  run.sampler.coverStall(3_050, 3_150);

  run.member('late-query', 'step', 'call');
  run.at(3_400);
  run.end('late-query');
  run.member('after');
  run.at(4_500);
  run.end('after');
  run.at(5_000);
  run.end('call');
  run.end('step');
  run.at(9_500);
  run.end('run');

  expect(run.kept()).toEqual([
    'call:stalled',
    'forked:stalled',
    'plan:stalled',
    'query:stalled',
    'resumed:stalled',
    'run:stalled',
    'step:stalled',
  ]);
});

test('a unit nobody keeps joins the unit around it, so a kept enclosing unit hands it over and its late spans follow', () => {
  const run = harness();
  run.root('run');
  run.at(60_000);
  run.unit('tool');
  run.member('op', 'tool');
  run.unit('child', 'tool');
  run.member('query', 'child');
  run.member('forked', 'tool');
  run.at(60_100);
  run.end('query');
  run.at(60_200);
  run.end('child');
  run.at(60_300);
  run.end('op', { failed: true });
  run.at(60_400);
  run.end('tool');
  run.at(90_000);
  run.end('forked');

  expect(run.kept()).toEqual(['child:failed', 'forked:failed', 'op:failed', 'query:failed', 'tool:failed']);
});

test("a late span of a joined unit follows the kept unit it joined, even after that unit's own head ended", () => {
  const run = harness();
  run.root('run');
  run.unit('tool');
  run.unit('child', 'tool');
  run.member('forked', 'child');
  run.member('op', 'tool');
  run.at(100);
  run.end('op', { failed: true });
  run.at(200);
  run.end('child');
  run.at(300);
  run.end('tool');
  run.at(400);
  run.end('forked');
  run.at(500);
  run.end('run');

  expect(run.kept()).toEqual(['child:failed', 'forked:failed', 'op:failed', 'tool:failed']);
});

test('a unit forgotten past the byte bound still hands over its head when the head ends slow', () => {
  const run = harness();
  run.root('run');
  run.unit('tool');
  for (let index = 0; index < 30; index += 1) {
    run.member(`read-${index}`, 'tool');
    run.at(1_000 + index);
    run.end(`read-${index}`, { bytes: 10 * 1024 });
  }
  run.at(90_000);
  run.end('tool', { slow: true });

  expect(run.kept()).toEqual(['tool:slow']);
  expect(run.sampler.counts.droppedSpans).toBeGreaterThan(0);
});

test('a trace the hash chose hands over every span it ends, window by window', () => {
  const run = harness(EVERY_TRACE);
  run.root('run');
  const ended: string[] = [];
  for (let index = 0; index < 5; index += 1) {
    const unit = `step-${index}`;
    run.unit(unit);
    run.member(`call-${index}`, unit);
    run.member(`persist-${index}`);
    run.at(index * 60_000 + 1_000);
    run.end(`call-${index}`);
    run.end(unit);
    run.end(`persist-${index}`);
    ended.push(`call-${index}:hash`, `${unit}:hash`, `persist-${index}:hash`);
  }
  run.at(400_000);
  run.end('run');

  expect(run.kept()).toEqual([...ended, 'run:hash'].sort());
});

test('a root that ends slow inside its first window keeps its whole trace, the units that ended in it included', () => {
  const run = harness();
  run.root('request');
  run.unit('step');
  run.member('read', 'step');
  run.member('write');
  run.at(50);
  run.end('read');
  run.at(60);
  run.end('step');
  run.at(80);
  run.end('write');
  run.at(300);
  run.end('request', { slow: true });

  expect(run.kept()).toEqual(['read:slow', 'request:slow', 'step:slow', 'write:slow']);
});
