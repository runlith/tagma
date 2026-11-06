import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Context, Effect } from 'effect';
import { TestClock } from 'effect/testing';
import { makeKeeper } from './keeper.js';
import type { Reach } from './reach.js';
import { Ledger } from './store/ledger.js';
import { unreadLedger } from './testing/doubles.js';

const ORIGIN = 'https://tagma-test.tail0000.ts.net';

const reach: Reach = {
  origin: ORIGIN,
  ready: true,
  name: 'test-machine',
  parentOrigin: ORIGIN,
  sandboxOrigin: null,
  read: Effect.die('the pairing code reads only the origin of a ready door'),
  serve: () => Effect.die('the pairing code reads only the origin of a ready door'),
  terminal: { origin: () => Effect.die('the pairing code reads only the origin of a ready door') },
};

it.effect('a pairing code answers again until it expires, then another code stands', () =>
  Effect.gen(function* () {
    const ledger = Ledger.of({ ...unreadLedger, issue: () => Effect.void });
    const devices = yield* Effect.provide(makeKeeper({ reach }), Context.make(Ledger, ledger));
    const first = yield* devices.code;
    expect(yield* devices.code).toEqual(first);
    yield* TestClock.adjust('5 minutes');
    const next = yield* devices.code;
    expect([first.expiresAt, next.expiresAt]).toEqual(['1970-01-01T00:05:00.000Z', '1970-01-01T00:10:00.000Z']);
    expect(next.code).not.toBe(first.code);
    expect(yield* devices.standing).toEqual(next);
  }),
);
