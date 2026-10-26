// @vitest-environment jsdom

import { afterEach, expect, test } from 'vitest';
import { type Beyond, Reorder } from './Reorder.svelte.js';

const ROW = 50;
const HEIGHT = 40;
let cleanup: (() => void) | null = null;

afterEach(() => {
  cleanup?.();
  cleanup = null;
});

function column(ids: readonly string[], beyond: Beyond<string>) {
  const moves: [string, string | null][] = [];
  const reorder = new Reorder(
    () => ids,
    (id, before) => moves.push([id, before]),
    'y',
    beyond,
  );
  const list = document.createElement('div');
  list.setPointerCapture = () => undefined;
  list.getBoundingClientRect = () => ({ left: 0, right: 40, top: 0, bottom: 200, width: 40, height: 200, x: 0, y: 0, toJSON: () => null });
  for (const id of ids) {
    const item = document.createElement('div');
    item.dataset.reorderItem = id;
    item.dataset.reorderHandle = id;
    Object.defineProperty(item, 'offsetTop', { get: () => reorder.arranged(ids, (one) => one).indexOf(id) * ROW });
    Object.defineProperty(item, 'offsetHeight', { get: () => HEIGHT });
    list.append(item);
  }
  document.body.append(list);
  const detach = reorder.attach(list);
  cleanup = () => {
    detach();
    list.remove();
  };
  const item = (id: string) => list.querySelector<HTMLElement>(`[data-reorder-item="${id}"]`)!;
  return { moves, item };
}

const point = (type: string, x: number, y: number, target: EventTarget = window): void => {
  target.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true }));
};

test('an item carried straight across the list leaves it for what lies beyond, and its release goes there instead of a move', () => {
  const followed: (string | null)[] = [];
  const { moves, item } = column(['a', 'b'], { follow: (id) => followed.push(id), drop: () => true });

  point('pointerdown', 20, 70, item('b'));
  point('pointermove', 200, 70);
  point('pointerup', 200, 70);

  expect(followed[0]).toBe('b');
  expect(moves).toEqual([]);
});

test('an item ranked up, carried away and brought back to its place releases with no move', () => {
  const { moves, item } = column(['a', 'b'], { follow: () => undefined, drop: () => false });

  point('pointerdown', 20, 70, item('b'));
  point('pointermove', 20, 10);
  point('pointermove', 200, 10);
  point('pointermove', 20, 70);
  point('pointerup', 20, 70);

  expect(moves).toEqual([]);
});
