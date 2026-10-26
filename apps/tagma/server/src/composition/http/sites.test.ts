import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Stream } from 'effect';
import { makeLocalSites } from './sites.js';

it.effect('a local site reader receives the current site and the next refusal', () =>
  Effect.gen(function* () {
    const sites = yield* makeLocalSites(5636);
    const pull = yield* Stream.toPull(Stream.map(sites.moved, () => sites.site('board')));
    expect(yield* pull).toEqual([{ _tag: 'served', origin: 'http://board.localhost:5636' }]);
    sites.refuse('the loopback is occupied');
    expect(yield* pull).toEqual([{ _tag: 'unserved', reason: 'the loopback is occupied' }]);
    expect(
      yield* Stream.runCollect(
        Stream.take(
          Stream.map(sites.moved, () => sites.site('board')),
          1,
        ),
      ),
    ).toEqual([{ _tag: 'unserved', reason: 'the loopback is occupied' }]);
  }),
);
