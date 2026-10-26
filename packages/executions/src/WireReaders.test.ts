import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Stream } from 'effect';
import { RequestId, SubscriptionId } from './protocol/wire';
import { wireReaders } from './WireReaders';

const request = RequestId.make(1);
const subscription = SubscriptionId.make(1);

it.effect('a completed subscription keeps its deliveries through a wire close before acquisition', () =>
  Effect.gen(function* () {
    const readers = yield* wireReaders(1);
    yield* readers.reserve(request, 8);
    yield* readers.bind(request, subscription);
    yield* readers.deliver(subscription, { _tag: 'Inventory', update: { _tag: 'Moved', revision: 1, usage: [] } }, 8);
    yield* readers.end(subscription, 'completed');
    yield* readers.closeAll('closed');
    const late = yield* readers.deliver(subscription, { _tag: 'Inventory', update: { _tag: 'Moved', revision: 2, usage: [] } }, 8);
    const crowded = yield* readers.reserve(RequestId.make(2), 8);
    const queue = yield* readers.queueOf(subscription);
    const deliveries = queue === undefined ? [] : yield* Stream.runCollect(Stream.fromQueue(queue));
    const credit = yield* readers.grant(subscription, 8);
    yield* readers.close(subscription);
    const open = yield* readers.open();
    const again = yield* readers.reserve(request, 8);
    expect(deliveries.map((held) => held.delivery)).toEqual([
      { _tag: 'Inventory', update: { _tag: 'Moved', revision: 1, usage: [] } },
      { _tag: 'Ended', ending: 'completed' },
    ]);
    expect(credit).toBe(false);
    expect(late).toBe('unknown');
    expect(crowded !== undefined).toBe(false);
    expect(open).toBe(0);
    expect(again !== undefined).toBe(true);
  }),
);
