// @vitest-environment jsdom
import { waitUntil } from '@runlith/testing/flush';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, expect, test, vi } from 'vitest';
import Menu from './Menu.fixture.svelte';

const mounted: Record<string, unknown>[] = [];

afterEach(async () => {
  for (const app of mounted.splice(0)) await unmount(app);
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function menu(filter = false) {
  const picked: string[] = [];
  const props = $state<{ picked: (name: string) => void; aside: string | null; filter: boolean }>({
    picked: (name) => void picked.push(name),
    aside: null,
    filter,
  });
  const target = document.createElement('div');
  document.body.append(target);
  mounted.push(mount(Menu, { target, props }));
  flushSync();
  return { picked, props };
}

const trigger = (): HTMLElement => document.querySelector<HTMLElement>('[data-trigger]')!;
const isOpen = (): boolean => trigger().getAttribute('aria-expanded') === 'true';
const item = (label: string): HTMLElement =>
  [...document.querySelectorAll<HTMLElement>('[role^="menuitem"]')].findLast((node) => node.textContent?.trim() === label)!;
const sub = (): HTMLElement => item('More');
const state = (): DOMStringMap => document.querySelector<HTMLElement>('output')!.dataset;

function key(name: string, target: Element = document.activeElement ?? document.body): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
  flushSync();
}

function pointer(type: string, target: Element, init: PointerEventInit = {}): void {
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerType: 'mouse', ...init }));
  flushSync();
}

function click(target: Element): void {
  target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
  flushSync();
}

function open(): void {
  trigger().focus();
  trigger().click();
  flushSync();
}

test('Enter and a click choose an item and close the menu, focus goes back to the trigger, and closeOnSelect={false} keeps it open', () => {
  const { picked } = menu();
  open();
  click(item('Stay'));
  expect(isOpen()).toBe(true);
  click(item('Alpha'));
  expect(isOpen()).toBe(false);
  expect(document.activeElement).toBe(trigger());

  open();
  item('Omega').focus();
  key('Enter');
  expect(picked).toEqual(['stay', 'alpha', 'omega']);
  expect(isOpen()).toBe(false);
  expect(document.activeElement).toBe(trigger());
});

test('a checkbox item toggles its value and a radio item takes the group value', () => {
  menu();
  open();
  click(item('Wrap'));
  open();
  click(item('Bold'));
  expect(state()).toMatchObject({ checked: 'true', tone: 'bold' });
});

test('ArrowDown on the trigger opens the menu on its first item, typing finds an item and ArrowUp wraps', async () => {
  menu();
  trigger().focus();
  key('ArrowDown', trigger());
  await waitUntil(() => document.activeElement === item('Alpha'));
  expect(document.querySelector('[role="menu"]')?.getAttribute('aria-labelledby')).toBe(trigger().id);
  const group = document.querySelector('[data-group]')!;
  expect(document.getElementById(group.getAttribute('aria-labelledby') ?? '')?.textContent?.trim()).toBe('Format');
  key('o');
  expect(document.activeElement).toBe(item('Omega'));
  key('Home');
  key('ArrowUp');
  expect(document.activeElement).toBe(item('Omega'));
});

test('a menu with a filter field opens on it, ArrowDown leaves it for the first item and a typed letter comes back to it', async () => {
  menu(true);
  trigger().focus();
  key('ArrowDown', trigger());
  const field = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-filter]');
  await waitUntil(() => field() !== null && document.activeElement === field());
  key('ArrowDown');
  expect(document.activeElement).toBe(item('Alpha'));
  key('o');
  expect(document.activeElement).toBe(field());
});

test('ArrowRight opens a submenu on its first item, ArrowLeft and Escape close only the submenu', async () => {
  menu();
  trigger().focus();
  key('ArrowDown', trigger());
  await waitUntil(() => document.activeElement === item('Alpha'));
  key('m');
  key('ArrowRight');
  await waitUntil(() => document.activeElement === item('Deep'));
  key('ArrowLeft');
  expect(sub().getAttribute('aria-expanded')).toBe('false');
  expect(document.activeElement).toBe(sub());

  key('ArrowRight');
  await waitUntil(() => document.activeElement === item('Deep'));
  key('Escape');
  expect(sub().getAttribute('aria-expanded')).toBe('false');
  expect(isOpen()).toBe(true);
});

