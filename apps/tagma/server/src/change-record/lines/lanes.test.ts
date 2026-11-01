import { expect, test } from 'bun:test';
import { WorkLanes } from './lanes.js';

type Job = { readonly name: string; ready: boolean };

test('an affinity-blocked urgent lane leaves idle capacity to runnable background work', () => {
  const lanes = new WorkLanes<Job>((job) => job.ready);
  const pinned = { name: 'pinned', ready: false };
  const background = { name: 'background', ready: true };
  const urgent = { name: 'urgent', ready: true };
  lanes.offer('now', pinned);
  lanes.offer('later', background);
  expect(lanes.first(false)).toBeUndefined();
  expect(lanes.first(true)).toEqual({ lane: 'later', value: background });
  lanes.offer('now', urgent);
  expect(lanes.first(true)).toEqual({ lane: 'now', value: urgent });
  lanes.remove(urgent);
  pinned.ready = true;
  expect(lanes.first(true)).toEqual({ lane: 'now', value: pinned });
  lanes.remove(pinned);
  expect(lanes.drain()).toEqual([background]);
  expect(lanes.first(true)).toBeUndefined();
});
