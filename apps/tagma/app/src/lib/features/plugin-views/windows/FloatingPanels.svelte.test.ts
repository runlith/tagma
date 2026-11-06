import { expect, test } from 'vitest';
import { FloatingPanels } from './FloatingPanels.svelte.js';
import type { WindowAddress } from './ViewWindows.js';

const doom: WindowAddress = { projectId: 1, project: 'tagma', plugin: 'doom', view: 'game', title: 'Doom' };
const notes: WindowAddress = { projectId: 1, project: 'tagma', plugin: 'notes', view: 'pad', title: 'Notes' };

test('opening a view again keeps its panel in place and raises it above the others', () => {
  const floating = new FloatingPanels();
  floating.open(doom);
  floating.open(notes);
  floating.open(doom);
  expect(floating.panels.map((panel) => panel.address.plugin)).toEqual(['doom', 'notes']);
  const [first, second] = floating.panels;
  expect(first!.raised).toBeGreaterThan(second!.raised);
});

test('closing a panel removes only that view', () => {
  const floating = new FloatingPanels();
  floating.open(doom);
  floating.open(notes);
  floating.close(doom);
  expect(floating.panels.map((panel) => panel.address.plugin)).toEqual(['notes']);
});

test('raising a panel that is already on top changes nothing, and any other becomes the top', () => {
  const floating = new FloatingPanels();
  floating.open(doom);
  floating.open(notes);
  const before = floating.panels;
  floating.raise(notes);
  expect(floating.panels).toBe(before);
  floating.raise(doom);
  const [first, second] = floating.panels;
  expect(first!.raised).toBeGreaterThan(second!.raised);
});
