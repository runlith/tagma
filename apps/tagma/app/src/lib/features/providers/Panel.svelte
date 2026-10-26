<script lang="ts">
  import ProviderMark from '$lib/features/providers/Mark.svelte';
  import type { UsageProvider } from './usage/Accounts.svelte.js';
  import { ProviderCatalog } from './Catalog.svelte.js';
  import { failureReason, readingAt, updatedAgo, usageStatus } from './accounts/status.js';
  import { figureTone } from './usage/thresholds.js';
  import { toneFill } from './accounts/tone.js';
  import Bar from '$lib/shared/ui/Bar.svelte';
  import { resetText, usageFigures, usagePercentText, type UsageFigure } from './usage/windows.js';

  let { entry, now }: { entry: UsageProvider; now: number } = $props();

  const catalog = ProviderCatalog.use();

  const row = $derived(entry.standing);
  const figures = $derived(usageFigures(row.quota));
  const status = $derived(usageStatus(row, entry.served, now));
  const read = $derived(readingAt(row));
  const reason = $derived(sentence(failureReason(row, entry.served)));
  const credits = $derived(row.quota?.resetCredits ?? null);

  function title(figure: UsageFigure): string {
    switch (figure.kind) {
      case 'session':
        return 'Session';
      case 'weekly':
        return 'Weekly';
      case 'monthly':
        return 'Monthly';
      case 'model':
      case 'bucket':
        return figure.name ?? figure.kind;
    }
  }

  function sentence(text: string | null): string | null {
    return text === null ? null : text.charAt(0).toUpperCase() + text.slice(1);
  }
</script>

<div class="space-y-3 text-small" data-provider-panel={entry.provider}>
  <div>
    <div class="flex items-center gap-1.5 text-ui font-medium text-foreground">
      <ProviderMark provider={entry.provider} titled={false} class="size-3.5" />
      {catalog.name(entry.provider)}
    </div>
    <div class="text-muted-foreground/80">{read === null ? 'Not yet updated' : `Updated ${updatedAgo(read, now)}`}</div>
    {#if credits !== null && credits > 0}
      <div class="text-muted-foreground">
        {credits === 1 ? '1 rate-limit reset available' : `${credits} rate-limit resets available`}
      </div>
    {/if}
  </div>

  {#if figures.length === 0}
    <div class="space-y-0.5">
      <div class="text-small font-medium text-foreground/85">{status.word ?? 'No usage data'}</div>
      {#if reason !== null}
        <div class="text-muted-foreground">{reason}</div>
      {/if}
    </div>
  {:else}
    <div class="border-t border-border/70"></div>
    {#each figures as figure (figure.kind + (figure.name ?? ''))}
      <div class="space-y-1" data-usage-window>
        <div class="font-medium text-foreground">{title(figure)}</div>
        <Bar used={figure.usedPercent} color={toneFill(figureTone(figure, now))} class="h-1.5 w-full" />
        <div class="flex justify-between text-muted-foreground tabular-nums">
          <span>{usagePercentText(figure.usedPercent)} used</span>
          {#if figure.resetsAt !== null}
            <span>Resets in {resetText(figure.resetsAt, now)}</span>
          {/if}
        </div>
      </div>
    {/each}
    {#if reason !== null}
      <div class="space-y-0.5" data-usage-note>
        <div class="text-small font-medium text-foreground/85">Couldn't refresh — showing the last reading</div>
        <div class="text-muted-foreground">{reason}</div>
      </div>
    {/if}
  {/if}
</div>
