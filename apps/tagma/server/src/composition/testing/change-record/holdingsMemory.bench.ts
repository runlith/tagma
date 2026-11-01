import { gcAndSweep } from 'bun:jsc';
import { Session } from 'node:inspector';
import { Clock, Console, Effect, Fiber, Tracer } from 'effect';
import { and, eq } from 'drizzle-orm';
import { contentDigest } from '@runlith/files/content';
import { workspaceChange } from '../../../change-record/store/tables.js';
import { changeDebt, releasedLine, retirementWrites } from '../../../change-record/store/retirement.js';
import { restoreAt } from '../../../change-record/holdings/restore.js';
import { edited, fixture, layers, MINE } from './threadFilesWorld.js';

const lines = Number(process.env.HOLDINGS_LINES ?? 100_000);
const snapshot = process.env.HOLDINGS_SNAPSHOT;
const profile = process.env.HOLDINGS_PROFILE;
const scenario = process.env.HOLDINGS_CASE ?? 'ordinary';
if (!['ordinary', 'witness', 'debt', 'restore'].includes(scenario)) throw new Error('unknown Holdings benchmark case');
const spans: Tracer.NativeSpan[] = [];
const tracer = Tracer.make({
  span: (options) => {
    const span = new Tracer.NativeSpan(options);
    if (span.name === 'Holdings.judge' || span.name === 'Holdings.path' || span.name === 'Walks.worker' || span.name === 'Walks.inputs')
      spans.push(span);
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
    const recorded = yield* world.units.read((unit) =>
      unit.run(
        world.store.db
          .select({ id: workspaceChange.id })
          .from(workspaceChange)
          .where(and(eq(workspaceChange.checkout, world.rootId), eq(workspaceChange.path, path))),
      ),
    );
    const selected = new Set(recorded.map((row) => row.id));
    const withWitness = scenario === 'witness' || scenario === 'debt';
    if (withWitness) {
      yield* world.files.writeFileString(world.paths.join(world.root, path), `${text}released\n`);
      yield* world.units.write(retirementWrites, (unit) =>
        Effect.gen(function* () {
          yield* unit.run(
            world.store.db.insert(releasedLine).values({
              row: recorded[0]!.id,
              checkout: world.rootId,
              path,
              thread: MINE,
              reason: 'rewound',
              span: { firstLine: lines + 1, before: [], after: [contentDigest('released\n')] },
            }),
          );
          if (scenario === 'debt')
            yield* unit.run(
              world.store.db.insert(changeDebt).values({
                checkout: world.rootId,
                path,
                commit: 'benchmark',
                reason: 'benchmark',
                windows: [{ lead: null, before: text.match(/[^\n]*\n/g) ?? [], after: [], trail: null }],
              }),
            );
        }),
      );
    }
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
      if (scenario === 'restore' && paths.length === 1 && paths[0] === path) {
        const result = yield* restoreAt(
          { store: world.store, units: world.units, git: world.git, files: world.files, walks: world.walks },
          { rootId: world.rootId, dir: world.root },
          path,
          selected,
        );
        if (
          result.kind !== 'folded' ||
          'reason' in result.restored ||
          result.restored.text !== null ||
          result.verdict.writers.reduce((sum, writer) => sum + writer.added, 0) !== lines
        )
          return yield* Effect.die('the benchmark rollback lost its replacement or row counts');
        return Number(clock.monotonicTimeNanosUnsafe() - start) / 1_000_000;
      }
      const judged = yield* world.holdings.judged(world.rootId, paths);
      const ms = Number(clock.monotonicTimeNanosUnsafe() - start) / 1_000_000;
      if (judged.size !== paths.length || [...judged.values()].some((one) => one.verdict.verdict !== 'proven'))
        return yield* Effect.die('the benchmark paths could not be proven');
      const one = judged.get(path);
      if (
        one !== undefined &&
        (one.holding.git !== 'ignored' || one.holding.lines === 'unweighed' || one.holding.lines.added !== lines + (withWitness ? 1 : 0))
      )
        return yield* Effect.die('the ignored benchmark path lost its recorded lines');
      if (
        one !== undefined &&
        withWitness &&
        (one.holding.verdict.verdict !== 'proven' ||
          !one.holding.verdict.nobody.some((group) => group.why.kind === 'released' && group.added === 1))
      )
        return yield* Effect.die('the benchmark release witness was not classified');
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
    let inspector: Session | undefined;
    if (profile !== undefined) {
      inspector = new Session();
      inspector.connect();
      yield* Effect.addFinalizer(() => Effect.sync(() => inspector?.disconnect()));
      const session = inspector;
      yield* Effect.callback<void>((resume) => session.post('Profiler.enable', (error) => resume(error ? Effect.die(error) : Effect.void)));
      yield* Effect.callback<void>((resume) => session.post('Profiler.start', (error) => resume(error ? Effect.die(error) : Effect.void)));
    }
    const sends: Record<string, number[]> = {};
    yield* Effect.acquireRelease(
      Effect.sync(() => {
        const original = Worker.prototype.postMessage;
        Worker.prototype.postMessage = function (
          this: Worker,
          message,
          options?: Parameters<Worker['postMessage']>[1] | NonNullable<Parameters<Worker['postMessage']>[1]>['transfer'],
        ) {
          const start = clock.monotonicTimeNanosUnsafe();
          const answer = Reflect.apply(original, this, [message, options]);
          const kind = String(message?.kind ?? 'other');
          (sends[kind] ??= []).push(Number(clock.monotonicTimeNanosUnsafe() - start) / 1_000_000);
          return answer;
        };
        return original;
      }),
      (original) =>
        Effect.sync(() => {
          Worker.prototype.postMessage = original;
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
    if (inspector !== undefined && profile !== undefined) {
      const session = inspector;
      const captured = yield* Effect.callback<unknown>((resume) =>
        session.post('Profiler.stop', (error, result) => resume(error ? Effect.die(error) : Effect.succeed(result.profile))),
      );
      yield* world.files.writeFileString(profile, JSON.stringify(captured));
    }
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
      foldBytes: span.attributes.get('fold.cache.bytes'),
      foldBudget: span.attributes.get('fold.cache.budget'),
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
        scenario,
        bytes: text.length,
        ordinary: ordinary.length,
        large,
        landing,
        details,
        jobs,
        projections: spans.filter((span) => span.name === 'Holdings.path').length,
        loopMaxMs,
        sends,
        inputMs: spans
          .filter((span) => span.name === 'Walks.inputs')
          .map((span) => (span.status._tag === 'Ended' ? Number(span.status.endTime - span.startTime) / 1_000_000 : null)),
        snapshot,
      }),
    );
  }).pipe(Effect.scoped, Effect.provide(layers), Effect.withTracer(tracer)),
);
