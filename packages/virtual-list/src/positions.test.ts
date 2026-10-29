// @vitest-environment jsdom
import { expect, test } from 'vitest';
import { VirtualList } from './VirtualList';

test('a measured row moves every row after it without the list reading their keys or sizes again', async () => {
  const root = document.createElement('div');
  const span = document.createElement('div');
  root.append(span);
  document.body.append(root);
  Object.defineProperty(root, 'clientHeight', { value: 100 });
  Object.defineProperty(root, 'offsetHeight', { value: 100 });
  Object.defineProperty(root, 'scrollHeight', { get: () => Number.parseFloat(span.style.height) || 0 });
  root.scrollTo = (options?: ScrollToOptions | number, y?: number) => {
    const top = typeof options === 'number' ? (y ?? options) : (options?.top ?? root.scrollTop);
    root.scrollTop = Math.max(0, Math.min(top, root.scrollHeight - root.clientHeight));
  };
  const reads: number[] = [];
  const list = new VirtualList({
    count: 1000,
    getScrollElement: () => root,
    getItemKey: (index) => {
      reads.push(index);
      return `row-${index}`;
    },
    estimateSize: () => 10,
    indexOf: (key) => Number(String(key).slice('row-'.length)),
  });
  try {
    list.span(span);
    list.connect();
    root.scrollTop = 0;
    root.dispatchEvent(new Event('scroll'));
    reads.length = 0;
    for (const [index, height] of [
      [3, 25],
      [6, 4],
    ] as const) {
      const node = document.createElement('div');
      Object.defineProperty(node, 'offsetHeight', { value: height });
      span.append(node);
      list.mountRow(node, `row-${index}`);
    }
    await Promise.resolve();

    expect(list.measurementsCache[5]?.start).toBe(65);
    expect(list.measurementsCache[7]?.start).toBe(79);
    expect(list.measurementsCache[999]?.start).toBe(9999);
    expect(span.style.height).toBe('10009px');
    expect(reads.filter((index) => index > 20)).toEqual([]);
  } finally {
    list.dispose();
    root.remove();
  }
});
