// @vitest-environment jsdom
import { Effect } from 'effect';
import { it } from '@runlith/effect-test/vitest';
import { createRawSnippet, flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, vi } from 'vitest';
import ChatSurface from './ChatSurface.svelte';
import { ComposerContributions } from './ComposerContributions.svelte';
import { createEntryKinds } from './EntryKinds.svelte';
import { FeedMemory } from './FeedMemory';
import { FeedRegions } from './FeedRegions.svelte';
import { PromptHandle } from './PromptHandle.svelte';
import type { ChatStrings } from './strings';
import { makeChat, settle, snapshotEvent, type TestChat } from './testing/chatHarness.svelte';

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
const control = createRawSnippet((props: () => { control: string }) => ({
  render: () => `<button type="button" data-control="${props().control}"></button>`,
}));
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
  vi.unstubAllGlobals();
  host?.remove();
  app = undefined;
  host = undefined;
});

const surface = Effect.fnUntraced(function* (layered = false) {
  const chat = yield* makeChat();
  const { session } = yield* chat.open();
  chat.connection.emit(snapshotEvent({ activeRunId: 'run-1', steers: [{ id: 'steer-1', text: 'use the other table' }] }));
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
      layered: () => layered,
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
  return { chat, root: host };
});

const escape = Effect.fnUntraced(function* (target: Element) {
  (target as HTMLElement).focus();
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  flushSync();
  yield* settle;
});

const FOCUS = {
  feed: (root: HTMLElement) => root.querySelector('[role="group"][tabindex="-1"]'),
  'the next step row': (root: HTMLElement) => root.querySelector('section[data-scrollable] button[aria-expanded]'),
  'the stop button': (root: HTMLElement) => root.querySelector('[data-control="stop"]'),
};

const stops = (chat: TestChat) => chat.connection.called('stop').length;

describe('Escape belongs to the thread, wherever its focus is', () => {
  it.effect.each(Object.keys(FOCUS) as (keyof typeof FOCUS)[])('Escape with focus on %s stops the run', (where) =>
    Effect.gen(function* () {
      const { chat, root } = yield* surface();
      const target = FOCUS[where](root);
      expect(target).not.toBeNull();
      yield* escape(target!);
      expect(stops(chat)).toBe(1);
    }),
  );

  it.effect.each(['lost', 'broken'] as const)('a feed that is %s still stops on Escape and arms no rewind', (still) =>
    Effect.gen(function* () {
      const { chat, root } = yield* surface();
      if (still === 'lost') chat.connection.emit({ type: 'interrupted', message: 'the socket closed' });
      else chat.connection.break('the frame did not encode');
      yield* settle;
      yield* escape(FOCUS.feed(root)!);
      expect(stops(chat)).toBe(1);
      expect(root.querySelector('[data-pick]')).toBeNull();
    }),
  );

  it.effect('a second Escape while the stop is out sends nothing more', () =>
    Effect.gen(function* () {
      const { chat, root } = yield* surface();
      const reached = chat.connection.hold('stop');
      yield* escape(FOCUS.feed(root)!);
      yield* Effect.promise(() => reached);
      yield* escape(FOCUS.feed(root)!);
      chat.connection.release('stop');
      yield* settle;
      yield* escape(FOCUS.feed(root)!);
      expect(stops(chat)).toBe(1);
    }),
  );

  it.effect('Escape on a pick of the composer menu closes the menu and leaves the run going', () =>
    Effect.gen(function* () {
      const { chat, root } = yield* surface();
      const field = root.querySelector('textarea')!;
      field.focus();
      field.value = '/';
      field.setSelectionRange(1, 1);
      field.dispatchEvent(new InputEvent('input', { bubbles: true }));
      flushSync();
      const pick = root.querySelector('[data-composer-popup] button, [role="listbox"] [role="option"]');
      expect(pick).not.toBeNull();
      yield* escape(pick!);
      expect(stops(chat)).toBe(0);
      expect(root.querySelector('[data-composer-popup]')).toBeNull();
    }),
  );

  it.effect('a layer open over the thread takes Escape before the run does', () =>
    Effect.gen(function* () {
      const { chat, root } = yield* surface(true);
      yield* escape(FOCUS.feed(root)!);
      expect(stops(chat)).toBe(0);
    }),
  );
});
