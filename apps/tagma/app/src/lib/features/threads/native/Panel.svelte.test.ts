// @vitest-environment jsdom
import type { ThreadCacheWarmth } from '@runlith/agent/thread/cache/ThreadCacheWarmth';
import type { ThreadContextLimit } from '@runlith/agent/thread/compaction/limit';
import type { ChatContextUsageMetrics } from '@runlith/chat-ui/contextUsage';
import { Layer } from '@runlith/layer/Layer';
import { flushSync } from 'svelte';
import { afterEach, expect, test } from 'vitest';
import { mountShell, type TestApp } from '$lib/app/testing.js';
import { testProviders } from '$lib/features/providers/testing.js';
import { WallClock } from '$lib/features/workspace/WallClock.svelte.js';
import { ContextPanelState } from './PanelState.svelte.js';
import ContextPanel from './Panel.svelte';

const composition = {
  threadId: 'thread-1',
  reading: 'measured' as 'measured' | 'estimated',
  total: 354_100,
  limit: { window: 1_000_000, compaction: null } as ThreadContextLimit | null,
  parts: [
    { id: 'system' as const, count: 1, tokens: 24_800 },
    { id: 'tools' as const, count: 61, tokens: 52_000 },
    { id: 'orientation' as const, count: 3, tokens: 15_000 },
    { id: 'user' as const, count: 12, tokens: 6_100 },
    { id: 'assistant' as const, count: 61, tokens: 38_400 },
    { id: 'reasoning' as const, count: 0, tokens: 11_800 },
    { id: 'toolCall' as const, count: 312, tokens: 44_700 },
    { id: 'toolOutput' as const, count: 41, tokens: 96_300 },
    { id: 'guidance' as const, count: 38, tokens: 61_200 },
    { id: 'envelope' as const, count: 4, tokens: 3_800 },
    { id: 'summary' as const, count: 0, tokens: 0 },
  ],
  tools: [
    { name: 'apply_batch', tokens: 6_400 },
    { name: 'create_block', tokens: 5_900 },
    { name: 'spawn_agent', tokens: 3_100 },
    { name: 'query_blocks', tokens: 2_800 },
    { name: 'read_performance', tokens: 2_400 },
    { name: 'read_block', tokens: 1_200 },
    { name: 'search_blocks', tokens: 900 },
  ],
  deferredTools: [],
  orientation: [
    { name: 'Graph prime', tokens: 9_200 },
    { name: 'Workspace', tokens: 4_100 },
  ],
  cleared: { count: 271, tokens: 583_000 },
  ledger: {
    runs: 12,
    compactions: 0,
    inputTokens: 31_900_000,
    outputTokens: 57_900,
    cacheReadTokens: 30_900_000,
    cacheWriteTokens: 21_600,
    toolCalls: [
      { name: 'read', count: 118 },
      { name: 'edit', count: 96 },
      { name: 'bash', count: 47 },
      { name: 'read_block', count: 33 },
      { name: 'grep', count: 20 },
      { name: 'glob', count: 8 },
      { name: 'write', count: 4 },
    ],
  },
  pruning: { share: 0.2, protectedTokens: 200_000, liveToolOutputTokens: 96_300, nextPruneAtTokens: 300_000 },
};

const groupedComposition: typeof composition = {
  ...composition,
  parts: composition.parts.map((part) => (part.id === 'tools' ? { ...part, count: 13, tokens: 900 } : part)),
  tools: [
    { name: 'read', tokens: 200 },
    { name: 'edit', tokens: 150 },
    { name: 'mcp__context7__search', tokens: 140 },
    { name: 'mcp__context7__query', tokens: 120 },
    { name: 'write', tokens: 100 },
    { name: 'grep', tokens: 60 },
    { name: 'bash', tokens: 40 },
    { name: 'mcp__tiny__one', tokens: 15 },
    { name: 'mcp__tiny__two', tokens: 15 },
    { name: 'mcp__tiny__three', tokens: 15 },
    { name: 'mcp__tiny__four', tokens: 15 },
    { name: 'mcp__tiny__five', tokens: 15 },
    { name: 'mcp__tiny__six', tokens: 15 },
  ],
};

