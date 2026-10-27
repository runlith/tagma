import { Scope } from '@runlith/layer/Scope';
import { expect, test } from 'vitest';
import { liveFeed } from '$lib/app/testing.js';
import { Readings } from './Readings.svelte.js';

test('every holder of the reading shares one machine feed, which closes only when the last lets go and opens again for the next', () => {
  const feed = liveFeed();
  const readings = new Readings(feed.live, Scope.make());
  const feedRow = readings.hold();
  const frame = readings.hold();
  expect(feed.asked).toHaveLength(1);
  feed.routes.get('load.machine')?.({
    _tag: 'Snapshot',
    sequence: 1,
    snapshot: { composedAt: 1, reader: 'reader-1', state: { _tag: 'Outdated', reason: 'old host' }, history: [] },
  });
  feedRow();
  feedRow();
  expect(readings.state._tag).toBe('Outdated');
  frame();
  expect(readings.state._tag).toBe('Waiting');
  readings.hold();
  expect(feed.asked).toHaveLength(2);
});

test('a delta over a sequence the reader does not hold opens the machine feed again instead of applying it', async () => {
  const feed = liveFeed();
  const readings = new Readings(feed.live, Scope.make());
  readings.hold();
  const first = feed.routes.get('load.machine');
  if (first === undefined) throw new Error('The machine feed was not subscribed.');
  first({ _tag: 'Snapshot', sequence: 3, snapshot: { composedAt: 1, reader: 'reader-1', state: { _tag: 'Waiting' }, history: [] } });
  first({ _tag: 'Delta', sequence: 9, base: 8, delta: { composedAt: 2, state: { _tag: 'Outdated', reason: 'a skipped frame' } } });
  await Promise.resolve();
  expect(readings.state._tag).toBe('Waiting');
  expect(feed.routes.get('load.machine')).not.toBe(first);
});
