// @vitest-environment jsdom
import { expect, test } from 'vitest';
import { type ListOptions, VirtualList } from './VirtualList';

type Fixture = {
  root: HTMLElement;
  span: HTMLElement;
  list: VirtualList;
  prepend(): void;
  close(): void;
};

function opened(): Fixture {
  const root = document.createElement('div');
  const span = document.createElement('div');
  root.append(span);
  document.body.append(root);
  Object.defineProperty(root, 'clientHeight', { value: 20 });
  Object.defineProperty(root, 'offsetHeight', { value: 20 });
  Object.defineProperty(root, 'scrollHeight', { get: () => Number.parseFloat(span.style.height) || 0 });
  root.scrollTo = (options?: ScrollToOptions | number, y?: number) => {
    const top = typeof options === 'number' ? (y ?? options) : (options?.top ?? root.scrollTop);
    root.scrollTop = Math.max(0, Math.min(top, root.scrollHeight - root.clientHeight));
  };
  const keys = Array.from({ length: 8 }, (_unused, index) => `row-${index}`);
  const options = (rows: readonly string[]): ListOptions => ({
    count: rows.length,
    getItemKey: (index) => rows[index]!,
    getScrollElement: () => root,
    estimateSize: () => 10,
    anchorTo: 'end',
    scrollEndThreshold: Number.NEGATIVE_INFINITY,
  });
  const list = new VirtualList(options(keys));
  list.span(span);
  list.connect();
  root.scrollTop = 40;
  root.dispatchEvent(new Event('scroll'));
  return {
    root,
    span,
    list,
    prepend: () => list.configure(options(['older', ...keys])),
    close: () => {
      list.dispose();
      root.remove();
    },
  };
}

test('measurement corrections include native movement not yet reported by a scroll event and remain idempotent', () => {
  const browser = opened();
  try {
    browser.root.scrollTop = 35;
    for (let index = 0; index < 2; index += 1) {
      const row = document.createElement('div');
      Object.defineProperty(row, 'offsetHeight', { value: 15 });
      browser.span.append(row);
      browser.list.measureRow(row, `row-${index}`);
      expect(browser.root.scrollTop).toBe(40 + index * 5);
    }
    browser.list.refresh();
    expect(browser.root.scrollTop).toBe(45);
  } finally {
    browser.close();
  }
});

test('native movement back to the previous observation survives the next measured correction', () => {
  const browser = opened();
  try {
    for (let index = 0; index < 2; index += 1) {
      const row = document.createElement('div');
      Object.defineProperty(row, 'offsetHeight', { value: 15 });
      browser.span.append(row);
      browser.list.measureRow(row, `row-${index}`);
      expect(browser.root.scrollTop).toBe(45);
      if (index === 0) browser.root.scrollTop = 40;
    }
    browser.list.refresh();
    expect(browser.root.scrollTop).toBe(45);
  } finally {
    browser.close();
  }
});

test('a prepend includes unreported native movement before its anchor is captured and before its commit', () => {
  const browser = opened();
  try {
    browser.root.scrollTop = 35;
    browser.prepend();
    browser.root.scrollTop = 30;
    browser.list.refresh();

    expect(browser.root.scrollTop).toBe(40);
    browser.list.refresh();
    expect(browser.root.scrollTop).toBe(40);
  } finally {
    browser.close();
  }
});
