import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Deferred, Effect } from 'effect';
import { startFakeHelper } from '../testing/helper.ts';
import { socketPair } from '../testing/socketPair.ts';
import { conformance, type Launch } from './scenario.ts';

const launch: Launch = Effect.fnUntraced(function* (token) {
  const pair = yield* socketPair;
  const helper = yield* startFakeHelper(pair.helper, token, { drainPerMs: 4 });
  return { socket: pair.client, exited: Deferred.await(helper.quit) };
});

describe('helper conformance', () => {
  it.live('the reference helper passes every step', () =>
    Effect.gen(function* () {
      const passed = yield* conformance(launch);
      expect(passed).toEqual([
        'hello',
        'devices',
        'output',
        'refusal',
        'two captures, helper clock, stop with tail',
        'gap and abort',
        'playback with credit, clear and release',
        'overlapping mute holders',
        'unknown message',
        'eof with held resources',
      ]);
    }),
  );
});
