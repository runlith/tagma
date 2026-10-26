<script lang="ts">
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Settings from '@lucide/svelte/icons/settings';
  import type { ThreadCompositionReading } from '@tagma/server/threads/contract/wire/snapshot';
  import type { ThreadCacheWarmth } from '@runlith/agent/thread/cache/ThreadCacheWarmth';
  import { limitTokens } from '@runlith/agent/thread/compaction/limit';
  import {
    CHAT_CONTEXT_SEGMENT_STEPS,
    type ChatContextUsageMetrics,
    formatContextPercent,
    formatContextTokens,
  } from '@runlith/chat-ui/contextUsage';
  import Waiting from '@runlith/chat-ui/Waiting.svelte';
  import { mcpToolNamed } from '@runlith/mcp/identity';
  import { untrack } from 'svelte';
  import { Router } from '@runlith/layer/Router';
  import { settingsHref } from '$lib/features/workspace/address.js';
  import { WallClock } from '$lib/features/workspace/WallClock.svelte.js';
  import FadeText from '$lib/shared/FadeText.svelte';
  import { ContextPanelState } from './PanelState.svelte.js';
  import { cacheWord, warmthFilled } from '../warmthWords.js';

  type Props = {
    composition: ThreadCompositionReading | null;
    usage: ChatContextUsageMetrics | null;
    failure: string | null;
    warmth: ThreadCacheWarmth | null;
    onOpen(): void;
  };

  let { composition, usage, failure, warmth, onOpen }: Props = $props();

  const wallClock = WallClock.use();
  $effect(() => (warmth?.basis === 'promise' ? wallClock.watch() : undefined));
  const cache = $derived(warmth === null ? null : cacheWord(warmth, () => wallClock.now));
  const warm = $derived(warmthFilled(warmth, () => wallClock.now));

  const state = ContextPanelState.use();
  const router = Router.use();
  const agentSettings = $derived(settingsHref(router, 'agent'));

  $effect(() => {
    void usage?.contextTokens;
    untrack(() => onOpen());
  });

  type PartId = ThreadCompositionReading['parts'][number]['id'];
  type Part = 'system' | 'tools' | 'orientation' | 'conversation';

  const TONE: Record<Part, string> = {
    conversation: CHAT_CONTEXT_SEGMENT_STEPS[0],
    orientation: CHAT_CONTEXT_SEGMENT_STEPS[1],
    tools: CHAT_CONTEXT_SEGMENT_STEPS[2],
    system: CHAT_CONTEXT_SEGMENT_STEPS[3],
  };
  const FOLD = 'mb-1 ml-0.5 grid grid-cols-1 border-l border-border pl-3';
  const ROW = '-mx-1.5 flex h-6 min-w-0 items-center justify-between gap-2 rounded-md px-1.5 text-left transition-colors hover:bg-hover';

  const CONVERSATION_ROWS: readonly { id: PartId; label: string; watched: boolean }[] = [
    { id: 'user', label: 'Your messages', watched: true },
    { id: 'assistant', label: 'Agent text', watched: false },
    { id: 'reasoning', label: 'Reasoning replayed', watched: false },
    { id: 'toolCall', label: 'Tool calls', watched: false },
    { id: 'toolOutput', label: 'Tool output, live', watched: true },
    { id: 'guidance', label: 'Guidance', watched: false },
    { id: 'envelope', label: 'Agent envelopes', watched: false },
    { id: 'summary', label: 'Compaction summaries', watched: false },
  ];

  const HEAVIEST = 5;

  type ToolSchema = ThreadCompositionReading['tools'][number];
  type ToolOwnerGroup = {
    readonly id: string;
    readonly label: string;
    readonly schemas: readonly ToolSchema[];
    readonly tokens: number;
  };

  const parts = $derived(new Map((composition?.parts ?? []).map((entry) => [entry.id, entry])));
  const estimated = $derived(composition?.reading === 'estimated');
  const limit = $derived(usage?.limit ?? composition?.limit ?? null);
  const ceiling = $derived(limit === null ? 0 : limitTokens(limit));
  const compaction = $derived.by(() => {
    const threshold = limit?.compaction;
    if (limit == null || threshold == null) return null;
    const origin =
      threshold.source === 'override'
        ? `your override for ${usage?.modelLabel || 'this model'}`
        : threshold.source === 'row'
          ? 'this model’s default'
          : 'your setting';
    return { share: formatContextPercent((threshold.at / limit.window) * 100), window: limit.window, origin };
  });

  function part(id: PartId): { count: number; tokens: number } {
    return parts.get(id) ?? { count: 0, tokens: 0 };
  }

  function share(percent: number): string {
    if (percent > 0 && percent < 0.05) return '<1%';
    if (percent < 100 && percent >= 99.5) return '>99%';
    return formatContextPercent(percent);
  }

  function tokens(value: number): string {
    return formatContextTokens(value);
  }

  function more(count: number): string {
    return `${count} more ${count === 1 ? 'tool' : 'tools'}`;
  }

  function cleared(figure: number): string {
    return figure > 0 ? `−${tokens(figure)}` : '';
  }

  const conversation = $derived.by(() => {
    const rows = CONVERSATION_ROWS.map((row) => part(row.id));
    return {
      count: rows.reduce((sum, row) => sum + row.count, 0),
      tokens: rows.reduce((sum, row) => sum + row.tokens, 0),
    };
  });

  const rows = $derived.by(() => {
    const tools = part('tools');
    return [
      { id: 'system' as const, label: 'System prompt', badge: '', ...part('system'), opens: false },
      {
        id: 'tools' as const,
        label: 'Tools',
        ...tools,
        badge: tools.count > 0 ? String(tools.count) : '',
        opens: (composition?.tools.length ?? 0) > 0,
      },
      {
        id: 'orientation' as const,
        label: 'Orientation',
        badge: '',
        ...part('orientation'),
        opens: (composition?.orientation.length ?? 0) > 0,
      },
      { id: 'conversation' as const, label: 'Conversation', badge: '', ...conversation, opens: true },
    ];
  });

  const fill = $derived.by(() => {
    if (usage && usage.reading !== 'unknown' && usage.usagePercent !== undefined) return usage.usagePercent / 100;
    const total = composition?.total ?? 0;
    if (ceiling > 0) return Math.min(1, total / ceiling);
    return total > 0 ? 1 : 0;
  });

  const bands = $derived(rows.filter((row) => row.tokens > 0));

  const toolOwnerGroups = $derived.by((): readonly ToolOwnerGroup[] => {
    const groups = new Map<string, { label: string; schemas: ToolSchema[] }>();
    for (const schema of composition?.tools ?? []) {
      const named = mcpToolNamed(schema.name);
      const id = named ? `mcp:${named.server}` : 'builtins';
      const group = groups.get(id) ?? { label: named?.server ?? 'Built-ins', schemas: [] };
      group.schemas.push(schema);
      groups.set(id, group);
    }
    return [...groups]
      .map(([id, group]) => ({
        id,
        label: group.label,
        schemas: group.schemas,
        tokens: group.schemas.reduce((sum, schema) => sum + schema.tokens, 0),
      }))
      .sort((left, right) => right.tokens - left.tokens || left.label.localeCompare(right.label));
  });

  const toolsHaveOwners = $derived(toolOwnerGroups.some((group) => group.id.startsWith('mcp:')));

  function remainder(schemas: readonly ToolSchema[]): { count: number; tokens: number } {
    const rest = schemas.slice(HEAVIEST);
    return { count: rest.length, tokens: rest.reduce((sum, schema) => sum + schema.tokens, 0) };
  }

  const restOfTools = $derived(remainder(composition?.tools ?? []));

  const restOfCalls = $derived.by(() => {
    const rest = (composition?.ledger.toolCalls ?? []).slice(HEAVIEST);
    return { kinds: rest.length, calls: rest.reduce((sum, call) => sum + call.count, 0) };
  });

  const cacheHit = $derived.by(() => {
    const ledger = composition?.ledger;
    if (!ledger || ledger.inputTokens <= 0) return null;
    return share((ledger.cacheReadTokens / ledger.inputTokens) * 100);
  });

  const hit = $derived.by(() => {
    if (!usage || usage.reading === 'unknown') return null;
    const presented = usage.inputTokens;
    const served = usage.cacheReadInputTokens;
    if (presented === undefined || presented <= 0 || served === undefined) return null;
    return share((served / presented) * 100);
  });

  const bill = $derived.by(() => {
    if (!usage) return [];
    const figures: readonly [number | undefined, string][] = [
      [usage.nonCachedInputTokens, 'new input'],
      [usage.cacheReadInputTokens, 'cache read'],
      [usage.cacheWriteInputTokens, 'cache write'],
      [usage.visibleOutputTokens, 'output'],
      [usage.reasoningTokens || undefined, 'reasoning'],
    ];
    return figures.flatMap(([figure, word]) => (figure === undefined ? [] : [{ figure: tokens(figure), word }]));
  });

  const threadOpen = $derived(state.isOpen('thread'));
  const detailsOpen = $derived(state.isOpen('details'));
