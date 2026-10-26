import { Effect } from 'effect';
import { it } from '@runlith/effect-test/vitest';
import type { ErrorBoundaryReporter } from '@runlith/error-boundary/types';
import { createRawSnippet, flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import ChatSurface from './ChatSurface.svelte';
import { ComposerContributions } from './ComposerContributions.svelte';
import { type ChatEntry, productEntry, productId } from './entries';
import { createEntryKinds, type EntryKinds, type EntryRenderer, productKind } from './EntryKinds.svelte';
import { FeedRegions } from './FeedRegions.svelte';
import { FeedMemory } from './FeedMemory';
import { PromptHandle } from './PromptHandle.svelte';
import { ThreadOpening } from './session/ThreadOpening.svelte';
import type { ChatStrings } from './strings';
import { makeChat } from './testing/chatHarness.svelte';
import { failingRow } from './testing/FailingRow.test.svelte';

const CHAT_STRINGS = Symbol.for('runlith.chat-ui.strings');
const BOUNDARIES = Symbol.for('@runlith/error-boundary');
let faults: { place: string; message: string }[] = [];
const reporter: ErrorBoundaryReporter = {
  report: (error, input) => {
    faults.push({ place: input.id, message: error instanceof Error ? error.message : String(error) });
    return {
      errorId: input.id,
      fingerprint: input.id,
      suppressed: false,
      suppressedCount: 0,
      context: { owner: '', routeKey: '', buildId: '' },
    };
  },
};
const strings = new Proxy(
  {},
  {
    get(_target, key) {
      if (key === 'locale') return 'en';
      return (...args: unknown[]) => (args.length === 0 ? String(key) : `${String(key)} ${args.join(' ')}`);
    },
  },
) as ChatStrings;
const plainId = productId<object>('plain');
const row = createRawSnippet((entry: () => ChatEntry) => ({
  render: () => `<div data-probe="${entry().id}"></div>`,
})) as unknown as EntryRenderer;
const plain = (index: number): ChatEntry => productEntry(plainId, { id: `p${index}` }, {});
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
  const rect = (element: HTMLElement) => {
    const height = element.hasAttribute('data-scrollable') ? 600 : element.hasAttribute('data-timeline-key') ? 60 : 0;
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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  host?.remove();
  app = undefined;
  host = undefined;
  faults = [];
});
const open = Effect.fnUntraced(function* (entries: readonly ChatEntry[], kinds: EntryKinds) {
  host = document.createElement('div');
  document.body.append(host);
  const thread = new ThreadOpening();
  thread.fold.entries = entries;
  const chat = yield* makeChat();
  app = mount(ChatSurface, {
    target: host,
    props: {
      turns: (yield* chat.holder(thread)) as never,
      kinds,
      composer: new ComposerContributions(),
      memory: new FeedMemory(),
      rendering: {
        regions: new FeedRegions(),
        markdown: row as never,
        code: row as never,
        button: row as never,
        key: row as never,
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
    context: new Map<symbol, unknown>([
      [CHAT_STRINGS, strings],
      [BOUNDARIES, { reporter }],
    ]),
  }) as Record<string, unknown>;
  flushSync();
  return thread;
});

describe('a row whose effect throws', () => {
  const failingId = productId<object>('failing');
  it.live('fails alone: the feed renders what is written after it, and the row reports its place', () =>
    Effect.gen(function* () {
      const kinds = createEntryKinds();
      kinds.register('test', productKind(plainId, { render: row as never }));
      kinds.register('test', productKind(failingId, { render: failingRow as never }));
      const thread = yield* open([plain(0), productEntry(failingId, { id: 'f1' }, {}), plain(2)], kinds);
      yield* Effect.yieldNow;
      thread.fold.entries = [...thread.fold.entries, plain(3)];
      flushSync();
      expect(host!.querySelector('[data-probe="p3"]')).not.toBeNull();
      expect(faults).toEqual([{ place: 'feed row failing', message: 'row f1 failed' }]);
    }),
  );
});

describe('the contributed regions', () => {
  test('mounts are unique within each region and a disposer releases only its own contribution', () => {
    const regions = new FeedRegions();
    const body = createRawSnippet(() => ({ render: () => '<div></div>' }));
    const pin = { id: 'same', body };
    const interlude = { id: 'same', after: () => null, body };
    const hero = { id: 'same', body };
    const leavePin = regions.pin('first', pin);
    const leaveInterlude = regions.interlude('first', interlude);
    const leaveHero = regions.hero('first', hero);
    expect(regions.pins).toEqual([pin]);
    expect(regions.interludes).toEqual([interlude]);
    expect(regions.heroes).toEqual([hero]);
    expect(() => regions.pin('second', pin)).toThrow(/"first".*"second"/);
    expect(() => regions.interlude('second', interlude)).toThrow(/"first".*"second"/);
    expect(() => regions.hero('second', hero)).toThrow(/"first".*"second"/);
    leavePin();
    leaveInterlude();
    leaveHero();
    expect(regions.pins).toEqual([]);
    expect(regions.interludes).toEqual([]);
    expect(regions.heroes).toEqual([]);
    regions.pin('second', pin);
    leavePin();
    expect(regions.pins).toEqual([pin]);
  });
});
