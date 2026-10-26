// @vitest-environment jsdom

import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DismissReason } from './layer.svelte.js';
import { overlayLayers } from './OverlayLayers.svelte.js';
import Probe from './test-utils/Probe.svelte';

const mounted: Record<string, unknown>[] = [];

afterEach(() => {
  for (const app of mounted.splice(0)) void unmount(app);
  flushSync();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function probe(
  name: string,
  props: { inner?: string; innerTraps?: boolean; declines?: readonly DismissReason[]; modal?: boolean; traps?: boolean } = {},
): void {
  const target = document.createElement('div');
  document.body.append(target);
  mounted.push(mount(Probe, { target, props: { name, ...props } }));
  flushSync();
}

const trigger = (name: string): HTMLElement => document.querySelector<HTMLElement>(`[data-trigger="${name}"]`)!;
const field = (name: string): HTMLInputElement => document.querySelector<HTMLInputElement>(`[data-field="${name}"]`)!;
const isOpen = (name: string): boolean => document.querySelector(`[data-layer="${name}"]`) !== null;

function open(name: string): void {
  trigger(name).click();
  flushSync();
}

function escape(target: EventTarget, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  flushSync();
  return event;
}

const frame = (): Promise<void> => new Promise((done) => requestAnimationFrame(() => done()));

const depth = (name: string): number => Number(document.querySelector<HTMLElement>(`[data-layer="${name}"]`)!.style.zIndex);

function press(target: Element, init: PointerEventInit = {}): void {
  target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'mouse', ...init }));
  flushSync();
}

describe('Escape belongs to the top open layer', () => {
  it('closes the top layer alone, and a window handler sees it taken', () => {
    probe('lower');
    probe('upper');
    open('lower');
    open('upper');
    let seen: boolean | undefined;
    const onWindow = (event: KeyboardEvent): void => void (seen = event.defaultPrevented);
    window.addEventListener('keydown', onWindow);

    escape(document.body);
    window.removeEventListener('keydown', onWindow);

    expect(isOpen('upper')).toBe(false);
    expect(isOpen('lower')).toBe(true);
    expect(seen).toBe(true);
  });

  it('leaves the layer open while composing or when an element inside took the key', () => {
    probe('menu');
    open('menu');
    escape(field('menu'), { isComposing: true });
    expect(isOpen('menu')).toBe(true);

    field('menu').addEventListener('keydown', (event) => event.preventDefault());
    escape(field('menu'));
    expect(isOpen('menu')).toBe(true);
  });

  it('holds Escape at a layer that declines it, so nothing below closes', () => {
    probe('lower');
    probe('upper', { declines: ['escape'] });
    open('lower');
    open('upper');

    const event = escape(document.body);

    expect(event.defaultPrevented).toBe(true);
    expect(isOpen('upper')).toBe(true);
    expect(isOpen('lower')).toBe(true);
  });
});

it('seats the layer opened last above every layer still open, however many came and went before it', () => {
  probe('a');
  probe('b');
  open('a');
  for (let cycle = 0; cycle < 60; cycle += 1) {
    open('b');
    expect(depth('b')).toBeGreaterThan(depth('a'));
    open('a');
    open('a');
    expect(depth('a')).toBeGreaterThan(depth('b'));
    open('b');
  }
});

describe('a press outside closes what it misses', () => {
  it('keeps the parent open for a press inside its child rendered elsewhere', () => {
    probe('menu', { inner: 'sub' });
    open('menu');
    open('sub');

    press(field('sub'));

    expect(isOpen('menu')).toBe(true);
    expect(isOpen('sub')).toBe(true);
  });

  it('closes a layer from a press on its own trigger, and from another trigger opens that one alone', () => {
    probe('a');
    probe('b');
    open('a');

    press(trigger('a'));
    expect(isOpen('a')).toBe(true);
    open('a');
    expect(isOpen('a')).toBe(false);

    open('a');
    press(trigger('b'));
    open('b');
    expect(isOpen('a')).toBe(false);
    expect(isOpen('b')).toBe(true);
  });

  it('closes on the tap of a touch, not on its pointerdown', () => {
    probe('menu');
    open('menu');

    press(document.body, { pointerType: 'touch' });
    expect(isOpen('menu')).toBe(true);

    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    flushSync();
    expect(isOpen('menu')).toBe(false);
  });
});

describe('focus after a layer closes', () => {
  it('goes back to the trigger when it was inside the layer', () => {
    probe('menu');
    trigger('menu').focus();
    open('menu');
    field('menu').focus();

    escape(field('menu'));

    expect(isOpen('menu')).toBe(false);
    expect(document.activeElement).toBe(trigger('menu'));
  });

  it('leaves a menu open under a modal that took the focus over it, and Escape takes the modal first', () => {
    probe('menu');
    probe('palette', { modal: true });
    open('menu');
    field('menu').focus();
    trigger('palette').click();
    flushSync();
    field('palette').focus();
    flushSync();
    expect(isOpen('menu')).toBe(true);

    escape(field('palette'));
    expect(isOpen('palette')).toBe(false);
    expect(isOpen('menu')).toBe(true);
  });

  it('stays where it went when it left the layer, and is not taken back after a press outside', () => {
    probe('menu');
    const elsewhere = document.createElement('input');
    document.body.append(elsewhere);
    open('menu');

    elsewhere.focus();
    flushSync();
    expect(isOpen('menu')).toBe(false);
    expect(document.activeElement).toBe(elsewhere);

    open('menu');
    field('menu').focus();
    press(document.body);
    expect(isOpen('menu')).toBe(false);
    expect(document.activeElement).not.toBe(trigger('menu'));
  });
});

describe('Tab belongs to the innermost layer that keeps it', () => {
  function tab(): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    (document.activeElement ?? document.body).dispatchEvent(event);
    flushSync();
    return event;
  }

  it('brings Tab from the last stop of a child that keeps none back into its parent’s circle', () => {
    probe('popover', { traps: true, inner: 'menu', innerTraps: false });
    open('popover');
    open('menu');
    field('menu').focus();

    expect(tab().defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(field('popover'));
  });

  it('keeps Tab inside a child that keeps its own, also within a modal dialog', () => {
    probe('dialog', { modal: true, inner: 'popover', innerTraps: true });
    open('dialog');
    open('popover');
    field('popover').focus();

    expect(tab().defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(field('popover'));
  });
});

describe('what the stack tells a host over the page', () => {
  it('reports the open layer and a shown notice, and drops both once they are gone', async () => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      if (this.matches('[data-layer]')) return new DOMRect(10, 20, 30, 40);
      if (this.matches('[data-notice]')) return new DOMRect(500, 0, 200, 60);
      return new DOMRect();
    });
    probe('menu');
    const notice = document.createElement('div');
    notice.setAttribute('data-notice', '');
    document.body.append(notice);

    open('menu');
    const detach = overlayLayers.notice(notice);
    await frame();
    expect(overlayLayers.rects).toEqual([
      { x: 10, y: 20, width: 30, height: 40 },
      { x: 500, y: 0, width: 200, height: 60 },
    ]);

    escape(document.body);
    if (typeof detach === 'function') detach();
    await frame();
    expect(overlayLayers.rects).toEqual([]);
  });

  it('signals the intent to open from the trigger press, before the layer is drawn', () => {
    probe('menu');
    const drawn: boolean[] = [];
    const stop = overlayLayers.onIntent(() => drawn.push(isOpen('menu')));

    press(trigger('menu'));
    open('menu');
    stop();

    expect(drawn).toEqual([false]);
    expect(isOpen('menu')).toBe(true);
  });
});
