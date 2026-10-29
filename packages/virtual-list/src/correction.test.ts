// @vitest-environment jsdom
import { expect, test } from 'vitest';
import { VirtualList } from './VirtualList';

test('a scrollbar press holds a measured correction until release without changing the native range', () => {
  const root = document.createElement('div');
  const span = document.createElement('div');
  const row = document.createElement('div');
  span.append(row);
  root.append(span);
  document.body.append(root);
  Object.defineProperty(root, 'clientHeight', { value: 20 });
  Object.defineProperty(root, 'offsetHeight', { value: 20 });
  Object.defineProperty(root, 'scrollHeight', { get: () => Number.parseFloat(span.style.height) || 0 });
  Object.defineProperty(row, 'offsetHeight', { value: 15 });
  root.scrollTo = (options?: ScrollToOptions | number, y?: number) => {
    const top = typeof options === 'number' ? (y ?? options) : (options?.top ?? root.scrollTop);
    root.scrollTop = Math.max(0, Math.min(top, root.scrollHeight - root.clientHeight));
  };
  let pressed = false;
  const list = new VirtualList({
    count: 4,
    getScrollElement: () => root,
    estimateSize: () => 10,
    isScrollWriteBlocked: () => pressed,
  });
  try {
    list.span(span);
    list.connect();
    root.scrollTop = 20;
    root.dispatchEvent(new Event('scroll'));
    pressed = true;
    list.measureRow(row, 0);

    expect(root.scrollTop).toBe(20);
    expect(span.style.height).toBe('40px');
    expect(list.getVirtualItems().find((item) => item.key === 2)?.start).toBe(20);

    root.scrollTop = 15;
    root.dispatchEvent(new Event('scroll'));
    pressed = false;
    list.refresh();

    expect(root.scrollTop).toBe(20);
    expect(span.style.height).toBe('45px');
    expect(list.getVirtualItems().find((item) => item.key === 2)?.start).toBe(25);
  } finally {
    list.dispose();
    root.remove();
  }
});

test('a batch of corrections within the laid scroll range rebuilds measurements only once', async () => {
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
  let builds = 0;
  const list = new VirtualList({
    count: 8,
    anchorTo: 'end',
    scrollEndThreshold: Number.NEGATIVE_INFINITY,
    getScrollElement: () => root,
    getItemKey: (index) => `row-${index}`,
    estimateSize: () => 10,
  });
  let laid = list.measurementsCache;
  Object.defineProperty(list, 'measurementsCache', {
    configurable: true,
    get: () => laid,
    set: (next: typeof laid) => {
      builds += 1;
      laid = next;
    },
  });
  try {
    list.span(span);
    list.connect();
    root.scrollTop = 40;
    root.dispatchEvent(new Event('scroll'));
    builds = 0;
    for (let index = 0; index < 3; index += 1) {
      const node = document.createElement('div');
      Object.defineProperty(node, 'offsetHeight', { value: 11 });
      span.append(node);
      list.mountRow(node, `row-${index}`);
    }
    await Promise.resolve();

    expect(root.scrollTop).toBe(43);
    expect(span.style.height).toBe('83px');
    expect(builds).toBe(1);
  } finally {
    list.dispose();
    root.remove();
  }
});
