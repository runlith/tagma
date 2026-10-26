import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Schedule } from 'effect';
import { filesWorld, worldLayers } from '../testing/world.js';

it.live('a newer index question supersedes the pending one, and the index follows paths and checkout ignore files', () =>
  Effect.gen(function* () {
    const { place, indexes, write } = yield* filesWorld;
    yield* write('keep/a.txt', 'x');
    yield* write('skip/b.txt', 'x');
    const ask = indexes.find(place, { query: 'txt', limit: 4, recent: [] });
    const both = yield* Effect.all([Effect.result(ask), Effect.result(ask)], { concurrency: 2 });
    expect(both.flatMap((result) => (result._tag === 'Success' ? [result.success.files.map((file) => file.path).sort()] : []))).toEqual([
      ['keep/a.txt', 'skip/b.txt'],
    ]);
    expect(both.flatMap((result) => (result._tag === 'Failure' ? [result.failure.code] : []))).toEqual(['superseded']);
    const until = (wanted: readonly string[]) =>
      ask.pipe(
        Effect.map((found) => found.files.map((file) => file.path).sort()),
        Effect.flatMap((found) =>
          JSON.stringify(found) === JSON.stringify(wanted) ? Effect.succeed(found) : Effect.fail('not yet' as const),
        ),
        Effect.retry({ schedule: Schedule.spaced('50 millis'), times: 100 }),
      );
    yield* write('fresh/c.txt', 'x');
    expect(yield* until(['fresh/c.txt', 'keep/a.txt', 'skip/b.txt'])).toEqual(['fresh/c.txt', 'keep/a.txt', 'skip/b.txt']);
    yield* write('.gitignore', 'skip/\n');
    expect(yield* until(['fresh/c.txt', 'keep/a.txt'])).toEqual(['fresh/c.txt', 'keep/a.txt']);
    yield* write('.git/info/exclude', 'fresh/\n');
    expect(yield* until(['keep/a.txt'])).toEqual(['keep/a.txt']);
  }).pipe(Effect.provide(worldLayers)),
);

it.live('external excludes edits, atomic replacement and a configured path change update the standing index', () =>
  Effect.gen(function* () {
    const { place, indexes, write, run, files, paths, root } = yield* filesWorld;
    const excludes = paths.resolve(root, '../ignore');
    const other = paths.resolve(root, '../other-ignore');
    yield* write('keep/a.txt', 'x');
    yield* write('skip/b.txt', 'x');
    yield* write('../ignore', '');
    yield* write('../other-ignore', 'keep/a.txt\n');
    yield* run(['config', 'core.excludesFile', excludes]);
    const ask = indexes.find(place, { query: 'txt', limit: 2, recent: [] });
    const until = (wanted: readonly string[]) =>
      ask.pipe(
        Effect.map((found) => found.files.map((file) => file.path).sort()),
        Effect.flatMap((found) =>
          JSON.stringify(found) === JSON.stringify(wanted) ? Effect.succeed(found) : Effect.fail('not yet' as const),
        ),
        Effect.retry({ schedule: Schedule.spaced('50 millis'), times: 100 }),
      );
    expect((yield* ask).matched).toBe(2);
    yield* write('../ignore.next', 'skip/b.txt\n');
    yield* files.rename(`${excludes}.next`, excludes);
    expect(yield* until(['keep/a.txt'])).toEqual(['keep/a.txt']);
    yield* run(['config', 'core.excludesFile', other]);
    expect(yield* until(['skip/b.txt'])).toEqual(['skip/b.txt']);
    yield* write('../other-ignore', 'skip/b.txt\n');
    expect(yield* until(['keep/a.txt'])).toEqual(['keep/a.txt']);
    yield* run(['config', 'core.excludesFile', '']);
    expect(yield* until(['keep/a.txt', 'skip/b.txt'])).toEqual(['keep/a.txt', 'skip/b.txt']);
  }).pipe(Effect.provide(worldLayers)),
);
