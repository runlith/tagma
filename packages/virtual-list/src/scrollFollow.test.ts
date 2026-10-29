// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import {
  applyOverflowAnchor,
  canScroll,
  isAtBottom,
  readScrollState,
  selectionInside,
  wheelCrossesOut,
  wheelDistance,
} from './scrollFollow';

describe('tail-following scroll policy', () => {
  test('follows only near the bottom', () => {
    expect(isAtBottom({ clientHeight: 400, scrollHeight: 1000, scrollTop: 590 })).toBe(true);
    expect(isAtBottom({ clientHeight: 400, scrollHeight: 1000, scrollTop: 560 })).toBe(false);
    expect(canScroll({ clientHeight: 400, scrollHeight: 401, scrollTop: 0 })).toBe(false);
    expect(canScroll({ clientHeight: 400, scrollHeight: 410, scrollTop: 0 })).toBe(true);
  });

  test('a wheel is read in pixels whatever unit it arrived in', () => {
    expect(wheelDistance({ deltaY: 120, deltaMode: 0, rootHeight: 600 })).toBe(120);
    expect(wheelDistance({ deltaY: 3, deltaMode: 1, rootHeight: 600 })).toBe(120);
    expect(wheelDistance({ deltaY: -1, deltaMode: 2, rootHeight: 600 })).toBe(-600);
  });

  test('a wheel crosses out of a nested region only when the region is spent', () => {
    const region = { clientHeight: 200, scrollHeight: 1000 };
    expect(wheelCrossesOut({ ...region, scrollTop: 0, delta: 100 })).toBe(false);
    expect(wheelCrossesOut({ ...region, scrollTop: 800, delta: 100 })).toBe(true);
    expect(wheelCrossesOut({ ...region, scrollTop: 300, delta: -100 })).toBe(false);
    expect(wheelCrossesOut({ ...region, scrollTop: 0, delta: -1 })).toBe(true);
    expect(wheelCrossesOut({ clientHeight: 200, scrollHeight: 200, scrollTop: 0, delta: 100 })).toBe(true);
    expect(wheelCrossesOut({ ...region, scrollTop: 0, delta: 0 })).toBe(false);
  });

  test('derives jump-to-latest visibility from distance to the bottom', () => {
    expect(readScrollState({ clientHeight: 400, scrollHeight: 1200, scrollTop: 798 })).toEqual({
      bottom: true,
      jump: false,
      overflow: true,
    });
    expect(readScrollState({ clientHeight: 400, scrollHeight: 1200, scrollTop: 300 })).toEqual({
      bottom: false,
      jump: true,
      overflow: true,
    });
    expect(readScrollState({ clientHeight: 400, scrollHeight: 401, scrollTop: 0 })).toEqual({
      bottom: true,
      jump: false,
      overflow: false,
    });
  });

  test('detects selection inside the feed', () => {
    const content = document.createElement('div');
    const selectedText = document.createTextNode('answer');
    content.appendChild(selectedText);
    document.body.appendChild(content);

    const selection = window.getSelection();
    selection?.removeAllRanges();
    const range = document.createRange();
    range.setStart(selectedText, 0);
    range.setEnd(selectedText, selectedText.textContent?.length ?? 0);
    selection?.addRange(range);

    expect(selectionInside(selection, content)).toBe(true);
    content.remove();
    selection?.removeAllRanges();
  });

  test('applies dynamic overflow anchoring from user scroll state', () => {
    const content = document.createElement('div');
    applyOverflowAnchor(content, 'dynamic', false);
    expect(content.style.overflowAnchor).toBe('none');

    applyOverflowAnchor(content, 'dynamic', true);
    expect(content.style.overflowAnchor).toBe('auto');
  });

  test('a feed that anchors itself never hands the browser the job', () => {
    const content = document.createElement('div');
    applyOverflowAnchor(content, 'none', false);
    expect(content.style.overflowAnchor).toBe('none');

    applyOverflowAnchor(content, 'none', true);
    expect(content.style.overflowAnchor).toBe('none');
  });
});
