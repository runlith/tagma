import { Failure } from '@runlith/layer/Failure';
import { Scope } from '@runlith/layer/Scope';
import { expect, test } from 'vitest';
import { liveFeed } from '$lib/app/testing.js';
import { Pace } from './Pace.svelte.js';

test('a dismissed pace problem stays away until the problem changes, and a changed problem returns even to an earlier one', () => {
  const feed = liveFeed();
  const pace = new Pace(feed.live, {} as never, {} as never, Scope.make(), Failure.make());
  const frame = feed.routes.get('pace.subscribe');
  if (frame === undefined) throw new Error('The pace feed was not subscribed.');
  const applied = (pace: 'low' | 'lowest', failed: number) =>
    frame({ pace, state: { _tag: 'applied', pace, reached: 3, kept: 0, failed } });
  applied('low', 1);
  pace.dismiss();
  applied('low', 1);
  expect(pace.shown).toBeNull();
  applied('low', 2);
  expect(pace.shown?.key).toBe('low:failed:2');
  pace.dismiss();
  applied('low', 1);
  expect(pace.shown?.key).toBe('low:failed:1');
  pace.dismiss();
  applied('lowest', 1);
  expect(pace.shown?.key).toBe('lowest:failed:1');
});
