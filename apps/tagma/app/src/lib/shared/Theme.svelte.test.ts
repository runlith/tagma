// @vitest-environment jsdom
import { Scope } from '@runlith/layer/Scope';
import { makeStorage } from '@runlith/layer/testing';
import { afterEach, expect, test } from 'vitest';
import { Theme } from './Theme.svelte.js';

const root = document.documentElement;
const matchMedia = window.matchMedia;

afterEach(() => {
  root.classList.remove('dark');
  root.style.colorScheme = '';
  window.matchMedia = matchMedia;
});

test('the choice saved under the key app.html reads is kept, and a new choice is saved there and painted on the root', () => {
  const storage = makeStorage({ 'mode-watcher-mode': 'light' });
  const theme = new Theme(storage, Scope.make());

  expect(theme.choice).toBe('light');
  theme.paint();
  expect(root.classList.contains('dark')).toBe(false);
  expect(root.style.colorScheme).toBe('light');

  theme.choose('dark');
  theme.paint();
  expect(storage.getItem('mode-watcher-mode')).toBe('dark');
  expect(root.classList.contains('dark')).toBe(true);
  expect(root.style.colorScheme).toBe('dark');
});

test('system follows the screen’s scheme as it changes', () => {
  let light = true;
  window.matchMedia = ((media: string) => ({
    get matches() {
      return light;
    },
    media,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
  const theme = new Theme(makeStorage(), Scope.make());

  expect(theme.choice).toBe('system');
  expect(theme.mode).toBe('light');

  light = false;
  expect(theme.mode).toBe('dark');
});