test('a pointer moving on the path to a tall submenu keeps it, and one resting on the row above hands the pointer to it', () => {
  menu();
  open();
  pointer('pointermove', sub(), { clientX: 100, clientY: 50 });
  expect(sub().getAttribute('aria-expanded')).toBe('true');
  vi.spyOn(document.querySelector<HTMLElement>('[data-sub]')!, 'getBoundingClientRect').mockReturnValue(new DOMRect(200, -800, 100, 1000));
  vi.useFakeTimers();
  try {
    pointer('pointerleave', sub(), { clientX: 150, clientY: 50, bubbles: false });
    pointer('pointermove', item('Spacing'), { clientX: 152, clientY: 45 });
    vi.advanceTimersByTime(100);
    pointer('pointermove', item('Spacing'), { clientX: 154, clientY: 40 });
    vi.advanceTimersByTime(100);
    flushSync();
    expect(sub().getAttribute('aria-expanded')).toBe('true');
    expect(item('Spacing').hasAttribute('data-highlighted')).toBe(false);

    vi.advanceTimersByTime(100);
    flushSync();
    expect(item('Spacing').hasAttribute('data-highlighted')).toBe(true);
    expect(item('Spacing').getAttribute('aria-expanded')).toBe('true');
    expect(sub().getAttribute('aria-expanded')).toBe('false');
  } finally {
    vi.useRealTimers();
  }
});

test('a pointer crossing to a far submenu keeps it through steps that do not advance toward it and off its path over no row', () => {
  menu();
  open();
  pointer('pointermove', sub(), { clientX: 100, clientY: 50 });
  vi.spyOn(document.querySelector<HTMLElement>('[data-sub]')!, 'getBoundingClientRect').mockReturnValue(new DOMRect(200, 0, 100, 200));
  pointer('pointerleave', sub(), { clientX: 150, clientY: 50, bubbles: false });
  pointer('pointermove', item('Omega'), { clientX: 160, clientY: 55 });
  pointer('pointermove', item('Omega'), { clientX: 160, clientY: 60 });
  pointer('pointermove', item('Omega'), { clientX: 159, clientY: 66 });
  expect(sub().getAttribute('aria-expanded')).toBe('true');
  expect(item('Omega').hasAttribute('data-highlighted')).toBe(false);
  pointer('pointermove', document.body, { clientX: 150, clientY: 190 });
  expect(sub().getAttribute('aria-expanded')).toBe('true');
  pointer('pointermove', document.querySelector<HTMLElement>('[data-sub]')!, { clientX: 210, clientY: 70 });
  expect(sub().getAttribute('aria-expanded')).toBe('true');
});

test('a pointer leaving the submenu trigger out of the triangle highlights the item it moves onto at once', () => {
  menu();
  open();
  pointer('pointermove', sub(), { clientX: 100, clientY: 50 });
  vi.spyOn(document.querySelector<HTMLElement>('[data-sub]')!, 'getBoundingClientRect').mockReturnValue(new DOMRect(200, -800, 100, 1000));
  pointer('pointerleave', sub(), { clientX: 150, clientY: 50, bubbles: false });
  pointer('pointermove', item('Omega'), { clientX: 150, clientY: 100 });
  flushSync();
  expect(item('Omega').hasAttribute('data-highlighted')).toBe(true);
  expect(sub().getAttribute('aria-expanded')).toBe('false');
});

test('a press dragged from the trigger chooses the item it is released on, and a menu opened elsewhere does not', () => {
  const { picked, props } = menu();
  pointer('pointerdown', trigger(), { button: 0 });
  expect(isOpen()).toBe(true);
  pointer('pointerup', trigger(), { button: 0 });
  expect(isOpen()).toBe(true);
  pointer('pointerup', item('Alpha'), { button: 0 });
  expect(picked).toEqual([]);

  pointer('pointerdown', trigger(), { button: 0 });
  expect(isOpen()).toBe(false);
  pointer('pointerdown', trigger(), { button: 0 });
  pointer('pointerup', item('Alpha'), { button: 0 });
  expect(picked).toEqual(['alpha']);

  props.aside = 'row';
  flushSync();
  pointer('pointerup', item('Aside'), { button: 2 });
  pointer('pointerup', item('Aside'), { button: 0 });
  expect(picked).toEqual(['alpha']);
  expect(props.aside).toBe('row');
});

test('a menu opened at the cursor over a field that swallows keys takes the keyboard once it is visible', async () => {
  const focus = HTMLElement.prototype.focus;
  vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (this: HTMLElement, options?: FocusOptions) {
    if (getComputedStyle(this).visibility !== 'hidden') focus.call(this, options);
  });
  const { props } = menu();
  const engine = document.createElement('textarea');
  engine.addEventListener('keydown', (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  document.body.append(engine);
  engine.focus();

  props.aside = 'row';
  flushSync();
  await waitUntil(() => document.activeElement?.closest('[role="menu"]') != null);
  key('ArrowDown');
  expect(document.activeElement).toBe(item('Aside'));
  key('Escape');
  expect(props.aside).toBeNull();
});

test('a menu whose target its closing clears still hands that target to the chosen item', () => {
  const { picked, props } = menu();
  props.aside = 'row';
  flushSync();
  click(item('Aside'));
  expect(picked).toEqual(['row']);
  expect(props.aside).toBeNull();
});
