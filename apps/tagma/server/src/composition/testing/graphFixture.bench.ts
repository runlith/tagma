import { Clock, Effect } from 'effect';
import { graphFixture } from './graphFixture.js';

const rounds = (() => {
  const raw = Bun.argv.find((value) => value.startsWith('--rounds='));
  const value = raw === undefined ? 30 : Number.parseInt(raw.slice('--rounds='.length), 10);
  if (!Number.isSafeInteger(value) || value < 2) throw new Error('--rounds must be an integer of at least 2');
  return value;
})();

const world = graphFixture();
const opens: number[] = [];
const releases: number[] = [];
await Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      const clock = yield* Clock.Clock;
      const now = () => Number(clock.monotonicTimeNanosUnsafe()) / 1e6;
      yield* Effect.addFinalizer(() => Effect.orDie(world.releaseEffect));
      for (let round = 0; round < rounds; round += 1) {
        const opening = now();
        yield* world.openEffect();
        const opened = now();
        yield* world.releaseEffect;
        opens.push(opened - opening);
        releases.push(now() - opened);
      }
    }),
  ),
);

const percentile = (values: readonly number[], at: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length * at) / 100))] ?? Number.NaN;
};
const summary = (values: readonly number[]) => ({
  p50: Number(percentile(values, 50).toFixed(1)),
  p90: Number(percentile(values, 90).toFixed(1)),
  max: Number(Math.max(...values).toFixed(1)),
});

console.log(
  JSON.stringify({
    rounds,
    firstOpenMs: Number((opens[0] ?? Number.NaN).toFixed(1)),
    openMs: summary(opens.slice(1)),
    releaseMs: summary(releases.slice(1)),
  }),
);
