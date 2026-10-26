// @vitest-environment jsdom
import { waitUntil } from '@runlith/testing/flush';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, expect, test, vi } from 'vitest';
import Picker from './Picker.fixture.svelte';

const mounted: Record<string, unknown>[] = [];

afterEach(async () => {
  for (const app of mounted.splice(0)) await unmount(app);
  document.body.replaceChildren();
});

function picker(props: { trapFocus?: boolean; hover?: { openMs: number; closeMs: number } } = {}): void {
  const target = document.createElement('div');
  document.body.append(target);
  mounted.push(mount(Picker, { target, props }));
  flushSync();
}

const part = (name: string): HTMLElement => document.querySelector<HTMLElement>(`[data-${name}]`)!;
const expanded = (): string | null => part('trigger').getAttribute('aria-expanded');
const content = (): Element | null => document.querySelector('[data-slot="popover-content"]');

function press(): void {
  part('trigger').focus();
  part('trigger').click();
  flushSync();
}

function pointer(element: Element | null, type: 'pointerenter' | 'pointerleave', ms = 0): void {
  element?.dispatchEvent(new PointerEvent(type, { pointerType: 'mouse' }));
  vi.advanceTimersByTime(ms);
  flushSync();
}

function key(target: Element, name: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  flushSync();
  return event;
}

test('the trigger opens and closes the popover, and Escape or a press outside closes it', async () => {
  picker();
  press();
  expect(expanded()).toBe('true');
  expect(content()).not.toBeNull();
  press();
  expect(expanded()).toBe('false');

  press();
  key(part('field'), 'Escape');
  expect(expanded()).toBe('false');
  await waitUntil(() => content() === null);

  press();
  part('outside').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }));
  flushSync();
  expect(expanded()).toBe('false');
});

test('every opening gives the keyboard to the first field, and closing gives it back to the trigger', () => {
  picker();
  press();
  expect(document.activeElement).toBe(part('field'));

  key(part('field'), 'Escape');
  expect(document.activeElement).toBe(part('trigger'));

  press();
  expect(document.activeElement).toBe(part('field'));
});

test('a resting pointer opens the popover without taking the keyboard, a passing one does not, and leaving closes it after a pause unless a click kept it', () => {
  vi.useFakeTimers();
  try {
    picker({ hover: { openMs: 180, closeMs: 300 } });
    part('outside').focus();

    pointer(part('trigger'), 'pointerenter', 100);
    expect(expanded()).toBe('false');
    pointer(part('trigger'), 'pointerleave', 300);
    expect(expanded()).toBe('false');

    pointer(part('trigger'), 'pointerenter', 180);
    expect(expanded()).toBe('true');
    expect(document.activeElement).toBe(part('outside'));

    pointer(part('trigger'), 'pointerleave', 200);
    pointer(content(), 'pointerenter', 300);
    expect(expanded()).toBe('true');
    pointer(content(), 'pointerleave', 300);
    expect(expanded()).toBe('false');

    pointer(part('trigger'), 'pointerenter', 180);
    part('trigger').click();
    pointer(part('trigger'), 'pointerleave', 300);
    expect(expanded()).toBe('true');
  } finally {
    vi.useRealTimers();
  }
});

test('a hover opening held from inside takes the keyboard, and it and an opening that is not a hover stay open when the pointer leaves', () => {
  vi.useFakeTimers();
  try {
    picker({ hover: { openMs: 180, closeMs: 300 } });

    part('outside').focus();
    pointer(part('trigger'), 'pointerenter', 180);
    part('hold').click();
    flushSync();
    expect(document.activeElement).toBe(part('field'));
    pointer(part('trigger'), 'pointerleave', 300);
    expect(expanded()).toBe('true');
    key(part('hold'), 'Escape');
    expect(expanded()).toBe('false');

    pointer(part('trigger'), 'pointerenter', 180);
    pointer(part('trigger'), 'pointerleave', 300);
    expect(expanded()).toBe('false');
    part('reveal').click();
    flushSync();
    pointer(content(), 'pointerenter');
    pointer(content(), 'pointerleave', 300);
    expect(expanded()).toBe('true');
  } finally {
    vi.useRealTimers();
  }
});

test('Tab circles inside the popover, and leaves it once trapFocus is off', async () => {
  picker();
  press();
  part('last').focus();
  expect(key(part('last'), 'Tab').defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(part('first'));

  for (const app of mounted.splice(0)) await unmount(app);
  document.body.replaceChildren();
  picker({ trapFocus: false });
  press();
  part('last').focus();
  expect(key(part('last'), 'Tab').defaultPrevented).toBe(false);
});
