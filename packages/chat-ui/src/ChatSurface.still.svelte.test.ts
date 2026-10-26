import { Effect } from 'effect';
import { TestClock } from 'effect/testing';
import { it } from '@runlith/effect-test/vitest';
// @vitest-environment jsdom
import { createRawSnippet, flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, vi } from 'vitest';
import ChatSurface from './ChatSurface.svelte';
import { ComposerContributions } from './ComposerContributions.svelte';
import { createEntryKinds } from './EntryKinds.svelte';
import { FeedMemory } from './FeedMemory';
import { FeedRegions } from './FeedRegions.svelte';
import { PromptHandle } from './PromptHandle.svelte';
import type { ChatStrings } from './strings';
import { MEASURED_AT, makeChat, settle, snapshotEvent } from './testing/chatHarness.svelte';

const CHAT_STRINGS = Symbol.for('runlith.chat-ui.strings');
const strings = new Proxy(
  {},
  {
    get(_target, key) {
      if (key === 'locale') return 'en';
      return (...args: unknown[]) => (args.length === 0 ? String(key) : `${String(key)} ${args.join(' ')}`);
    },
  },
) as ChatStrings;
const plain = createRawSnippet(() => ({ render: () => '<span></span>' }));
const NOW = Date.parse(MEASURED_AT);

let host: HTMLElement | undefined;
let app: Record<string, unknown> | undefined;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'], now: NOW });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  const rect = (element: HTMLElement) => {
    const height = element.hasAttribute('data-scrollable') ? 600 : element.hasAttribute('data-timeline-key') ? 40 : 0;
    return { width: 800, height, top: 0, left: 0, right: 800, bottom: height, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
  };
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return rect(this);
  });
  for (const name of ['clientHeight', 'offsetHeight'] as const) {
    vi.spyOn(HTMLElement.prototype, name, 'get').mockImplementation(function (this: HTMLElement) {
      return rect(this).height;
    });
  }
  for (const name of ['clientWidth', 'offsetWidth'] as const) vi.spyOn(HTMLElement.prototype, name, 'get').mockReturnValue(800);
  Object.defineProperty(document, 'execCommand', { configurable: true, value: () => false });
});
afterEach(async () => {
  if (app) await unmount(app);
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  host?.remove();
  app = undefined;
  host = undefined;
});

const runningCall = {
  type: 'tool',
  id: 'call-1',
  runId: 'run-1',
  toolName: 'bash',
  toolCallId: 'call-1',
  toolState: 'input-available',
  execution: { state: 'started', at: new Date(NOW - 51_000).toISOString() },
};

const later = (ms: number) => {
  vi.advanceTimersByTime(ms);
  flushSync();
  return host!.textContent ?? '';
};

describe('a feed the session stopped reading', () => {
  it.effect('stops the clocks of its steps and its run, and shows an unclosed call as of unknown state', () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      const chat = yield* makeChat();
      const { session } = yield* chat.open();
      chat.connection.emit(snapshotEvent({ activeRunId: 'run-1', open: [runningCall] }));
      yield* settle;
      host = document.createElement('div');
      document.body.append(host);
      app = mount(ChatSurface, {
        target: host,
        props: {
          turns: (yield* chat.holder(session)) as never,
          kinds: createEntryKinds(),
          composer: new ComposerContributions(),
          memory: new FeedMemory(),
          rendering: {
            regions: new FeedRegions(),
            markdown: plain as never,
            code: plain as never,
            button: plain as never,
            key: plain as never,
            tip: () => () => undefined,
            copyText: async () => true,
            copyImage: async () => true,
            saveImage: async () => {},
            touch: false,
          },
          navigation: { keyboard: true, files: false, link: () => () => undefined, linkMenu: () => undefined, entryAddress: () => null },
          preferences: {
            verbose: { read: () => false, write: () => undefined },
            stretches: { read: () => 'newest' as const, write: () => undefined },
            disclosure: { read: () => ({}), write: () => undefined },
          },
          handle: new PromptHandle(),
        },
        context: new Map([[CHAT_STRINGS, strings]]),
      }) as Record<string, unknown>;
      flushSync();
      const live = later(0);
      expect(live).toContain('toolRunningAlone bash');
      expect(later(60_000)).not.toBe(live);

      chat.connection.break('a live request ended by a defect');
      yield* settle;
      const still = later(0);
      expect(still).toContain('toolUnknown bash');
      expect(still).toContain('stateUnknown');
      expect(still).toContain('a live request ended by a defect');
      expect(later(60_000)).toBe(still);
    }),
  );
});
