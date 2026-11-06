import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { PluginPoints } from '../plugins/contract/service/points.js';
import { pluginPoints } from '../plugins/testing/points.js';
import { makePinnableViews } from './pinOffers.js';

const POKER = { id: 'poker', title: 'Poker', root: '/poker', data: '/poker-data' };
const CALLER = { call: () => Effect.die('the pin contribution calls no tool') };

const pinning = Effect.gen(function* () {
  const points = pluginPoints();
  const offers = yield* makePinnableViews.pipe(Effect.provideService(PluginPoints, points));
  return { offers, publish: (view: string) => points.publish(POKER, { pins: [{ view }] }, CALLER) };
});

it.effect('only a declared pinnable view is admitted, and withdrawing its contribution withdraws it', () =>
  Effect.gen(function* () {
    const { offers, publish } = yield* pinning;
    const withdraw = yield* publish('table');
    yield* offers.require('poker', 'table');
    expect(yield* Effect.flip(offers.require('poker', 'hand'))).toMatchObject({ code: 'view-not-pinnable' });
    expect(yield* Effect.flip(offers.require('missing', 'table'))).toMatchObject({ code: 'view-not-pinnable' });
    withdraw();
    expect(yield* Effect.flip(offers.require('poker', 'table'))).toMatchObject({ code: 'view-not-pinnable' });
  }),
);

it.effect('withdrawing an older publication leaves the replacement contribution standing', () =>
  Effect.gen(function* () {
    const { offers, publish } = yield* pinning;
    const old = yield* publish('table');
    const replacement = yield* publish('hand');
    old();
    yield* offers.require('poker', 'hand');
    expect(yield* Effect.flip(offers.require('poker', 'table'))).toMatchObject({ code: 'view-not-pinnable' });
    replacement();
    expect(yield* Effect.flip(offers.require('poker', 'hand'))).toMatchObject({ code: 'view-not-pinnable' });
  }),
);