</script>

{#snippet line(row: { label: string; count?: number; value: string; watched?: boolean })}
  <div class={['flex min-w-0 items-baseline justify-between gap-2 py-0.5', row.watched && 'text-foreground']}>
    <FadeText text={row.label} />
    <span class="flex shrink-0 items-baseline gap-2 font-mono tabular-nums">
      <span class="w-9 text-right text-meta text-muted-foreground">{(row.count ?? 0) > 0 ? row.count : ''}</span>
      <span class={['w-14 text-right', row.watched ? 'font-medium text-foreground' : 'text-foreground/85']}>{row.value}</span>
    </span>
  </div>
{/snippet}

{#snippet stats(items: readonly { figure: string; word: string }[])}
  <div class="grid grid-cols-5 gap-x-2">
    {#each items as item (item.word)}
      <div class="grid min-w-0 gap-0.5" data-stat>
        <FadeText class="font-mono tabular-nums text-foreground" text={item.figure} />
        <FadeText class="text-meta" text={item.word} />
      </div>
    {/each}
  </div>
{/snippet}

{#snippet chevron(open: boolean)}
  <ChevronRight class={['size-3 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90']} />
{/snippet}

{#snippet head(row: { id: Part; label: string; badge: string; tokens: number; opens: boolean }, open: boolean)}
  <span class="flex min-w-0 items-center gap-2">
    <span class={['size-1.5 shrink-0', TONE[row.id]]}></span>
    <FadeText class="text-ui text-foreground" text={row.label} />
    {#if row.badge}<span class="shrink-0 font-mono text-meta text-muted-foreground">{row.badge}</span>{/if}
    {#if row.opens}{@render chevron(open)}{/if}
  </span>
  <span class="flex shrink-0 items-baseline font-mono tabular-nums">
    <span class="text-small text-foreground">{estimated ? '~' : ''}{tokens(row.tokens)}</span>
  </span>
{/snippet}

<div class="grid grid-cols-1 gap-2 text-left text-small text-muted-foreground" data-context-detail>
  {#if compaction !== null}
    <a
      href={agentSettings}
      class="-mx-1.5 flex min-w-0 rounded-md px-1.5 py-0.5 transition-colors hover:bg-hover hover:text-foreground"
      data-compaction
    >
      <FadeText>
        Compacts at {compaction.share} of the {tokens(compaction.window)} window
        <span class="text-muted-foreground/70">{compaction.origin}</span>
      </FadeText>
    </a>
  {/if}

  {#if composition}
    <div class="flex h-2 min-w-0 bg-vein" data-composition={composition.reading}>
      {#if fill > 0}
        <div class={['flex h-full gap-px overflow-hidden', estimated && 'opacity-60']} style:width={`${fill * 100}%`} data-fill>
          {#each bands as band (band.id)}
            <div class={['h-full min-w-0 basis-0', TONE[band.id]]} style:flex-grow={band.tokens} data-band={band.id}></div>
          {/each}
        </div>
      {/if}
    </div>

    <div class="grid grid-cols-1">
      {#each rows as row (row.id)}
        {@const open = state.isOpen(row.id)}
        {#if row.opens}
          <button type="button" aria-expanded={open} class={ROW} onclick={() => state.toggle(row.id)}>
            {@render head(row, open)}
          </button>
        {:else}
          <div class="flex h-6 min-w-0 items-center justify-between gap-2">
            {@render head(row, false)}
          </div>
        {/if}

        {#if open}
          <div class={FOLD}>
            {#if row.id === 'tools'}
              {#if toolsHaveOwners}
                {#each toolOwnerGroups as group (group.id)}
                  {@const groupOpen = state.isOpen(`tools:${group.id}`)}
                  {@const rest = remainder(group.schemas)}
                  <button type="button" aria-expanded={groupOpen} class={ROW} onclick={() => state.toggle(`tools:${group.id}`)}>
                    <span class="flex min-w-0 items-center gap-1.5">
                      <FadeText text={group.label} />
                      {@render chevron(groupOpen)}
                    </span>
                    <span class="flex shrink-0 items-baseline gap-2 font-mono tabular-nums">
                      <span class="w-9 text-right text-meta text-muted-foreground">{group.schemas.length}</span>
                      <span class="w-14 text-right text-foreground/85">{tokens(group.tokens)}</span>
                    </span>
                  </button>
                  {#if groupOpen}
                    <div class={FOLD}>
                      {#each group.schemas.slice(0, HEAVIEST) as schema (schema.name)}
                        {@render line({ label: schema.name, value: tokens(schema.tokens) })}
                      {/each}
                      {#if rest.count > 0}
                        {@render line({ label: more(rest.count), value: tokens(rest.tokens) })}
                      {/if}
                    </div>
                  {/if}
                {/each}
              {:else}
                {#each composition.tools.slice(0, HEAVIEST) as tool (tool.name)}
                  {@render line({ label: tool.name, value: tokens(tool.tokens) })}
                {/each}
                {#if restOfTools.count > 0}
                  {@render line({ label: more(restOfTools.count), value: tokens(restOfTools.tokens) })}
                {/if}
              {/if}
              {#if composition.deferredTools.length > 0}
                {@render line({ label: 'Deferred, names only', value: String(composition.deferredTools.length) })}
              {/if}
            {:else if row.id === 'orientation'}
              {#each composition.orientation as section (section.name)}
                {@render line({ label: section.name, value: tokens(section.tokens) })}
              {/each}
            {:else if row.id === 'conversation'}
              {#each CONVERSATION_ROWS as entry (entry.id)}
                {@const measured = part(entry.id)}
                {@render line({ label: entry.label, count: measured.count, value: tokens(measured.tokens), watched: entry.watched })}
              {/each}
              {@render line({
                label: 'Tool output, cleared',
                count: composition.cleared.count,
                value: cleared(composition.cleared.tokens),
              })}
            {/if}
          </div>
        {/if}
      {/each}
    </div>
  {:else if failure}
    <div class="break-words text-destructive" role="alert">{failure}</div>
  {:else}
    <div class="flex h-6 items-center" aria-label="Reading the composition"><Waiting class="size-3" /></div>
  {/if}

  {#if cache !== null || hit !== null}
    <div class="flex min-w-0 items-center gap-2 border-t border-border pt-2" data-cache>
      <span class="w-24 shrink-0">Cache</span>
      {#if cache !== null}
        <span
          class={['size-1.5 shrink-0', warm ? 'bg-muted-foreground' : 'border border-muted-foreground']}
          data-warmth={warm ? 'warm' : 'cold'}
        ></span>
        <FadeText class="text-ui text-foreground" text={cache} />
      {/if}
      {#if hit !== null}
        <span class="ml-auto shrink-0 pl-2">last hit <span class="font-mono tabular-nums text-foreground">{hit}</span></span>
      {/if}
    </div>
  {/if}

  {#if composition}
    <div class="grid grid-cols-1 border-t border-border pt-1">
      <button type="button" aria-expanded={detailsOpen} class={ROW} onclick={() => state.toggle('details')}>
        <span class="flex items-center gap-1.5">Details{@render chevron(detailsOpen)}</span>
      </button>

      {#if detailsOpen}
        <div class="grid grid-cols-1 gap-3 pt-1.5" data-details>
          {#if bill.length > 0}
            <div class="grid grid-cols-1 gap-1.5" data-bill>
              <span>Last request</span>
              {@render stats(bill)}
            </div>
          {/if}

          <div class="grid grid-cols-1 gap-1.5" data-pruning>
            <span class="flex h-5 items-center gap-2">
              Tool output
              <a
                href={agentSettings}
                class="ml-auto grid size-5 place-items-center rounded-md transition-colors hover:bg-hover hover:text-foreground"
                aria-label="Tool output setting"
              >
                <Settings class="size-3" />
              </a>
            </span>
            {@render stats([
              { figure: tokens(composition.pruning.liveToolOutputTokens), word: 'live' },
              { figure: tokens(composition.pruning.protectedTokens), word: 'kept whole' },
              { figure: tokens(composition.pruning.nextPruneAtTokens), word: 'cleared at' },
            ])}
          </div>

          <button type="button" aria-expanded={threadOpen} class={ROW} onclick={() => state.toggle('thread')}>
            <span class="flex min-w-0 items-center gap-1.5">This thread{@render chevron(threadOpen)}</span>
            <span class="shrink-0"><span class="font-mono tabular-nums text-foreground">{composition.ledger.runs}</span> runs</span>
          </button>

          {#if threadOpen}
            <div class={FOLD}>
              {@render line({ label: 'Compactions', value: String(composition.ledger.compactions) })}
              {@render line({ label: 'Cleared results', count: composition.cleared.count, value: cleared(composition.cleared.tokens) })}
              {@render line({ label: 'Read in total', value: tokens(composition.ledger.inputTokens) })}
              {#if cacheHit}
                {@render line({ label: 'Cache hit', value: cacheHit })}
              {/if}
              {#if composition.ledger.toolCalls.length > 0}
                <div class="pt-1 text-muted-foreground/70">Calls by tool</div>
                {#each composition.ledger.toolCalls.slice(0, HEAVIEST) as call (call.name)}
                  {@render line({ label: call.name, value: String(call.count) })}
                {/each}
                {#if restOfCalls.kinds > 0}
                  {@render line({ label: more(restOfCalls.kinds), value: `${restOfCalls.calls} calls` })}
                {/if}
              {/if}
            </div>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</div>
