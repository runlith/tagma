import { gcAndSweep } from 'bun:jsc';
import { Clock, Console, Effect, Fiber, Tracer } from 'effect';
import { edited, fixture, layers } from './threadFilesWorld.js';

const lines = Number(process.env.HOLDINGS_LINES ?? 100_000);
const snapshot = process.env.HOLDINGS_SNAPSHOT;
const spans: Tracer.NativeSpan[] = [];
const tracer = Tracer.make({
  span: (options) => {
    const span = new Tracer.NativeSpan(options);
    if (span.name === 'Holdings.judge' || span.name === 'Holdings.path' || span.name === 'Walks.worker') spans.push(span);
    return span;
  },
});

await Effect.runPromise(
  Effect.gen(function* () {
    const world = yield* fixture;
    yield* Effect.addFinalizer(() => world.walks.close);
    const clock = yield* Clock.Clock;
    yield* world.holdings.hold(world.rootId);
    yield* world.files.writeFileString(world.paths.join(world.root, '.gitignore'), '*.log\n');
    const path = 'large.log';
    const text = Array.from({ length: lines }, (_, at) => `recorded ${at}\n`).join('');
    yield* world.files.writeFileString(world.paths.join(world.root, path), text);
    yield* edited(world.mine, world.paths.join(world.root, path), '', text);
    const ordinary: string[] = [];
    for (let at = 0; at < 8; at += 1) {
      const name = `ordinary-${at}.txt`;
      ordinary.push(name);
      const value = `ordinary ${at}\n`;
      yield* world.files.writeFileString(world.paths.join(world.root, name), value);
      yield* edited(world.mine, world.paths.join(world.root, name), '', value);
    }
    yield* world.holdings.settled(world.rootId);
    const measured = Effect.fnUntraced(function* (paths: readonly string[]) {
      const start = clock.monotonicTimeNanosUnsafe();
      const judged = yield* world.holdings.judged(world.rootId, paths);
      const ms = Number(clock.monotonicTimeNanosUnsafe() - start) / 1_000_000;
      if (judged.size !== paths.length || [...judged.values()].some((one) => one.verdict.verdict !== 'proven'))
        return yield* Effect.die('the benchmark paths could not be proven');
      const one = judged.get(path);
      if (one !== undefined && (one.holding.git !== 'ignored' || one.holding.lines === 'unweighed' || one.holding.lines.added !== lines))
        return yield* Effect.die('the ignored benchmark path lost its recorded lines');
      return ms;
    });
    let loopMaxMs = 0;
    const observer = yield* Effect.forkScoped(
      Effect.gen(function* () {
        for (;;) {
          const before = clock.monotonicTimeNanosUnsafe();
          yield* Effect.sleep('1 millis');
          loopMaxMs = Math.max(loopMaxMs, Number(clock.monotonicTimeNanosUnsafe() - before) / 1_000_000 - 1);
        }
      }),
    );
    spans.length = 0;
    const large: number[] = [];
    const landing: number[] = [];
    for (let at = 0; at < 5; at += 1) {
      large.push(yield* measured([path]));
      landing.push(yield* measured(ordinary));
    }
    yield* world.holdings.settled(world.rootId);
    yield* Effect.yieldNow;
    yield* Fiber.interrupt(observer);
    gcAndSweep();
    gcAndSweep();
    if (snapshot !== undefined) {
      const buffer = Bun.generateHeapSnapshot('v8', 'arraybuffer');
      yield* world.files.writeFile(snapshot, new Uint8Array(buffer));
    }
    const judges = spans.filter((span) => span.name === 'Holdings.judge');
    const details = judges.map((span) => ({
      bytes: span.attributes.get('verdict.cache.bytes'),
      budget: span.attributes.get('verdict.cache.budget'),
    }));
    const jobs = spans
      .filter((span) => span.name === 'Walks.worker')
      .reduce<Record<string, number>>((counts, span) => {
        const kind = String(span.attributes.get('kind'));
        counts[kind] = (counts[kind] ?? 0) + 1;
        return counts;
      }, {});
    yield* Console.log(
      JSON.stringify({
        lines,
        bytes: text.length,
        ordinary: ordinary.length,
        large,
        landing,
        details,
        jobs,
        projections: spans.filter((span) => span.name === 'Holdings.path').length,
        loopMaxMs,
        snapshot,
      }),
    );
  }).pipe(Effect.scoped, Effect.provide(layers), Effect.withTracer(tracer)),
);
