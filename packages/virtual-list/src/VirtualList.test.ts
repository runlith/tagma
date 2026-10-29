// @vitest-environment jsdom
import { afterEach, expect, test } from 'vitest';
import { VirtualList } from './VirtualList';

let list: VirtualList | undefined;
let root: HTMLElement | undefined;

afterEach(() => {
  list?.dispose();
  root?.remove();
  list = undefined;
  root = undefined;
});

test('a mount measured at its estimate stays measured after re-estimation, and geometry changes synchronously with its next measure', async () => {
  root = document.createElement('div');
  const span = document.createElement('div');
  const first = document.createElement('div');
  const next = document.createElement('div');
  span.append(first, next);
  root.append(span);
  document.body.append(root);
  Object.defineProperty(root, 'clientHeight', { value: 100 });
  Object.defineProperty(root, 'offsetHeight', { value: 100 });
  Object.defineProperty(root, 'scrollHeight', { get: () => Number.parseFloat(span.style.height) || 0 });
  root.scrollTo = () => undefined;
  let height = 30;
  Object.defineProperty(first, 'offsetHeight', { get: () => height });
  const element = root;
  const options = (estimate: number) => ({
    count: 2,
    getScrollElement: () => element,
    estimateSize: () => estimate,
    getItemKey: (index: number) => ['first', 'next'][index] ?? index,
  });
  list = new VirtualList(options(30));
  list.span(span);
  list.connect();
  list.box('first', first);
  list.box('next', next);
  list.mountRow(first, 'first');
  await Promise.resolve();

  list.configure(options(90));
  list.refresh();
  list.invalidateSizes();

  expect(list.getVirtualItems().map((item) => item.size)).toEqual([30, 90]);
  expect(span.style.height).toBe('120px');
  expect(next.style.top).toBe('30px');

  height = 45;
  list.measureRow(first);

  expect(span.style.height).toBe('135px');
  expect(next.style.top).toBe('45px');
});
