// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, expect, test } from 'vitest';
import Picker from './Picker.fixture.svelte';

const mounted: Record<string, unknown>[] = [];

afterEach(async () => {
  for (const app of mounted.splice(0)) await unmount(app);
  document.body.replaceChildren();
});

function picker(labels: readonly string[], searchable = true) {
  const picked: string[] = [];
  const props = $state<{ labels: readonly string[]; searchable: boolean; value?: string; picked: (label: string) => void }>({
    labels,
    searchable,
    value: undefined,
    picked: (label) => void picked.push(label),
  });
  const target = document.createElement('div');
  document.body.append(target);
  mounted.push(mount(Picker, { target, props }));
  flushSync();
  return { props, picked };
}

const highlighted = (): string | undefined => document.querySelector<HTMLElement>('[data-highlighted]')?.dataset.item;

function press(key: string, target: Element = document.querySelector('[role="combobox"]')!): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  flushSync();
}

test('the list highlights its first item, arrows from the field move the highlight into the bound value, and Enter selects it', () => {
  const { props, picked } = picker(['alpha', 'beta', 'gamma']);
  expect(highlighted()).toBe('alpha');
  expect(props.value).toBe('alpha');

  press('ArrowDown');
  expect(highlighted()).toBe('beta');
  expect(props.value).toBe('beta');

  press('Enter', document.querySelector('[data-foreign]')!);
  expect(picked).toEqual([]);
  press('Enter');
  expect(picked).toEqual(['beta']);
});

test('the bound value always names the highlighted item, through an outside change, an emptied list and a refilled one', () => {
  const { props } = picker(['alpha', 'beta', 'gamma']);
  props.value = 'gamma';
  flushSync();
  expect(highlighted()).toBe('gamma');

  props.value = 'missing';
  flushSync();
  expect(props.value).toBe('gamma');

  props.labels = [];
  flushSync();
  expect(props.value).toBeUndefined();

  props.labels = ['delta', 'epsilon'];
  flushSync();
  expect(highlighted()).toBe('delta');
  expect(props.value).toBe('delta');
});

test('typing moves the highlight to the first item of the list the new query shows, even when the old one still stands', () => {
  const { props } = picker(['alpha', 'beta', 'gamma']);
  press('ArrowDown');
  expect(highlighted()).toBe('beta');
  props.labels = ['gamma', 'beta', 'alpha'];
  const field = document.querySelector<HTMLInputElement>('[role="combobox"]')!;
  field.value = 'g';
  field.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
  expect(highlighted()).toBe('gamma');
  expect(props.value).toBe('gamma');
});

test('a list without a search field takes the keys itself', () => {
  const { picked } = picker(['alpha', 'beta'], false);
  const list = document.querySelector('[role="listbox"]')!;

  press('ArrowDown', list);
  expect(highlighted()).toBe('beta');
  press('Enter', list);
  expect(picked).toEqual(['beta']);
});
