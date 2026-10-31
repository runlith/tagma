import { Failure } from '@runlith/layer/Failure';
import { Scope } from '@runlith/layer/Scope';
import { expect, test } from 'vitest';
import { liveFeed } from '$lib/app/testing.js';
import { Pace } from './Pace.svelte.js';

test('a dismissed pace problem stays away until the problem changes', () => {
  const feed = liveFeed();
  const pace = new Pace(feed.live, {} as never, {} as never, Scope.make(), Failure.make());
  const frame = feed.routes.get('pace.subscribe');
  if (frame === undefined) throw new Error('The pace feed was not subscribed.');
  const applied = (failed: number) => frame({ pace: 'low', state: { _tag: 'applied', pace: 'low', reached: 3, kept: 0, failed } });
  applied(1);
  expect(pace.shown?.title).toBe('1 running process could not be moved to Low');
  pace.dismiss();
  expect(pace.shown).toBeNull();
  applied(1);
  expect(pace.shown).toBeNull();
  applied(2);
  expect(pace.shown?.title).toBe('2 running processes could not be moved to Low');
});
