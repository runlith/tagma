// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, expect, test, vi } from 'vitest';
import TerminalSearch, { safeFind, searchQueryTooLarge } from './Search.svelte';

const SIX = {
  matchBackground: '#5c4a00',
  matchBorder: '#5c4a00',
  matchOverviewRuler: '#ffcc00',
  activeMatchBackground: '#c4580e',
  activeMatchBorder: '#ffcf6b',
  activeMatchColorOverviewRuler: '#ff9900',
};

function addonOver() {
  return {
    findNext: vi.fn((_term: string, _options?: unknown) => true),
    findPrevious: vi.fn((_term: string, _options?: unknown) => true),
    clearDecorations: vi.fn(),
  };
}

type Addon = ReturnType<typeof addonOver>;

let apps: (() => void)[] = [];

afterEach(() => {
  for (const unmountApp of apps.splice(0)) unmountApp();
  document.body.replaceChildren();
});

function draw(addon: Addon, onClose: () => void = () => undefined, onProblem?: (problem: string) => void) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const app = mount(TerminalSearch, { target: host, props: { search: addon, open: true, onClose, isMac: false, onProblem } });
  flushSync();
  apps.push(() => {
    unmount(app);
    host.remove();
  });
  return host;
}

function inputOf(host: HTMLElement): HTMLInputElement {
  const input = host.querySelector<HTMLInputElement>('[data-search-input]');
  if (!input) throw new Error('No search input drawn.');
  return input;
}

function type(host: HTMLElement, text: string): void {
  const input = inputOf(host);
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

test('typing finds and selects the first match, incrementally', () => {
  const addon = addonOver();
  const host = draw(addon);

  type(host, 'error');

  expect(addon.findNext).toHaveBeenCalledWith('error', {
    caseSensitive: false,
    regex: false,
    incremental: true,
    decorations: SIX,
  });
});

test('Enter and Shift+Enter move next and previous, non-incrementally', () => {
  const addon = addonOver();
  const host = draw(addon);
  type(host, 'error');
  addon.findNext.mockClear();

  inputOf(host).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  flushSync();
  expect(addon.findNext).toHaveBeenCalledWith('error', expect.objectContaining({ incremental: false }));

  inputOf(host).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }));
  flushSync();
  expect(addon.findPrevious).toHaveBeenCalledWith('error', expect.objectContaining({ incremental: false }));
});

test('close leaves no decoration and no active match', () => {
  const addon = addonOver();
  const onClose = vi.fn();
  const host = draw(addon, onClose);
  type(host, 'error');

  host.querySelector<HTMLElement>('[data-close]')?.click();
  flushSync();

  expect(onClose).toHaveBeenCalledTimes(1);
  expect(addon.clearDecorations).toHaveBeenCalled();
  expect(addon.findNext).toHaveBeenCalledWith('', expect.anything());
});

test('Escape closes and clears', () => {
  const addon = addonOver();
  const onClose = vi.fn();
  const host = draw(addon, onClose);
  type(host, 'error');

  inputOf(host).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  flushSync();

  expect(onClose).toHaveBeenCalledTimes(1);
  expect(addon.clearDecorations).toHaveBeenCalled();
});

test('a query past 2 KiB never runs', () => {
  const addon = addonOver();
  const host = draw(addon);

  type(host, `${'x'.repeat(3000)}`);

  expect(addon.findNext.mock.calls.every(([term]) => term !== `${'x'.repeat(3000)}`)).toBe(true);
  expect(addon.clearDecorations).toHaveBeenCalled();
});

test('a throwing findNext leaves the bar mounted and typable', () => {
  const addon = addonOver();
  addon.findNext.mockImplementation(() => {
    throw new Error('This API only accepts positive integers');
  });
  const host = draw(addon);

  type(host, 'error');
  expect(host.querySelector('[data-search-root]')).not.toBeNull();
  expect(inputOf(host).value).toBe('error');

  type(host, 'errors');
  expect(inputOf(host).value).toBe('errors');
});

test('an unknown throw reads as no match and is reported once per wording', () => {
  const problems: string[] = [];
  const report = (problem: string): void => {
    problems.push(problem);
  };
  const broken = (): boolean => {
    throw new Error('a wording no matcher in this file knows');
  };
  expect(safeFind(broken, 'error', {}, report)).toBe(false);
  expect(safeFind(broken, 'error', {}, report)).toBe(false);
  expect(problems).toHaveLength(1);
  expect(
    safeFind(
      () => {
        throw new Error('This API only accepts positive integers');
      },
      'error',
      {},
      report,
    ),
  ).toBe(false);
  expect(problems).toHaveLength(2);
});

test('a throwing find reports through the problem road and keeps the bar typable', () => {
  const addon = addonOver();
  addon.findNext.mockImplementation(() => {
    throw new Error('the viewport narrowed under a match in a way no test here names');
  });
  const problems: string[] = [];
  const host = draw(
    addon,
    () => undefined,
    (problem: string) => problems.push(problem),
  );

  type(host, 'error');

  expect(problems).toHaveLength(1);
  expect(host.querySelector('[data-search-root]')).not.toBeNull();
  expect(inputOf(host).value).toBe('error');
});

test('oversized queries refuse on bytes, not characters', () => {
  expect(searchQueryTooLarge('x'.repeat(3000))).toBe(true);
  expect(searchQueryTooLarge('é'.repeat(1500))).toBe(true);
  expect(searchQueryTooLarge('error')).toBe(false);
});

test('Ctrl+G moves next and previous while open', () => {
  const addon = addonOver();
  const host = draw(addon);
  type(host, 'error');
  addon.findNext.mockClear();
  addon.findPrevious.mockClear();

  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', ctrlKey: true, bubbles: true }));
  flushSync();
  expect(addon.findNext).toHaveBeenCalledWith('error', expect.objectContaining({ incremental: false }));

  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', ctrlKey: true, shiftKey: true, bubbles: true }));
  flushSync();
  expect(addon.findPrevious).toHaveBeenCalledWith('error', expect.objectContaining({ incremental: false }));
});

test('the toggles flip case and regex for the next find', () => {
  const addon = addonOver();
  const host = draw(addon);
  type(host, 'Error');

  host.querySelector<HTMLElement>('[data-case-toggle]')?.click();
  flushSync();
  expect(addon.findNext).toHaveBeenLastCalledWith('Error', expect.objectContaining({ caseSensitive: true }));

  host.querySelector<HTMLElement>('[data-regex-toggle]')?.click();
  flushSync();
  expect(addon.findNext).toHaveBeenLastCalledWith('Error', expect.objectContaining({ regex: true }));
});

test('the bar clears its verdict on a match, and a query past the bound says so', () => {
  const addon = addonOver();
  addon.findNext.mockReturnValue(false);
  const host = draw(addon);

  type(host, 'nothing here');

  addon.findNext.mockReturnValue(true);
  type(host, 'error');
  expect(host.querySelector('[data-search-verdict]')).toBe(null);

  const long = 'x'.repeat(2 * 1024 + 1);
  type(host, long);
  expect(addon.findNext).not.toHaveBeenCalledWith(long, expect.anything());
  expect(host.querySelector('[data-search-verdict]')?.textContent).toBe('Query too long');
});
