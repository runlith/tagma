// @vitest-environment jsdom

import { Layer } from '@runlith/layer/Layer';
import { afterEach, expect, test } from 'vitest';

import { mountShell, type TestApp } from '$lib/app/testing.js';
import { ContextPanelState } from './PanelState.svelte.js';

let app: TestApp | undefined;

afterEach(async () => {
  if (app) await app.unmount();
  app = undefined;
});

test('a row the reader opened stays open, and several stand open at once', () => {
  app = mountShell(Layer.mergeAll(ContextPanelState), Layer.mergeAll(), { thread: { id: 'thread-1' } });
  const state = app.app.resolve(ContextPanelState);

  state.toggle('tools');
  expect(state.isOpen('tools')).toBe(true);
  expect(state.isOpen('conversation')).toBe(false);

  state.toggle('conversation');
  expect(state.isOpen('tools')).toBe(true);
  expect(state.isOpen('conversation')).toBe(true);

  state.toggle('tools');
  expect(state.isOpen('tools')).toBe(false);
});

test('another thread on screen is another instance, and it opens closed', async () => {
  app = mountShell(Layer.mergeAll(ContextPanelState), Layer.mergeAll(), { thread: { id: 'thread-1' } });
  const first = app.app.resolve(ContextPanelState);
  first.toggle('tools');

  app.open({ id: 'thread-2' });
  await app.app.adopt();

  const second = app.app.resolve(ContextPanelState);
  expect(second).not.toBe(first);
  expect(second.isOpen('tools')).toBe(false);
});
