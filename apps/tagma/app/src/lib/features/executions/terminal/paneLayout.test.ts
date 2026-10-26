import { expect, test } from 'vitest';
import {
  equalise,
  insertBeside,
  isMoveNoOp,
  movePane,
  nearestZone,
  neighbourPane,
  paneIds,
  paneNode,
  removePane,
  setRatio,
  sideFlex,
  sideHidden,
  splitNode,
  splitPane,
  zoneRect,
  type PaneNode,
} from './paneLayout.js';

const one = paneNode('a');

test('splitting right twice puts the newest pane beside the one it was split from', () => {
  const twice = splitPane(splitPane(one, 'a', 'b', 'row'), 'b', 'c', 'row');

  expect(twice).toEqual(splitNode('row', paneNode('a'), splitNode('row', paneNode('b'), paneNode('c'))));
  expect(paneIds(twice)).toEqual(['a', 'b', 'c']);
});

test('split right twice, drag onto the first pane s top edge, equalise: the tree that leaves', () => {
  const twice = splitPane(splitPane(one, 'a', 'b', 'row'), 'b', 'c', 'row');

  const moved = movePane(twice, 'c', 'a', 'top');
  expect(moved).toEqual(splitNode('row', splitNode('column', paneNode('c'), paneNode('a')), paneNode('b')));

  expect(equalise(moved)).toEqual(moved);
});

test('equalising weights nested same-axis splits by pane count, so three across become thirds', () => {
  const twice = splitPane(splitPane(one, 'a', 'b', 'row'), 'b', 'c', 'row');

  const even = equalise(twice);

  expect(even).toEqual(splitNode('row', paneNode('a'), splitNode('row', paneNode('b'), paneNode('c'), 0.5), 1 / 3));
});

test('closing a pane promotes its sibling into the split s slot and names the next pane', () => {
  const three = splitPane(splitPane(one, 'a', 'b', 'row'), 'b', 'c', 'row');

  expect(neighbourPane(three, 'b', 1)).toBe('c');
  expect(removePane(three, 'b')).toEqual(splitNode('row', paneNode('a'), paneNode('c')));
  expect(removePane(splitNode('row', paneNode('a'), paneNode('c')), 'a')).toEqual(paneNode('c'));
  expect(removePane(paneNode('c'), 'c')).toBeNull();
});

test('a drop that would leave the order unchanged is refused, and one that changes it is taken', () => {
  const pair = splitNode('row', paneNode('a'), paneNode('b'));

  expect(isMoveNoOp(pair, 'b', 'a', 'right')).toBe(true);
  expect(isMoveNoOp(pair, 'a', 'b', 'left')).toBe(true);
  expect(movePane(pair, 'b', 'a', 'right')).toBe(pair);
  expect(isMoveNoOp(pair, 'b', 'a', 'left')).toBe(false);
  expect(isMoveNoOp(pair, 'b', 'a', 'top')).toBe(false);
  expect(movePane(pair, 'b', 'a', 'left')).toEqual(splitNode('row', paneNode('b'), paneNode('a')));
});

test('expanding a pane consumes the ratios without writing them, so collapsing gives them back', () => {
  const dragged = setRatio(splitNode('row', paneNode('a'), splitNode('column', paneNode('b'), paneNode('c'))), [], 0.72);
  const inner = dragged as Extract<PaneNode, { kind: 'split' }>;

  expect(sideFlex(inner, 1, 'c')).toBe('1 1 auto');
  expect(sideHidden(inner, 0, 'c')).toBe(true);
  expect(sideHidden(inner, 1, 'c')).toBe(false);

  expect(sideFlex(inner, 0, null)).toBe('0.72 1 0%');
  expect(sideFlex(inner, 1, null)).toBe('0.28 1 0%');
  expect(dragged).toEqual(splitNode('row', paneNode('a'), splitNode('column', paneNode('b'), paneNode('c')), 0.72));
});

test('a divider writes its ratio at the split its path names and nowhere else', () => {
  const nested = splitNode('row', paneNode('a'), splitNode('column', paneNode('b'), paneNode('c')));

  const written = setRatio(nested, [1], 0.25);

  expect(written).toEqual(splitNode('row', paneNode('a'), splitNode('column', paneNode('b'), paneNode('c'), 0.25)));
  expect(setRatio(nested, [0], 0.25)).toBe(nested);
});

test('the nearest edge decides the zone, and the overlay covers that half of the pane', () => {
  const rect = { left: 0, top: 0, width: 100, height: 100 };

  expect(nearestZone({ x: 90, y: 50 }, rect)).toBe('right');
  expect(nearestZone({ x: 50, y: 5 }, rect)).toBe('top');
  expect(zoneRect(rect, 'bottom')).toEqual({ left: 0, top: 50, width: 100, height: 50 });
  expect(zoneRect(rect, 'left')).toEqual({ left: 0, top: 0, width: 50, height: 100 });
});

test('a pane inserted before its target lands on the zone s own side', () => {
  expect(insertBeside(one, 'a', 'b', 'top')).toEqual(splitNode('column', paneNode('b'), paneNode('a')));
  expect(insertBeside(one, 'a', 'b', 'bottom')).toEqual(splitNode('column', paneNode('a'), paneNode('b')));
});
