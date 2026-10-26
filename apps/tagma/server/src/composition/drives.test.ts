import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Context, Deferred, Effect } from 'effect';
import { makeDrives } from './drives.js';

const Place = Context.Reference<string>('test/drives/Place', { defaultValue: () => 'starter' });

it.effect('a chosen driver starts at start with its offerer context and an unchosen one never starts', () =>
  Effect.gen(function* () {
    const { drives, start } = makeDrives(new Set(['sweep', 'warm']), new Set(['sweep']));
    const swept = yield* Deferred.make<string>();
    let warmed = false;
    yield* drives
      .offer(
        'sweep',
        Effect.flatMap(Place, (place) => Deferred.succeed(swept, place)),
      )
      .pipe(Effect.provideService(Place, 'offerer'));
    yield* drives.offer(
      'warm',
      Effect.sync(() => (warmed = true)),
    );
    expect(yield* Deferred.isDone(swept)).toBe(false);
    yield* start;
    expect(yield* Deferred.await(swept)).toBe('offerer');
    expect(warmed).toBe(false);
  }),
);
