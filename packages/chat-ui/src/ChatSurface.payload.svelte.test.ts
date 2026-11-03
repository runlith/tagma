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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  host?.remove();
  app = undefined;
  host = undefined;
});

const call = (id: string, toolName: string, toolInput: Record<string, string>, toolDisplay: Record<string, string>) => ({
  type: 'tool',
  id,
  runId: 'run-1',
  toolName,
  toolCallId: id,
  toolState: 'output-available',
  toolInput,
  toolOutput: { status: 'ok' },
  toolDisplay,
});

describe('a call opened with raw payloads shown', () => {
  it.effect('shows the payload at once when nothing readable stands above it, and folds it under Details otherwise', () =>
    Effect.gen(function* () {
      const chat = yield* makeChat();
      const { session } = yield* chat.open();
      chat.connection.emit(
        snapshotEvent({
          activeRunId: 'run-1',
          open: [
            call('bare', 'submit_work', { subject: 'the bare payload' }, { form: 'none', verb: 'Committed' }),
            call('read', 'read', { path: 'the folded payload' }, { form: 'text', text: 'what the call printed' }),
          ],
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
            verbose: { read: () => true, write: () => undefined },
            stretches: { read: () => 'all' as const, write: () => undefined },
            disclosure: { read: () => ({}), write: () => undefined },
          },
          handle: new PromptHandle(),
        },
        context: new Map([[CHAT_STRINGS, strings]]),
      }) as Record<string, unknown>;
      flushSync();
      for (const id of ['bare', 'read']) {
        const row = host.querySelector<HTMLElement>(`[data-entry="${id}"]`)!;
        if (row.getAttribute('aria-expanded') !== 'true') row.click();
      }
      flushSync();

      const toggles = [...host.querySelectorAll('button')].filter((button) => button.textContent?.trim() === 'details');
      expect(host.textContent).toContain('the bare payload');
      expect(host.textContent).toContain('what the call printed');
      expect(host.textContent).not.toContain('the folded payload');
      expect(toggles).toHaveLength(1);

      toggles[0]!.click();
      flushSync();
      expect(host.textContent).toContain('the folded payload');
    }),
  );
});
