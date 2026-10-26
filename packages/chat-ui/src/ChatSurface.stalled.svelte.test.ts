import { Effect } from 'effect';
import { it } from '@runlith/effect-test/vitest';
// @vitest-environment jsdom
import { createRawSnippet, flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import ChatSurface from './ChatSurface.svelte';
import { ComposerContributions } from './ComposerContributions.svelte';
import { createEntryKinds } from './EntryKinds.svelte';
import { FeedMemory } from './FeedMemory';
import { FeedRegions } from './FeedRegions.svelte';
import { PromptHandle } from './PromptHandle.svelte';
import type { ChatStrings } from './strings';
import { settle, snapshotEvent, makeChat } from './testing/chatHarness.svelte';
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
const control = createRawSnippet(
  (
    props: () => {
      control: string;
    },
  ) => ({
    render: () => `<button data-control="${props().control}"></button>`,
  }),
);
const plain = createRawSnippet(() => ({ render: () => '<span></span>' }));
let host: HTMLElement | undefined;
let app: Record<string, unknown> | undefined;
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Object.defineProperty(document, 'execCommand', { configurable: true, value: () => false });
});
afterEach(async () => {
  if (app) await unmount(app);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  host?.remove();
  app = undefined;
  host = undefined;
});
const surfaceOver = Effect.fnUntraced(function* (life: 'idle' | 'working' | 'stalled') {
  const chat = yield* makeChat();
  const { session } = yield* chat.open();
  chat.connection.emit(snapshotEvent({ activeRunId: life === 'idle' ? null : 'run-1', life }));
  yield* settle;
  host = document.createElement('div');
  document.body.append(host);
  const props = {
    turns: (yield* chat.holder(session)) as never,
    kinds: createEntryKinds(),
    composer: new ComposerContributions(),
    memory: new FeedMemory(),
    rendering: {
      regions: new FeedRegions(),
      markdown: plain as never,
      code: plain as never,
      button: control as never,
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
  };
  app = mount(ChatSurface, { target: host, props, context: new Map([[CHAT_STRINGS, strings]]) }) as Record<string, unknown>;
  flushSync();
  return host;
});
describe('the stop control follows a run that exists, not one that progresses', () => {
  it.effect('a stalled run keeps its stop control, like a working one, and an idle thread has none', () =>
    Effect.gen(function* () {
      expect((yield* surfaceOver('idle')).querySelector('[data-control="stop"]')).toBeNull();
      yield* Effect.promise(() => unmount(app!));
      host?.remove();
      expect((yield* surfaceOver('working')).querySelector('[data-control="stop"]')).not.toBeNull();
      yield* Effect.promise(() => unmount(app!));
      host?.remove();
      expect((yield* surfaceOver('stalled')).querySelector('[data-control="stop"]')).not.toBeNull();
    }),
  );
});