const lastRequest: ChatContextUsageMetrics = {
  providerLabel: 'Anthropic',
  modelLabel: 'Opus 5',
  reading: 'measured',
  contextTokens: 354_100,
  inputTokens: 354_102,
  nonCachedInputTokens: 2,
  visibleOutputTokens: 132,
  reasoningTokens: 739,
  cacheReadInputTokens: 332_500,
  cacheWriteInputTokens: 21_600,
};

let app: TestApp | undefined;

afterEach(async () => {
  if (app) await app.unmount();
  app = undefined;
});

function open(
  props: {
    composition: typeof composition | null;
    usage?: ChatContextUsageMetrics | null;
    failure?: string | null;
    warmth?: ThreadCacheWarmth | null;
    onOpen(): void;
  },
  thread = 'thread-1',
): HTMLElement {
  app ??= mountShell(Layer.mergeAll(ContextPanelState, WallClock, testProviders()), Layer.mergeAll(), { thread: { id: thread } });
  const target = app.draw(ContextPanel as never, {
    ...props,
    usage: props.usage === undefined ? lastRequest : props.usage,
    failure: props.failure ?? null,
    warmth: props.warmth ?? null,
  });
  flushSync();
  return target;
}

function warmthOf(over: Partial<ThreadCacheWarmth>): ThreadCacheWarmth {
  return {
    state: 'unknown',
    heldTokens: 354_102,
    basis: 'none',
    expiresAt: null,
    gap: null,
    warmShare: null,
    sample: null,
    oldestAt: null,
    invalidatedBy: null,
    ...over,
  };
}

function section(target: HTMLElement, label: string): HTMLButtonElement {
  const head = [...target.querySelectorAll('button')].find((button) => button.textContent?.includes(label));
  if (!head) throw new Error(`No row named ${label}.`);
  return head;
}

function openSection(target: HTMLElement, label: string): { head: HTMLButtonElement; inside: HTMLElement } {
  const head = section(target, label);
  head.click();
  flushSync();
  const inside = head.nextElementSibling;
  if (!(inside instanceof HTMLElement)) throw new Error(`No inside for ${label}.`);
  return { head, inside };
}

function tokenFigure(text: string | null | undefined): number {
  const match = text?.trim().match(/^(\d+(?:\.\d+)?)([KM])?$/);
  if (!match) throw new Error(`Not a token figure: ${text ?? ''}.`);
  const scale = match[2] === 'M' ? 1_000_000 : match[2] === 'K' ? 1_000 : 1;
  return Number(match[1]) * scale;
}

function headTokensText(head: HTMLButtonElement): string {
  return head.lastElementChild?.firstElementChild?.textContent?.trim() ?? '';
}

function headTokens(head: HTMLButtonElement): number {
  return tokenFigure(headTokensText(head));
}

function ownerGroups(inside: HTMLElement): readonly {
  owner: string;
  schemas: number;
  tokens: number;
  button: HTMLButtonElement;
}[] {
  return [...inside.children]
    .filter((child): child is HTMLButtonElement => child instanceof HTMLButtonElement)
    .map((button) => ({
      owner: button.firstElementChild?.firstElementChild?.textContent?.trim() ?? '',
      schemas: Number(button.lastElementChild?.firstElementChild?.textContent?.trim()),
      tokens: tokenFigure(button.lastElementChild?.lastElementChild?.textContent),
      button,
    }));
}

function schemaLines(inside: HTMLElement): readonly { name: string; tokens: number }[] {
  return [...inside.children]
    .filter((child) => child instanceof HTMLDivElement && child.children.length === 2)
    .map((line) => ({
      name: line.firstElementChild?.textContent?.trim() ?? '',
      tokens: tokenFigure(line.lastElementChild?.children[1]?.textContent),
    }));
}

function row(target: HTMLElement, label: string): HTMLElement {
  const line = [...target.querySelectorAll('div')].find((entry) => entry.firstElementChild?.textContent?.trim() === label);
  if (!line) throw new Error(`No line named ${label}.`);
  return line;
}

