import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Deferred, Effect, Fiber, Stream } from 'effect';
import { filesWorld, worldLayers } from '../testing/world.js';

const everything = { regex: false, caseSensitive: false, wholeWord: false, include: [], exclude: [] } as const;

it.live(
  'search streams match ranges and totals, excludes internal trees, refuses malformed patterns and reports a truncated match limit',
  () =>
    Effect.gen(function* () {
      const { place, searches, write } = yield* filesWorld;
      yield* write('src/a.ts', 'const Needle = 1;\nneedle again, needle\n');
      yield* write('.hidden/b.ts', 'a needle\n');
      yield* write('skip/c.ts', 'needle\n');
      yield* write('.tagma/graph.md', 'needle\n');
      yield* write('.git/hook', 'needle\n');
      const frames = [...(yield* Stream.runCollect(searches.run(place, { ...everything, pattern: 'needle', exclude: ['skip'] })))];
      const files = frames.flatMap((frame) => (frame.kind === 'file' ? [frame] : []));
      expect(files.map((frame) => frame.file).sort()).toEqual(['.hidden/b.ts', 'src/a.ts']);
      const source = files.find((frame) => frame.file === 'src/a.ts');
      expect(source?.matches.map((match) => [match.line, match.ranges.length])).toEqual([
        [1, 1],
        [2, 2],
      ]);
      expect(source?.matches[0]?.ranges[0]).toEqual({ start: 6, end: 12 });
      expect(frames.at(-1)).toMatchObject({ kind: 'done', files: 2, matches: 4, truncated: false });
      expect(yield* Effect.flip(Stream.runCollect(searches.run(place, { ...everything, regex: true, pattern: '(' })))).toMatchObject({
        code: 'search-failed',
      });
      yield* write('big.txt', 'x\n'.repeat(20_001));
      const limited = [...(yield* Stream.runCollect(searches.run(place, { ...everything, pattern: 'x' })))];
      const file = limited.find((frame) => frame.kind === 'file');
      expect(file?.kind === 'file' ? file.matches.length : 0).toBe(20_000);
      expect(limited.at(-1)).toMatchObject({ kind: 'done', matches: 20_000, truncated: true });
    }).pipe(Effect.provide(worldLayers)),
);

it.live('a newer search of a checkout ends the older one with a refusal', () =>
  Effect.gen(function* () {
    const { place, searches, write } = yield* filesWorld;
    yield* write('a.txt', 'x\n');
    const started = yield* Deferred.make<void>();
    const gate = yield* Deferred.make<void>();
    const older = yield* Effect.forkScoped(
      Effect.flip(
        Stream.runForEach(searches.run(place, { ...everything, pattern: 'x' }), () =>
          Effect.andThen(Deferred.succeed(started, undefined), Deferred.await(gate)),
        ),
      ),
    );
    yield* Deferred.await(started);
    yield* Stream.runCollect(searches.run(place, { ...everything, pattern: 'x' }));
    yield* Deferred.succeed(gate, undefined);
    expect((yield* Fiber.join(older)).code).toBe('search-superseded');
  }).pipe(Effect.provide(worldLayers)),
);
