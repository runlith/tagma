import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Schema } from 'effect';
import type { PluginContribution } from '../plugins/contract/service/points.js';
import type { PinContributions } from './contract/wire/pins.js';
import { makePinnableViews } from './pinOffers.js';

const contribution = (view: string): PluginContribution<PinContributions> => ({
  plugin: { id: 'poker', title: 'Poker', root: '/poker', data: null },
  value: [{ view }],
  sibling: (name, schema) =>
    name === 'views'
      ? Schema.decodeUnknownSync(schema)([
          { id: 'table', entry: 'ui/table.html' },
          { id: 'hand', entry: 'ui/hand.html' },
        ])
      : undefined,
  tools: null,
  caller: { call: () => Effect.die('the pin contribution calls no tool') },
});

it.effect('only a declared pinnable view is admitted, and unregistering its contribution withdraws it', () =>
  Effect.gen(function* () {
    const offers = makePinnableViews();
    const withdraw = yield* offers.point.register(contribution('table'));
    yield* offers.require('poker', 'table');
    expect(yield* Effect.flip(offers.require('poker', 'hand'))).toMatchObject({ code: 'view-not-pinnable' });
    expect(yield* Effect.flip(offers.require('missing', 'table'))).toMatchObject({ code: 'view-not-pinnable' });
    withdraw();
    expect(yield* Effect.flip(offers.require('poker', 'table'))).toMatchObject({ code: 'view-not-pinnable' });
  }),
);

it.effect('a pin contribution naming an undeclared view refuses without admitting it', () =>
  Effect.gen(function* () {
    const offers = makePinnableViews();
    expect(yield* Effect.flip(offers.point.register(contribution('ghost')))).toMatchObject({
      _tag: 'PluginPointRefused',
      point: 'pins',
      reason: expect.stringContaining('ghost'),
    });
    expect(yield* Effect.flip(offers.require('poker', 'ghost'))).toMatchObject({ code: 'view-not-pinnable' });
  }),
);

it.effect('disposing an older generation leaves the replacement contribution registered', () =>
  Effect.gen(function* () {
    const offers = makePinnableViews();
    const old = yield* offers.point.register(contribution('table'));
    const replacement = yield* offers.point.register(contribution('hand'));
    old();
    yield* offers.require('poker', 'hand');
    expect(yield* Effect.flip(offers.require('poker', 'table'))).toMatchObject({ code: 'view-not-pinnable' });
    replacement();
    expect(yield* Effect.flip(offers.require('poker', 'hand'))).toMatchObject({ code: 'view-not-pinnable' });
  }),
);
