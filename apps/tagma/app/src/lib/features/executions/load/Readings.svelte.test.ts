import { Scope } from '@runlith/layer/Scope';
import { expect, test } from 'vitest';
import { liveFeed } from '$lib/app/testing.js';
import { Readings } from './Readings.svelte.js';

test('a delta over a sequence the reader does not hold opens the machine feed again instead of applying it', async () => {
  const feed = liveFeed();
  const readings = new Readings(feed.live, Scope.make());
  readings.follow();
  const first = feed.routes.get('load.machine');
  if (first === undefined) throw new Error('The machine feed was not subscribed.');
  first({ _tag: 'Snapshot', sequence: 3, snapshot: { composedAt: 1, reader: 'reader-1', state: { _tag: 'Waiting' }, history: [] } });
  first({ _tag: 'Delta', sequence: 9, base: 8, delta: { composedAt: 2, state: { _tag: 'Outdated', reason: 'a skipped frame' } } });
  await Promise.resolve();
  expect(readings.state._tag).toBe('Waiting');
  expect(feed.routes.get('load.machine')).not.toBe(first);
});