function part(target: HTMLElement, selector: string): HTMLElement | null {
  return target.querySelector(selector);
}

function details(target: HTMLElement): HTMLElement {
  section(target, 'Details').click();
  flushSync();
  const inside = part(target, '[data-details]');
  if (!inside) throw new Error('Details did not open.');
  return inside;
}

function spaced(element: HTMLElement | null): string {
  return element?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

function cells(element: HTMLElement | null): readonly string[] {
  return [...(element?.querySelectorAll('[data-stat]') ?? [])].map(
    (cell) => `${cell.firstElementChild?.textContent?.trim()} ${cell.lastElementChild?.textContent?.trim()}`,
  );
}

test('Tools keeps its flat heaviest-first schema projection when every tool is built in', () => {
  const target = open({ composition, onOpen: () => {} });
  const { inside } = openSection(target, 'Tools');

  expect(ownerGroups(inside)).toEqual([]);
  expect(schemaLines(inside)).toEqual([
    { name: 'apply_batch', tokens: 6_400 },
    { name: 'create_block', tokens: 5_900 },
    { name: 'spawn_agent', tokens: 3_100 },
    { name: 'query_blocks', tokens: 2_800 },
    { name: 'read_performance', tokens: 2_400 },
    { name: '2 more tools', tokens: 2_100 },
  ]);
});

test('Tools groups schema volume by removable owner, including an individually small server', () => {
  const target = open({ composition: groupedComposition, onOpen: () => {} });
  const { head, inside } = openSection(target, 'Tools');
  const groups = ownerGroups(inside);

  expect(groups.map(({ button: _, ...group }) => group)).toEqual([
    { owner: 'Built-ins', schemas: 5, tokens: 550 },
    { owner: 'context7', schemas: 2, tokens: 260 },
    { owner: 'tiny', schemas: 6, tokens: 90 },
  ]);
  expect(groups.reduce((sum, group) => sum + group.tokens, 0)).toBe(headTokens(head));

  const tiny = groups.at(-1);
  tiny?.button.click();
  flushSync();
  expect(tiny?.button.getAttribute('aria-expanded')).toBe('true');
  const schemas = tiny?.button.nextElementSibling;
  if (!(schemas instanceof HTMLElement)) throw new Error('The tiny owner did not open into its schemas.');
  expect(schemaLines(schemas).map((schema) => schema.tokens)).toEqual([15, 15, 15, 15, 15, 15]);
});

test('the cleared row is a negative volume, because it is not part of the window', () => {
  const target = open({ composition, onOpen: () => {} });

  section(target, 'Conversation').click();
  flushSync();

  const cleared = row(target, 'Tool output, cleared');
  expect(cleared.textContent).toContain('271');
  expect(cleared.textContent).toContain('−583K');
  expect(target.querySelector('[data-compaction]')).toBeNull();
});

test('a thread that compacts fills its bar against the compaction point, and names that point with a link to it', () => {
  const compacting = {
    ...composition,
    limit: { window: 1_000_000, compaction: { at: 550_000, strategy: 'percent', share: 0.55, source: 'override' } } as const,
  };
  const target = open({ composition: compacting, onOpen: () => {} });

  expect(part(target, '[data-fill]')?.style.width).toBe(`${(354_100 / 550_000) * 100}%`);
  expect([...(part(target, '[data-fill]')?.children ?? [])].map((band) => band.getAttribute('data-band'))).toEqual([
    'system',
    'tools',
    'orientation',
    'conversation',
  ]);

  const rule = part(target, '[data-compaction]');
  expect(spaced(rule)).toContain('55% of the 1M window');
  expect(rule?.getAttribute('href')).toBe('/settings?section=agent');
});

test('the bar fills to the live share the summary prints, not to the composition it was read with', () => {
  const target = open({ composition, usage: { ...lastRequest, usagePercent: 62 }, onOpen: () => {} });

  expect(part(target, '[data-fill]')?.style.width).toBe('62%');
});

test('the limit the live state delivers outranks the one the composition was read with', () => {
  const moved = { window: 1_000_000, compaction: { at: 800_000, strategy: 'percent', share: 0.8, source: 'global' } } as const;
  const target = open({ composition, usage: { ...lastRequest, limit: moved, limitTokens: 800_000 }, onOpen: () => {} });

  expect(spaced(part(target, '[data-compaction]'))).toContain('80% of the 1M window');
});

test('the compaction point stands while the composition is read and after its read failed', () => {
  const moved = { window: 1_000_000, compaction: { at: 800_000, strategy: 'percent', share: 0.8, source: 'global' } } as const;
  const usage = { ...lastRequest, limit: moved, limitTokens: 800_000 };

  const reading = open({ composition: null, usage, onOpen: () => {} });
  expect(spaced(part(reading, '[data-compaction]'))).toContain('80% of the 1M window');
  expect(part(reading, '[aria-label="Reading the composition"]')).not.toBeNull();

  const failed = open({ composition: null, usage, failure: 'the thread is gone', onOpen: () => {} });
  expect(spaced(part(failed, '[data-compaction]'))).toContain('80% of the 1M window');
  expect(part(failed, '[role="alert"]')?.textContent).toBe('the thread is gone');
});

test('an estimated composition marks every part as estimated', () => {
  const target = open({
    composition: { ...composition, reading: 'estimated' },
    usage: { ...lastRequest, reading: 'unknown' },
    onOpen: () => {},
  });

  expect(headTokensText(section(target, 'Conversation'))).toMatch(/^~/);
  expect(part(target, '[data-composition]')?.getAttribute('data-composition')).toBe('estimated');
  expect(part(target, '[data-fill]')?.style.width).toBe(`${(354_100 / 1_000_000) * 100}%`);
});

test('the reader’s own messages and the live tool output are drawn as the two watched rows', () => {
  const target = open({ composition, onOpen: () => {} });

  section(target, 'Conversation').click();
  flushSync();

  const plain = row(target, 'Agent text').className;
  expect(row(target, 'Your messages').className).not.toBe(plain);
  expect(row(target, 'Tool output, live').className).not.toBe(plain);
  expect(row(target, 'Tool calls').className).toBe(plain);
});

test('the details state the last bill by its figures, and only where a bill was measured', () => {
  expect(cells(part(details(open({ composition, onOpen: () => {} })), '[data-bill]'))).toEqual([
    '2 new input',
    '332.5K cache read',
    '21.6K cache write',
    '132 output',
    '739 reasoning',
  ]);

  const unbilled = open({ composition, usage: null, onOpen: () => {} });
  expect(part(unbilled, '[data-details]')).not.toBeNull();
  expect(part(unbilled, '[data-bill]')).toBeNull();
});

test('the cache row states what share of the prompt came back warm', () => {
  const target = open({ composition, onOpen: () => {} });

  expect(spaced(part(target, '[data-cache]'))).toContain('hit 94%');
});

test('a request that read nothing states a zero share, with the write beside it', () => {
  const target = open({
    composition,
    usage: {
      ...lastRequest,
      inputTokens: 24_800,
      nonCachedInputTokens: 0,
      cacheReadInputTokens: 0,
      cacheWriteInputTokens: 24_800,
    },
    onOpen: () => {},
  });

  expect(spaced(part(target, '[data-cache]'))).toContain('hit 0%');
  const bill = cells(part(details(target), '[data-bill]'));
  expect(bill).toContain('0 cache read');
  expect(bill).toContain('24.8K cache write');
});

test('a bill a compaction invalidated states its counters and no share', () => {
  const target = open({ composition, usage: { ...lastRequest, reading: 'unknown' }, onOpen: () => {} });

  expect(part(target, '[data-cache]')).toBeNull();
  expect(cells(part(details(target), '[data-bill]'))).toContain('332.5K cache read');
});

test('a bill with no cache counters draws no cache row', () => {
  const target = open({
    composition,
    usage: {
      providerLabel: 'xAI',
      modelLabel: 'Grok 4.6',
      reading: 'measured',
      contextTokens: 12_000,
      inputTokens: 12_000,
      nonCachedInputTokens: 12_000,
      visibleOutputTokens: 400,
    },
    onOpen: () => {},
  });

  expect(part(target, '[data-cache]')).toBeNull();
  expect(cells(part(details(target), '[data-bill]'))).toEqual(['12K new input', '400 output']);
});

test('the cache row states warmth wherever it was measured, and only there', () => {
  const expiresAt = new Date(Date.now() + 47 * 60_000).toISOString();
  const promised = open({ composition, warmth: warmthOf({ state: 'warm', basis: 'promise', expiresAt }), onOpen: () => {} });
  expect(part(promised, '[data-warmth]')?.getAttribute('data-warmth')).toBe('warm');
  expect(spaced(part(promised, '[data-cache]'))).toContain('warm, 47 min left');

  const expired = open({
    composition,
    warmth: warmthOf({ state: 'warm', basis: 'promise', expiresAt: new Date(Date.now() - 187 * 60_000).toISOString() }),
    onOpen: () => {},
  });
  expect(part(expired, '[data-warmth]')?.getAttribute('data-warmth')).toBe('cold');
  expect(spaced(part(expired, '[data-cache]'))).toContain('cold for 3 h 7 min');

  const local = open({
    composition,
    warmth: warmthOf({ state: 'likely', basis: 'local', gap: '30–60m', warmShare: 0.74, sample: 23, oldestAt: '2026-09-09T12:00:00.000Z' }),
    onOpen: () => {},
  });
  expect(spaced(part(local, '[data-cache]'))).toContain('74% chance warm');

  const compacted = open({ composition, warmth: warmthOf({ state: 'cold', invalidatedBy: 'compaction' }), onOpen: () => {} });
  expect(part(compacted, '[data-warmth]')?.getAttribute('data-warmth')).toBe('cold');
  expect(spaced(part(compacted, '[data-cache]'))).toContain('cold, compacted');

  const unknown = open({ composition, warmth: warmthOf({}), onOpen: () => {} });
  expect(spaced(part(unknown, '[data-cache]'))).toContain('unknown');

  const running = open({ composition, warmth: null, onOpen: () => {} });
  expect(part(running, '[data-warmth]')).toBeNull();
});

test('a share short of the whole prompt never rounds to the whole', () => {
  const target = open({
    composition,
    usage: {
      ...lastRequest,
      inputTokens: 1_000_000,
      nonCachedInputTokens: 400,
      cacheReadInputTokens: 999_600,
      cacheWriteInputTokens: 0,
    },
    onOpen: () => {},
  });

  expect(spaced(part(target, '[data-cache]'))).toContain('>99%');
});

test('an open row survives the panel closing and opening again', () => {
  const first = open({ composition, onOpen: () => {} });
  details(first);
  section(first, 'This thread').click();
  flushSync();
  expect(first.textContent).toContain('Cache hit');

  const second = open({ composition, onOpen: () => {} });
  expect(second.textContent).toContain('Cache hit');
  expect(second.textContent).toContain('12 runs');
});

test('another thread opens closed', async () => {
  const first = open({ composition, onOpen: () => {} });
  details(first);
  section(first, 'This thread').click();
  flushSync();

  app?.open({ id: 'thread-2' });
  await app?.app.adopt();

  const second = open({ composition: { ...composition, threadId: 'thread-2' }, onOpen: () => {} });
  expect(second.textContent).not.toContain('Cache hit');
  expect(part(second, '[data-details]')).toBeNull();
});

test('the tool output group prints the figures the server resolved, and links to the setting', () => {
  const pruning = part(details(open({ composition, onOpen: () => {} })), '[data-pruning]');

  expect(cells(pruning)).toEqual(['96.3K live', '200K kept whole', '300K cleared at']);
  expect(pruning?.querySelector('a')?.getAttribute('href')).toBe('/settings?section=agent');
});

test('opening the panel asks for the composition once, and shows it pending until it arrives', () => {
  let asked = 0;
  const target = open({ composition: null, usage: null, onOpen: () => (asked += 1) });

  expect(asked).toBe(1);
  expect(part(target, '[aria-label="Reading the composition"]')).not.toBeNull();
  expect(part(target, '[data-composition]')).toBeNull();
  expect(part(target, '[data-details]')).toBeNull();
});
