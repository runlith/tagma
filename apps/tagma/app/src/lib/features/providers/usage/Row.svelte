<script lang="ts">
  import ProviderMark from '$lib/features/providers/Mark.svelte';
  import type { UsageProvider } from './Accounts.svelte.js';
  import { ProviderCatalog } from '../Catalog.svelte.js';
  import { readingAt, updatedAgo, usageStatus } from '../accounts/status.js';
  import { figureTone } from './thresholds.js';
  import { toneFill, toneText } from '../accounts/tone.js';
  import Bar from '$lib/shared/ui/Bar.svelte';
  import FadeText from '$lib/shared/FadeText.svelte';
  import { resetText, tightestFigure, usageFigures, usagePercentText, type UsageFigure } from './windows.js';

  let {
    entry,
    now,
    status,
    action = null,
  }: {
    entry: UsageProvider;
    now: number;
    status: string | null;
    action?: string | null;
  } = $props();

  const catalog = ProviderCatalog.use();
  const figures = $derived(usageFigures(entry.standing.quota));
  const plan = $derived(planLabel(entry.standing.quota?.plan));
  const stale = $derived(usageStatus(entry.standing, entry.served, now).stale);
  const read = $derived(readingAt(entry.standing));
  const limit = $derived(tightestFigure(figures));
  const state = $derived.by(() => {
    if (stale) return read === null ? null : `updated ${updatedAgo(read, now)}`;
    if (limit === null || limit.resetsAt === null) return null;
    return `${limit.name ?? limit.kind} resets in ${resetText(limit.resetsAt, now)}`;
  });

  function planLabel(plan: string | undefined): string | null {
    const words =
      plan
        ?.trim()
        .split(/[\s_-]+/)
        .filter((word) => word !== '') ?? [];
    if (words.length === 0) return null;
    return words
      .map((word) => {
        const lower = word.toLowerCase();
        return lower === 'chatgpt' ? 'ChatGPT' : lower.charAt(0).toUpperCase() + lower.slice(1);
      })
      .join(' ');
  }
</script>

{#snippet metric(figure: UsageFigure)}
  {@const tone = figureTone(figure, now)}
  <span class="flex shrink-0 items-center gap-1.5" data-usage-mini>
    <span class="text-meta text-muted-foreground">{figure.name ?? figure.kind}</span>
    <Bar used={figure.usedPercent} color={toneFill(tone)} class="h-1.25 w-7" />
    <span class="text-meta tabular-nums {toneText(tone)}">{usagePercentText(figure.usedPercent)}</span>
  </span>
{/snippet}

<span class="flex min-w-0 flex-1 flex-col gap-1">
  <span class="flex items-center gap-3">
    <span class="grid size-5 shrink-0 place-items-center rounded-md border border-border bg-hover">
      <ProviderMark provider={entry.provider} titled={false} class="size-3 text-foreground" />
    </span>
    <FadeText class="shrink text-ui font-medium text-foreground">
      {catalog.name(entry.provider)}{#if plan !== null}<span class="ml-1.5 font-normal text-muted-foreground">{plan}</span>{/if}
    </FadeText>
    {#if figures.length === 0}
      {#if status !== null}
        <FadeText class="text-small text-muted-foreground" text={status} />
      {/if}
      {#if action !== null}
        <span class="ml-auto shrink-0 rounded-md border border-border bg-hover px-3 py-0.5 text-small text-foreground">
          {action}
        </span>
      {/if}
    {:else if state !== null}
      <span class="ml-auto shrink-0 text-meta tabular-nums text-muted-foreground" data-usage-state>{state}</span>
    {/if}
  </span>
  {#if figures.length > 0}
    <span class={['flex flex-wrap items-center gap-x-3 gap-y-1 pl-8 transition-opacity', stale && 'opacity-45']}>
      {#each figures as figure (figure.kind + (figure.name ?? ''))}
        {@render metric(figure)}
      {/each}
    </span>
  {/if}
</span>
