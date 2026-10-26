// @vitest-environment jsdom
import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createEntryKinds } from './EntryKinds.svelte';
import JumpToLatest from './JumpToLatest.svelte';
import type { ChatLiveTail } from './liveStatus';
import type { ChatRendering } from './renderers';
import type { ChatStrings } from './strings';
import { VisibleFeed } from './VisibleFeed';

const strings = new Proxy(
  {},
  {
    get(_target, key) {
      if (key === 'locale') return 'en';
      return (...args: unknown[]) => (args.length === 0 ? String(key) : `${String(key)} ${args.join(' ')}`);
    },
  },
) as ChatStrings;
const CHARACTER = 8;
const ARROW = 14;
const working: ChatLiveTail = {
  kind: 'status',
  status: { phase: 'working', waiting: null, elapsedMs: null, phaseMs: null, pulse: true, reason: null, asOf: null },
};

let host: HTMLElement | undefined;
let app: Record<string, unknown> | undefined;
beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const width = this.tagName === 'svg' ? ARROW : this.classList.contains('w-max') ? (this.textContent ?? '').length * CHARACTER : 0;
    return { width, height: 0, top: 0, left: 0, right: width, bottom: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
  });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
  vi.spyOn(window, 'getComputedStyle').mockReturnValue({
    paddingLeft: '0',
    paddingRight: '0',
    borderLeftWidth: '0',
    borderRightWidth: '0',
    columnGap: '0',
    maxWidth: '448px',
    opacity: '1',
  } as CSSStyleDeclaration);
});
afterEach(async () => {
  if (app) await unmount(app);
  host?.remove();
  app = undefined;
  host = undefined;
  vi.restoreAllMocks();
});

test('the button fits the label shown again while the previous one still fades out', async () => {
  const props = $state<{ tail: ChatLiveTail | null }>({ tail: null });
  host = document.createElement('div');
  document.body.append(host);
  app = mount(JumpToLatest, {
    target: host,
    props: {
      feed: new VisibleFeed(createEntryKinds()),
      clockOffset: 0,
      get tail() {
        return props.tail;
      },
      still: false,
      shown: true,
      onJump: () => undefined,
    },
    context: new Map<symbol, unknown>([
      [Symbol.for('runlith.chat-ui.strings'), strings],
      [Symbol.for('runlith.chat-ui.rendering'), { kinds: createEntryKinds() } as unknown as ChatRendering],
    ]),
  });
  flushSync();

  props.tail = working;
  flushSync();
  props.tail = null;
  flushSync();
  for (let turn = 0; turn < 5; turn += 1) await tick();
  flushSync();

  const button = host.querySelector('button');
  expect(button?.textContent?.trim()).toBe('jumpToLatest');
  expect(button?.style.width).toBe(`${'jumpToLatest'.length * CHARACTER + ARROW}px`);
});
