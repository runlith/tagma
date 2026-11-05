// @vitest-environment jsdom
import { expect, test } from 'vitest';
import { VirtualList } from './VirtualList';

type Timer = { id: number; at: number; run: () => void };

function windowClock(win: Window) {
  const setTimeout = win.setTimeout;
  const clearTimeout = win.clearTimeout;
  let now = 0;
  let next = 0;
  const timers: Timer[] = [];
  win.setTimeout = ((run: () => void, delay = 0) => {
    next += 1;
    timers.push({ id: next, at: now + delay, run });
    return next;
  }) as typeof win.setTimeout;
  win.clearTimeout = ((id: number) => {
    const at = timers.findIndex((timer) => timer.id === id);
    if (at >= 0) timers.splice(at, 1);
  }) as typeof win.clearTimeout;
  return {
    advance(ms: number) {
      now += ms;
      for (;;) {
        const due = timers.filter((timer) => timer.at <= now).sort((a, b) => a.at - b.at || a.id - b.id)[0];
        if (due === undefined) return;
        timers.splice(timers.indexOf(due), 1);
        due.run();
      }
    },
    restore() {
      win.setTimeout = setTimeout;
      win.clearTimeout = clearTimeout;
    },
  };
}

test('an iOS fling the page stalls through keeps a held correction until the element stops moving', () => {
  Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X)', configurable: true });
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
  const clock = windowClock(root.ownerDocument.defaultView!);
  const list = new VirtualList({ count: 8, getScrollElement: () => root, getItemKey: (index) => `row-${index}`, estimateSize: () => 10 });
  const scrolled = (top: number) => {
    root.scrollTop = top;
    root.dispatchEvent(new Event('scroll'));
  };
  try {
    list.span(span);
    list.connect();
    scrolled(40);
    root.dispatchEvent(new Event('touchstart'));
    scrolled(35);
    root.dispatchEvent(new Event('touchend'));
    scrolled(30);
    const row = document.createElement('div');
    Object.defineProperty(row, 'offsetHeight', { value: 15 });
    span.append(row);
    list.measureRow(row, 'row-0');
    expect(root.scrollTop).toBe(30);

    root.scrollTop = 26;
    clock.advance(150);
    expect(root.scrollTop).toBe(26);

    clock.advance(150);
    expect(root.scrollTop).toBe(31);
  } finally {
    list.dispose();
    clock.restore();
    root.remove();
  }
});
