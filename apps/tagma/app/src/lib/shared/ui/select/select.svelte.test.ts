// @vitest-environment jsdom
import { Layer } from '@runlith/layer/Layer';
import { flushSync, mount, unmount } from 'svelte';
import { waitUntil } from '@runlith/testing/flush';
import { afterEach, expect, test } from 'vitest';
import { mountShell, type TestApp } from '$lib/app/testing.js';
import Fruit from './Fruit.fixture.svelte';

const mounted: Record<string, unknown>[] = [];
let app: TestApp | undefined;

afterEach(async () => {
  for (const view of mounted.splice(0)) await unmount(view);
  if (app) await app.unmount();
  app = undefined;
  document.body.replaceChildren();
});

function fruit(props: { fruits?: readonly string[]; value?: string } = {}): void {
  const target = document.createElement('div');
  document.body.append(target);
  mounted.push(mount(Fruit, { target, props }));
  flushSync();
}

const trigger = (): HTMLElement => document.querySelector<HTMLElement>('[data-trigger]')!;
const list = (): HTMLElement | null => document.querySelector<HTMLElement>('[role="listbox"]');
const option = (name: string): HTMLElement => document.querySelector<HTMLElement>(`[data-item="${name}"]`)!;
const highlighted = (): string | undefined => document.querySelector<HTMLElement>('[data-highlighted]')?.dataset.item;

function key(target: Element, name: string): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
  flushSync();
}

function press(): void {
  trigger().focus();
  trigger().dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }));
  trigger().click();
  flushSync();
}

test('choosing an option changes the value, closes the list and gives the focus back to the trigger', () => {
  fruit();
  press();
  option('cherry').click();
  flushSync();

  expect(trigger().textContent).toContain('cherry');
  expect(trigger().getAttribute('aria-expanded')).toBe('false');
  expect(document.activeElement).toBe(trigger());
});

test('opening highlights the chosen option', () => {
  fruit();
  press();

  expect(highlighted()).toBe('banana');
  expect(list()!.getAttribute('aria-activedescendant')).toBe(option('banana').id);
});

test('letters typed on the closed trigger change the value without opening the list', () => {
  fruit();
  trigger().focus();

  key(trigger(), 'a');
  expect(trigger().textContent).toContain('avocado');
  key(trigger(), 'a');
  expect(trigger().textContent).toContain('apple');
  expect(trigger().getAttribute('aria-expanded')).toBe('false');
  expect(list()).toBeNull();
});

test('letters typed on the closed trigger walk the options in their current order after one is inserted', () => {
  const props = $state({ fruits: ['apple', 'avocado'], value: 'apple' });
  fruit(props);
  props.fruits = ['apple', 'apricot', 'avocado'];
  flushSync();
  trigger().focus();

  key(trigger(), 'a');
  expect(trigger().textContent).toContain('apricot');
});

test('a select opened in a modal dialog takes the focus and the keys, and Escape or Tab closes the select alone', async () => {
  app = mountShell(Layer.mergeAll());
  app.draw(Fruit as never, { modal: true });
  const dialog = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-runlith-dialog-content][data-state="open"]');
  await waitUntil(() => dialog() !== null);

  trigger().focus();
  key(trigger(), 'ArrowDown');
  expect(document.activeElement).toBe(list());
  expect(list()!.getAttribute('aria-labelledby')).toBe(trigger().id);
  key(list()!, 'ArrowDown');
  expect(highlighted()).toBe('avocado');
  expect(option('banana').getAttribute('aria-selected')).toBe('true');
  expect(option('avocado').getAttribute('aria-selected')).toBe('false');
  key(list()!, 'Enter');
  expect(trigger().textContent).toContain('avocado');
  expect(document.activeElement).toBe(trigger());

  key(trigger(), 'Enter');
  key(list()!, 'Escape');
  expect(trigger().getAttribute('aria-expanded')).toBe('false');
  expect(dialog()).not.toBeNull();

  key(trigger(), 'Enter');
  key(list()!, 'Tab');
  expect(trigger().getAttribute('aria-expanded')).toBe('false');
  expect(dialog()).not.toBeNull();
});
