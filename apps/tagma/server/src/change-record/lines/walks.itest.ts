import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Deferred, Effect, Fiber, Tracer } from 'effect';
import { makeWalks } from './walks.js';
import { foldPath } from './fold.js';
import { contentOf } from './folding.js';
import { stepsIn } from '@runlith/utils/sequenceDiff';

const textOf = (lines: number, seed: string): string => Array.from({ length: lines }, (_, at) => `${seed} ${at}\n`).join('');

const opened = (options: Parameters<typeof makeWalks>[0]) =>
  Effect.acquireRelease(
    Effect.sync(() => makeWalks(options)),
    (walks) => walks.close,
  );

it.live('a width-three pool keeps at most three live workers while four requests complete', () =>
  Effect.gen(function* () {
    const walks = yield* opened({ size: 3 });
    const spans: Tracer.NativeSpan[] = [];
    const tracer = Tracer.make({
      span: (options) => {
        const span = new Tracer.NativeSpan(options);
        spans.push(span);
        return span;
      },
    });
    const texts = Array.from({ length: 4 }, (_, at) => textOf(4_000, `request-${at}`));
    const answers = yield* Effect.all(
      texts.map((text) => walks.content(text)),
      { concurrency: 4 },
    ).pipe(Effect.withTracer(tracer));
    expect(answers.map((answer) => answer.digest)).toEqual(texts.map((text) => contentOf(text).digest));
    const workers = new Set(spans.filter((span) => span.name === 'Walks.worker').map((span) => span.attributes.get('worker')));
    expect(workers.size).toBeGreaterThan(0);
    expect(workers.size).toBeLessThanOrEqual(3);
  }),
);

it.live('a request-path walk uses the reserved slot while the background lane is full', () =>
  Effect.gen(function* () {
    const walks = yield* opened({ size: 2, wall: 60_000 });
    const finished: string[] = [];
    const spans: Tracer.NativeSpan[] = [];
    const tracer = Tracer.make({
      span: (options) => {
        const span = new Tracer.NativeSpan(options);
        spans.push(span);
        return span;
      },
    });
    const measured = (name: string, lines: number, lane: 'now' | 'later') =>
      Effect.result(walks.content(textOf(lines, name), undefined, lane)).pipe(
        Effect.withSpan(name),
        Effect.withTracer(tracer),
        Effect.andThen(Effect.sync(() => finished.push(name))),
      );
    yield* Effect.all([measured('busy', 4_000, 'later'), measured('behind', 2, 'later'), measured('asked', 2, 'now')], {
      concurrency: 'unbounded',
    });
    const ended = (name: string, kind: string): bigint => {
      const parent = spans.find((span) => span.name === name)!;
      const span = spans.find((one) => one.name === kind && one.parent._tag === 'Some' && one.parent.value.spanId === parent.spanId)!;
      return span.status._tag === 'Ended' ? span.status.endTime : -1n;
    };
    expect(ended('asked', 'Walks.queue')).toBeLessThan(ended('busy', 'Walks.worker'));
    expect(ended('behind', 'Walks.queue')).toBeGreaterThanOrEqual(ended('busy', 'Walks.worker'));
    for (const name of finished) {
      const parent = spans.find((span) => span.name === name)!;
      const children = spans.filter((span) => span.parent._tag === 'Some' && span.parent.value.spanId === parent.spanId);
      const queue = children.find((span) => span.name === 'Walks.queue')!;
      const worker = children.find((span) => span.name === 'Walks.worker')!;
      expect(queue.status._tag).toBe('Ended');
      expect(worker.status._tag).toBe('Ended');
      if (queue.status._tag === 'Ended') expect(queue.status.endTime).toBeLessThanOrEqual(worker.startTime);
      expect(queue.attributes.get('lane')).toBe(name === 'asked' ? 'now' : 'later');
    }
  }),
);

it.live('worker telemetry outlives a cancelled caller and ends when the owner closes the job', () =>
  Effect.gen(function* () {
    const walks = yield* opened({ size: 1 });
    const entered = yield* Deferred.make<Tracer.NativeSpan>();
    const tracer = Tracer.make({
      span: (options) => {
        const span = new Tracer.NativeSpan(options);
        if (span.name === 'Walks.worker') Deferred.doneUnsafe(entered, Effect.succeed(span));
        return span;
      },
    });
    const caller = yield* Effect.forkChild(walks.content(textOf(4_000, 'cancelled')).pipe(Effect.withTracer(tracer)));
    const worker = yield* Deferred.await(entered);
    yield* Fiber.interrupt(caller);
    expect(worker.status._tag).toBe('Started');
    yield* walks.close;
    expect(worker.status._tag).toBe('Ended');
    if (worker.status._tag === 'Ended') expect(worker.status.exit._tag).toBe('Failure');
  }),
);

it.live('the worker-run fold answers the verdict of the pure fold and keeps its state in the asking process', () =>
  Effect.gen(function* () {
    const base = Array.from({ length: 400 }, (_, at) => `line ${at}\n`).join('');
    const first = base.replace('line 10\n', 'A\n');
    const work = `${first.replace('line 300\n', '')}external\n`;
    const rows = [{ id: 'a', holder: 'A', before: contentOf(base), after: contentOf(first) }];
    const walks = yield* opened({ size: 1, wall: 60_000 });
    const [baseText, headText, workText] = yield* Effect.all([walks.content(base), walks.content(base), walks.content(work)]);
    const input = { base: baseText, head: headText, working: workText, rows, normalized: false };
    const remote = yield* walks.fold(input);
    const local = foldPath({ ...input, base: contentOf(base), head: contentOf(base), working: contentOf(work) }, stepsIn(1 << 23));
    expect(remote.result).toMatchObject({
      verdict: 'proven',
      hands: [{ holder: 'A', added: 1, removed: 1 }],
      nobody: { added: 1, removed: 1 },
    });
    if (remote.result.verdict !== 'proven' || local.result.verdict !== 'proven') return yield* Effect.die('both folds must prove');
    expect(remote.result.lines).toEqual(local.result.lines);
    expect(remote.record?.last).toBe('a');
  }),
);
