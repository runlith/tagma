import { Effect } from 'effect';
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
import { makeChat, settle, snapshotEvent } from './testing/chatHarness.svelte';

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

let host: HTMLElement | undefined;
let app: Record<string, unknown> | undefined;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
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

const message = (id: string, role: 'user' | 'assistant', runId: string, text: string) => ({ type: 'message', id, role, runId, text });

describe('the message rail while a run works', () => {
  it.effect('a feed at its tail lights the message the run answers', () =>
    Effect.gen(function* () {
      const chat = yield* makeChat();
      const { session } = yield* chat.open();
      chat.connection.emit(
        snapshotEvent({
          activeRunId: 'run-3',
          transcript: [
            message('u1', 'user', 'run-1', 'first'),
            message('a1', 'assistant', 'run-1', 'one'),
            message('u2', 'user', 'run-2', 'second'),
            message('a2', 'assistant', 'run-2', 'two'),
            message('u3', 'user', 'run-3', 'third'),
          ],
          open: [message('a3', 'assistant', 'run-3', 'thr')],
        }),
      );
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
      yield* Effect.promise(() => Promise.resolve());
      for (let frame = 0; frame < 4; frame += 1) vi.advanceTimersToNextFrame();
      flushSync();

      expect(host.querySelector('[aria-current="location"]')?.getAttribute('aria-label')).toBe('third');
    }),
  );
});
