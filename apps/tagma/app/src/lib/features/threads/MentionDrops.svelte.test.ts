// @vitest-environment jsdom

import { expect, test } from 'vitest';
import { type Mention, MentionDrops, type MentionZone } from './MentionDrops.svelte.js';

function surface(): { readonly root: HTMLElement; readonly frame: HTMLElement; readonly feed: HTMLElement } {
  const root = document.createElement('div');
  const feed = document.createElement('div');
  const frame = document.createElement('div');
  frame.dataset.composerFrame = '';
  frame.append(document.createElement('textarea'));
  root.append(feed, frame);
  return { root, frame, feed };
}

function zone(own: string, held: readonly string[]) {
  const place = surface();
  const got: Mention[] = [];
  const shape: MentionZone = {
    covers: (under) => {
      const frame = under.closest('[data-composer-frame]');
      return frame !== null && place.root.contains(frame);
    },
    own: () => own,
    holds: (name) => held.includes(name),
    mention: (mentions) => got.push(...mentions),
  };
  return { place, got, shape };
}

const thread = (name: string): Mention => ({ name, title: name });

test('a carried mention lands only in the composer frame under it, never as its own thread or twice, and a gone zone stops being aimed', () => {
  const drops = new MentionDrops();
  const main = zone('t-main', ['t-held']);
  const side = zone('t-side', []);
  const leaveSide = drops.add('side', side.shape);
  drops.add('main', main.shape);

  expect(drops.at(main.place.frame.firstElementChild!)).toBe('main');
  expect(drops.at(side.place.frame)).toBe('side');
  expect(drops.at(main.place.feed)).toBeNull();

  drops.follow([thread('t-main')], 'main');
  expect(drops.accepts('main', [thread('t-main'), thread('t-held')])).toBe(false);
  expect(drops.stateOf('main', main.shape)).toBeNull();
  expect(drops.stateOf('side', side.shape)).toBe('ready');

  drops.follow([thread('t-a'), thread('project:5')], 'main');
  expect(drops.stateOf('main', main.shape)).toBe('aimed');
  drops.mention('main', [
    { name: 't-a', title: 'Row heights' },
    thread('t-held'),
    thread('t-main'),
    { name: 'project:5', title: 'runlith' },
  ]);
  expect(main.got).toEqual([
    { name: 't-a', title: 'Row heights' },
    { name: 'project:5', title: 'runlith' },
  ]);
  expect(side.got).toEqual([]);

  drops.follow([thread('t-a')], 'side');
  leaveSide();
  expect(drops.aimed).toBeNull();
  expect(drops.at(side.place.frame)).toBeNull();
});
