// @vitest-environment jsdom

import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import Tooltipped from './test-utils/Tooltipped.svelte';
import { tooltip } from './tooltip.svelte.js';

const DELAY = 400;

const mounted: Record<string, unknown>[] = [];

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  for (const app of mounted.splice(0)) void unmount(app);
  flushSync();
  document.body.replaceChildren();
  vi.useRealTimers();
});

function tooltipped(text: string, props: { layered?: boolean } = {}): HTMLElement {
  const target = document.createElement('div');
  document.body.append(target);
  mounted.push(mount(Tooltipped, { target, props: { text, ...props } }));
  flushSync();
  return target;
}

const button = (text: string): HTMLElement => document.querySelector<HTMLElement>(`[data-tooltipped="${text}"] button`)!;

function enter(element: Element): void {
  element.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }));
}

function leave(element: Element, to: Element | null = null): void {
  element.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, pointerType: 'mouse', relatedTarget: to }));
}

function hover(text: string): void {
  enter(button(text));
  vi.advanceTimersByTime(DELAY);
}

it('shows after its delay, and moving to the next trigger leaves no tooltip until that one waits out its own', () => {
  tooltipped('save');
  tooltipped('copy');

  enter(button('save'));
  vi.advanceTimersByTime(DELAY - 1);
  expect(tooltip.text).toBeUndefined();
  vi.advanceTimersByTime(1);
  expect(tooltip.text).toBe('save');

  leave(button('save'), button('copy'));
  enter(button('copy'));
  expect(tooltip.text).toBeUndefined();
  vi.advanceTimersByTime(DELAY);
  expect(tooltip.text).toBe('copy');
});

it('a trigger without words inside another leaves the outer tooltip waiting out its delay', () => {
  tooltipped('save');

  enter(button('save'));
  vi.advanceTimersByTime(DELAY / 2);
  enter(document.querySelector('[data-wordless="save"]')!);
  vi.advanceTimersByTime(DELAY / 2);

  expect(tooltip.text).toBe('save');
});

it('hides on a press anywhere or on Escape, and stays through any other key', () => {
  tooltipped('save');

  hover('save');
  document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }));
  expect(tooltip.text).toBeUndefined();

  leave(button('save'));
  hover('save');
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
  expect(tooltip.text).toBe('save');

  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(tooltip.text).toBeUndefined();
});

it('stays through a scroll elsewhere and hides when an ancestor of its trigger scrolls', () => {
  const container = tooltipped('save');
  const feed = document.createElement('div');
  document.body.append(feed);

  hover('save');
  feed.dispatchEvent(new Event('scroll'));
  expect(tooltip.text).toBe('save');

  container.dispatchEvent(new Event('scroll'));
  expect(tooltip.text).toBeUndefined();
});

it('does not show while a layer opened from its trigger is open', () => {
  tooltipped('menu', { layered: true });
  const trigger = document.querySelector<HTMLElement>('[data-trigger="menu"]')!;
  trigger.click();
  flushSync();

  enter(trigger);
  vi.advanceTimersByTime(DELAY);
  expect(tooltip.text).toBeUndefined();

  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  flushSync();
  leave(trigger);
  enter(trigger);
  vi.advanceTimersByTime(DELAY);
  expect(tooltip.text).toBe('menu');
});

it('does not show for a touch, even when the tap focuses a field inside its trigger', () => {
  tooltipped('name');
  const field = document.querySelector<HTMLInputElement>('[data-field="name"]')!;

  for (const type of ['pointerover', 'pointerdown', 'pointerup', 'pointerout'])
    field.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType: 'touch' }));
  field.focus();
  vi.advanceTimersByTime(DELAY);

  expect(tooltip.text).toBeUndefined();
});

it('a shown tooltip whose trigger a block removes goes with it, and the update goes on', () => {
  tooltipped('save');
  hover('save');

  document.querySelector<HTMLElement>('[data-remove="save"]')!.click();
  flushSync();

  expect(document.querySelector('[data-tooltipped="save"]')).toBeNull();
  expect(tooltip.text).toBeUndefined();
});

it('shows at once when the keyboard brings focus to its trigger', () => {
  tooltipped('save');

  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
  button('save').focus();

  expect(tooltip.text).toBe('save');
});
