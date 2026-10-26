import { describe, expect, test } from 'vitest';
import { builtinEntryKinds } from './builtinKinds';
import { createEntryKinds, type EntryRenderer, productKind } from './EntryKinds.svelte';
import { type ChatEntry, productEntry, productId } from './entries';
import { markdownHeight } from './rowEstimate';
import { VisibleFeed } from './VisibleFeed';

const view = {
  expanded: (_key: string, fallback: boolean) => fallback,
  stretchDefault: () => false,
  toolOpen: () => undefined,
  markdown: (_key: string, text: string, columns: number) => markdownHeight(text, columns),
};

function shownIds(feed: VisibleFeed, entries: readonly ChatEntry[], verbose: boolean): string[] {
  feed.load(entries, verbose);
  return feed.rows.slice().map((entry) => entry.id);
}
const render = (() => undefined) as unknown as EntryRenderer;

const widgetId = productId<{ n: number }>('widget');
const widget = (id: string): ChatEntry => productEntry(widgetId, { id, runId: 'run-1' }, { n: 1 });
const user = (id: string): ChatEntry => ({ id, kind: 'user', text: 'hello', runId: 'run-1' });

describe('the registry answers for a kind only while it is registered', () => {
  test('a registered kind renders with its own renderer and stops when its disposer runs', () => {
    const kinds = createEntryKinds();
    const dispose = kinds.register('test', { ...productKind(widgetId), render });

    expect(kinds.renderer(widget('w1'))).toBe(render);
    dispose();
    expect(kinds.renderer(widget('w1'))).toBeUndefined();
    expect(kinds.classify(widget('w1')).hidden).toBeUndefined();
  });

  test('a kind that arrives without a renderer is told apart from one hidden on purpose', () => {
    const kinds = createEntryKinds();
    const quietId = productId<object>('quiet');
    kinds.register('test', productKind(quietId, { classify: () => ({ hidden: true }) }));

    const quiet = productEntry(quietId, { id: 'q1' }, {});
    expect(kinds.renderer(quiet)).toBeUndefined();
    expect(kinds.classify(quiet).hidden).toBe(true);
    expect(kinds.classify(widget('w1')).hidden).toBeUndefined();
  });

  test('registering over a built-in changes its renderer and keeps its classification', () => {
    const kinds = builtinEntryKinds();
    const tool = { id: 't1', kind: 'tool', toolName: 'read', toolCallId: 'c1', toolState: 'output-available', runId: 'run-1' } as ChatEntry;

    kinds.register('test', { kind: 'tool', render });

    expect(kinds.renderer(tool)).toBe(render);
    expect(kinds.isMeta(tool)).toBe(true);
    expect(() => kinds.register('test', { kind: 'tool', render })).toThrow();
  });

  test('facets of one kind from different contributors merge, and a facet held twice names both contributors', () => {
    const kinds = builtinEntryKinds();
    const tool = { id: 't1', kind: 'tool', toolName: 'read', toolCallId: 'c1', toolState: 'output-available', runId: 'run-1' } as ChatEntry;
    const identity = () => ({ title: 'x', threads: [] });

    const dropRender = kinds.register('tools', { kind: 'tool', render });
    kinds.register('calls', { kind: 'tool', identity });

    expect(kinds.renderer(tool)).toBe(render);
    expect(kinds.identity(tool)).toEqual({ title: 'x', threads: [] });
    expect(() => kinds.register('other', { kind: 'tool', render })).toThrow(/"tools".*"other"/);

    dropRender();
    expect(kinds.renderer(tool)).not.toBe(render);
    expect(kinds.identity(tool)).toEqual({ title: 'x', threads: [] });
  });

  test('a tool named twice refuses and names both contributors', () => {
    const kinds = builtinEntryKinds();
    kinds.registerTool('first', { name: 'bash' });
    expect(() => kinds.registerTool('second', { name: 'bash' })).toThrow(/"first".*"second"/);
  });

  test('a tool renderer is found by tool name before the kind renderer', () => {
    const kinds = builtinEntryKinds();
    const named = (() => undefined) as unknown as EntryRenderer;
    kinds.register('test', { kind: 'tool', render });
    kinds.registerTool('test', { name: 'bash', render: named as never });

    const call = (toolName: string) =>
      ({ id: toolName, kind: 'tool', toolName, toolCallId: toolName, toolState: 'output-available' }) as ChatEntry;
    expect(kinds.renderer(call('bash'))).toBe(named);
    expect(kinds.renderer(call('read'))).toBe(render);
  });

  test('a tool renderer that declines an entry leaves it to the kind renderer', () => {
    const kinds = builtinEntryKinds();
    const named = (() => undefined) as unknown as EntryRenderer;
    kinds.register('test', { kind: 'tool', render });
    kinds.registerTool('test', { name: 'submit_work', render: named as never, renders: (entry) => entry.toolState === 'output-available' });

    const call = (toolState: string) =>
      ({ id: toolState, kind: 'tool', toolName: 'submit_work', toolCallId: toolState, toolState }) as ChatEntry & { kind: 'tool' };
    expect(kinds.renderer(call('output-available'))).toBe(named);
    expect(kinds.toolRenders(call('output-available'))).toBe(true);
    expect(kinds.renderer(call('output-refused'))).toBe(render);
    expect(kinds.toolRenders(call('output-refused'))).toBe(false);
  });

  test('a tool view that declines an entry leaves it an ordinary row, priced and classified as one', () => {
    const kinds = builtinEntryKinds();
    const card = (() => undefined) as unknown as EntryRenderer;
    kinds.registerTool('test', {
      name: 'publish_artifact',
      view: card as never,
      renders: (entry) => entry.toolState === 'output-available',
    });

    const call = (toolState: string) =>
      ({ id: toolState, kind: 'tool', toolName: 'publish_artifact', toolCallId: toolState, toolState }) as ChatEntry & { kind: 'tool' };
    expect(kinds.toolView(call('output-available'))).toBe(card);
    expect(kinds.isMeta(call('output-available'))).toBe(false);
    expect(kinds.toolView(call('output-error'))).toBeUndefined();
    expect(kinds.isMeta(call('output-error'))).toBe(true);
    expect(kinds.estimate(call('output-error'), view)).toBeLessThan(kinds.estimate(call('output-available'), view));
  });

  test('an estimate comes from the kind, and a kind without one is priced as undetermined', () => {
    const kinds = builtinEntryKinds();
    const sizedId = productId<object>('sized');
    kinds.register('test', productKind(sizedId, { estimate: () => 120 }));

    expect(kinds.estimate(productEntry(sizedId, { id: 's1' }, {}), view)).toBe(120);
    expect(kinds.estimate(widget('w1'), view)).toBe(kinds.estimate(productEntry(productId<object>('other'), { id: 'o1' }, {}), view));
    expect(kinds.estimate(user('u1'), view)).toBeGreaterThan(0);
  });
});

describe('the feed follows the registry', () => {
  test('a hidden kind never reaches the feed, verbose or not, and one registered later changes the next pass', () => {
    const kinds = builtinEntryKinds();
    const feed = new VisibleFeed(kinds);
    const entries = [user('u1'), widget('w1')];

    expect(shownIds(feed, entries, true)).toEqual(['u1', 'w1']);
    kinds.register('test', productKind(widgetId, { classify: () => ({ hidden: true }) }));
    expect(shownIds(feed, entries, true)).toEqual(['u1']);
    expect(shownIds(feed, entries, false)).toEqual(['u1']);
  });

  test('a verbose-only kind shows only in verbose mode', () => {
    const kinds = builtinEntryKinds();
    kinds.register('test', productKind(widgetId, { classify: () => ({ verboseOnly: true }) }));
    const feed = new VisibleFeed(kinds);
    const entries = [user('u1'), widget('w1')];

    expect(shownIds(feed, entries, false)).toEqual(['u1']);
    expect(shownIds(feed, entries, true)).toEqual(['u1', 'w1']);
  });
});
