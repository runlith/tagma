// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { place } from './place.js';

const viewport = { width: 1000, height: 800 };
const menu = { width: 200, height: 300 };

describe('place', () => {
  it('turns to the opposite side when its own lacks the room the other has, and reports the room it ends with', () => {
    const anchor = { x: 400, y: 700, width: 100, height: 20 };

    const placed = place(anchor, menu, viewport, { side: 'bottom', sideOffset: 4 });

    expect(placed.side).toBe('top');
    expect(placed.y).toBe(700 - 4 - 300);
    expect(placed.availableHeight).toBe(700 - 4);
  });

  it('stays on its side when the other has even less room, offering the height it has', () => {
    const anchor = { x: 400, y: 200, width: 100, height: 20 };

    const placed = place(anchor, { width: 200, height: 900 }, viewport, { side: 'bottom' });

    expect(placed.side).toBe('bottom');
    expect(placed.availableHeight).toBe(800 - 220);
  });

  it('aligns the start, the center or the end of the anchor', () => {
    const anchor = { x: 400, y: 100, width: 100, height: 20 };

    expect(place(anchor, menu, viewport, { align: 'start' }).x).toBe(400);
    expect(place(anchor, menu, viewport, { align: 'center' }).x).toBe(350);
    expect(place(anchor, menu, viewport, { align: 'end' }).x).toBe(300);
  });

  it('shifts along its side back inside the viewport, short of the padding of that side', () => {
    const anchor = { x: 950, y: 100, width: 40, height: 20 };

    expect(place(anchor, menu, viewport, { align: 'start' }).x).toBe(800);
    expect(place(anchor, menu, viewport, { align: 'start', collisionPadding: { right: 16 } }).x).toBe(784);
    expect(place({ x: 2, y: 100, width: 40, height: 20 }, menu, viewport, { align: 'end', collisionPadding: 8 }).x).toBe(8);
  });

  it('opens at a point, as a context menu at the cursor does', () => {
    const placed = place({ x: 300, y: 250, width: 0, height: 0 }, menu, viewport, { side: 'bottom', align: 'start' });

    expect([placed.x, placed.y]).toEqual([300, 250]);
    expect(placed.origin).toEqual({ x: 0, y: 0 });
  });

  it('counts the padding of the side it opens toward in the room', () => {
    const anchor = { x: 400, y: 460, width: 100, height: 20 };

    expect(place(anchor, menu, viewport, { side: 'bottom' }).side).toBe('bottom');
    expect(place(anchor, menu, viewport, { side: 'bottom', collisionPadding: { bottom: 40 } }).side).toBe('top');
  });
});
