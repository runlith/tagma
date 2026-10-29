// @vitest-environment jsdom
import { Layer } from '@runlith/layer/Layer';
import { flushSync } from 'svelte';
import { afterEach, expect, test } from 'vitest';
import { GraphRung } from '$lib/features/workspace/GraphRung.js';
import { ReaderMarks } from '$lib/shared/reading/ReaderMarks.svelte.js';
import { ReadState } from './ReadState.svelte.js';
import { mountShell, type TestApp } from '$lib/app/testing.js';

let app: TestApp | undefined;

afterEach(async () => {
  if (app) await app.unmount();
  app = undefined;
});

function two(): { here: ReadState; there: ReadState; stored: (at: string) => unknown } {
  app = mountShell(Layer.mergeAll(ReaderMarks, ReadState), Layer.mergeAll(), {
    at: { projectId: 1, branch: 'main' },
  });
  const other = app.app.hold(GraphRung, { projectId: 2, branch: 'feature/one' });
  const storage = app.storage;
  return {
    here: app.app.resolve(ReadState),
    there: app.app.resolve(ReadState, other.scope),
    stored: (at) => JSON.parse(storage.getItem(at) ?? 'null') as unknown,
  };
}

test('a block marked read in one open graph leaves the marks of the other standing', () => {
  const { here, there, stored } = two();

  here.markRead('alpha', '2026-09-05T00:00:00Z');
  there.markRead('beta', '2026-09-05T01:00:00Z');

  expect(here.isUnread('alpha', '2026-09-05T00:00:00Z')).toBe(false);
  expect(there.isUnread('beta', '2026-09-05T01:00:00Z')).toBe(false);
  expect(there.isUnread('alpha', '2026-09-05T00:00:00Z')).toBe(true);
  expect(stored('tagma.readAt')).toEqual({
    'main\talpha': '2026-09-05T00:00:00Z',
    'feature/one\tbeta': '2026-09-05T01:00:00Z',
  });
});

test('two pages marking one block read at different stamps leave the later mark standing', () => {
  const { here } = two();

  const stop = $effect.root(() => {
    $effect(() => here.markRead('alpha', '2026-09-05T01:00:00Z'));
    $effect(() => here.markRead('alpha', '2026-09-05T00:00:00Z'));
  });
  flushSync();
  stop();

  expect(here.seenAt('alpha')).toBe('2026-09-05T01:00:00Z');
});

test('the visit trail of one open graph survives a visit in the other', () => {
  const { here, there, stored } = two();

  here.visited('alpha');
  there.visited('beta');
  here.visited('gamma');

  expect(here.trailOf).toEqual(['gamma', 'alpha']);
  expect(there.trailOf).toEqual(['beta']);
  expect(stored('tagma.visited')).toEqual({ '1': ['gamma', 'alpha'], '2': ['beta'] });
});
