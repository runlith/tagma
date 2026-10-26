// @vitest-environment jsdom
import { createRawSnippet, flushSync, mount, unmount } from 'svelte';
import { afterEach, expect, test } from 'vitest';
import ChatContextUsagePill from './ChatContextUsagePill.svelte';
import type { ChatContextUsageMetrics } from './contextUsage';
import type { ChatStrings } from './strings';

const strings = new Proxy(
  {},
  {
    get(_target, key) {
      if (key === 'locale') return 'en';
      return (...args: unknown[]) => (args.length === 0 ? String(key) : `${String(key)} ${args.join(' ')}`);
    },
  },
) as ChatStrings;

const CHAT_STRINGS = Symbol.for('runlith.chat-ui.strings');

const metrics: ChatContextUsageMetrics = {
  providerLabel: 'Anthropic',
  modelLabel: 'Opus 5',
  reading: 'measured',
  contextTokens: 354_100,
  limit: { window: 1_000_000, compaction: null },
  limitTokens: 1_000_000,
  usagePercent: 35.41,
  cacheReadInputTokens: 332_500,
  segments: [
    { label: 'System prompt', tokens: 24_800 },
    { label: 'Tools', tokens: 52_000 },
    { label: 'Conversation', tokens: 277_300 },
  ],
};

let host: HTMLElement | undefined;
let app: Record<string, unknown> | undefined;

afterEach(() => {
  if (app) void unmount(app);
  host?.remove();
  app = undefined;
  host = undefined;
});

function open(props: { metrics: ChatContextUsageMetrics; detail?: ReturnType<typeof createRawSnippet> }): HTMLElement {
  host = document.createElement('div');
  document.body.append(host);
  app = mount(ChatContextUsagePill, {
    target: host,
    props,
    context: new Map([[CHAT_STRINGS, strings]]),
  }) as Record<string, unknown>;
  const group = host.querySelector('[role="group"]') as HTMLElement;
  group.dispatchEvent(new MouseEvent('mouseenter'));
  flushSync();
  return host.querySelector('[role="tooltip"]') as HTMLElement;
}

test('with no detail the tooltip draws the attributed segments the product priced', () => {
  const tooltip = open({ metrics });

  expect(tooltip.textContent).toContain('System prompt');
  expect(tooltip.textContent).toContain('Tools');
  expect(tooltip.textContent).toContain('Conversation');
  expect(tooltip.querySelectorAll('[class*="bg-foreground/"]').length).toBeGreaterThanOrEqual(3);
});

test('a detail snippet owns everything below the summary, and the summary keeps what qualifies its figure', () => {
  const tooltip = open({
    metrics: {
      ...metrics,
      reading: 'estimated',
      nextRequestTokens: 360_000,
      limit: { window: 1_000_000, compaction: { at: 850_000, strategy: 'percent', share: 0.85, source: 'global' } },
    },
    detail: createRawSnippet(() => ({ render: () => '<div data-detail>the product panel</div>' })),
  });

  const summary = tooltip.querySelector('[data-context-summary]');
  expect(summary?.textContent).toContain('35%');
  expect(summary?.textContent).toContain('354.1K');
  expect(summary?.textContent).toContain('contextEstimated');
  expect(summary?.textContent).toContain('contextNextRequest 360K');
  expect(
    [...tooltip.children].map((child) =>
      child.hasAttribute('data-detail') ? 'detail' : child.hasAttribute('data-context-summary') ? 'summary' : 'other',
    ),
  ).toEqual(['summary', 'detail']);
});
