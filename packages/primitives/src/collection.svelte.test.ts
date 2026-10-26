// @vitest-environment jsdom

import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';

import type { Highlighting } from './collection.svelte.js';
import Listing from './test-utils/Listing.svelte';

interface Entry {
  label: string;
  disabled?: boolean;
}

const mounted: Record<string, unknown>[] = [];

afterEach(() => {
  for (const app of mounted.splice(0)) void unmount(app);
  flushSync();
  document.body.replaceChildren();
});

function listing(highlighting: Highlighting, labels: readonly (string | Entry)[], loop = false) {
  const chosen: string[] = [];
  const props = $state({
    highlighting,
    loop,
    entries: labels.map((label) => (typeof label === 'string' ? { label } : label)),
    picked: (label: string) => void chosen.push(label),
  });
  const target = document.createElement('div');
  document.body.append(target);
  mounted.push(mount(Listing, { target, props }));
  flushSync();
  return { props, chosen };
}

const field = (): HTMLElement => document.querySelector<HTMLElement>('[data-field]')!;
const highlighted = (): string | undefined => document.querySelector<HTMLElement>('[data-highlighted]')?.dataset.item;

function press(key: string, target: Element = field()): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  flushSync();
}

describe('the collection walks its items in document order', () => {
  it('reads the order from the DOM after an item is inserted in the middle', () => {
    const { props } = listing('focus', ['a', 'c']);
    props.entries = [{ label: 'a' }, { label: 'b' }, { label: 'c' }];
    flushSync();
    press('ArrowDown');
    press('ArrowDown');
    expect(highlighted()).toBe('b');
    expect(document.activeElement).toBe(document.querySelector('[data-item="b"]'));
  });

  it('drops the highlight and keeps focus in the menu when the highlighted item leaves', () => {
    const { props } = listing('focus', ['a', 'b']);
    press('End');
    props.entries = [{ label: 'a' }];
    flushSync();
    expect(highlighted()).toBeUndefined();
    expect(document.activeElement).toBe(field());
  });

  it('skips a disabled item', () => {
    listing('focus', ['a', { label: 'b', disabled: true }, 'c']);
    press('ArrowDown');
    press('ArrowDown');
    expect(highlighted()).toBe('c');
  });

  it('wraps around in a looping menu and stops at the end of a list', () => {
    listing('focus', ['a', 'b'], true);
    press('End');
    press('ArrowDown');
    expect(highlighted()).toBe('a');
    void unmount(mounted.pop()!);
    flushSync();
    listing('descendant', ['a', 'b']);
    press('End');
    press('ArrowDown');
    expect(highlighted()).toBe('b');
  });
});

describe('typing finds an item by its text', () => {
  it('cycles through the items on a repeated letter', () => {
    listing('focus', ['apple', 'banana', 'avocado']);
    press('a');
    expect(highlighted()).toBe('apple');
    press('a');
    expect(highlighted()).toBe('avocado');
    press('a');
    expect(highlighted()).toBe('apple');
  });
});

describe('a list highlights through the field it keeps focus in', () => {
  it('points aria-activedescendant at the highlighted option', () => {
    listing('descendant', ['a', 'b']);
    press('ArrowDown');
    press('ArrowDown');
    const option = document.querySelector<HTMLElement>('[data-item="b"]')!;
    expect(field().getAttribute('aria-activedescendant')).toBe(option.id);
    expect(option.getAttribute('aria-selected')).toBe('true');
    expect(document.querySelector('[data-item="a"]')!.getAttribute('aria-selected')).toBe('false');
  });

  it('passes the highlight to the first item when the highlighted one leaves', async () => {
    const { props } = listing('descendant', ['a', 'b', 'c']);
    press('End');
    props.entries = [{ label: 'a' }, { label: 'b' }];
    flushSync();
    await Promise.resolve();
    expect(highlighted()).toBe('a');
  });
});

describe('the collection answers only keys aimed at its own field or items', () => {
  it('leaves Enter from another button inside the content alone', () => {
    const { chosen } = listing('focus', ['a', 'b']);
    press('ArrowDown');
    press('Enter', document.querySelector('[data-foreign]')!);
    expect(chosen).toEqual([]);
    press('Enter', document.querySelector('[data-item="a"]')!);
    expect(chosen).toEqual(['a']);
  });
});
