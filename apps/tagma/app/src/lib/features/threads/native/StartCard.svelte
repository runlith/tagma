<script lang="ts">
  import Gauge from '@lucide/svelte/icons/gauge';
  import type { StartEntry } from '@tagma/server/native-harness/contract/wire/start';
  import { formatContextPercent, formatContextTokens } from '@runlith/chat-ui/contextUsage';

  let { start }: { start: StartEntry } = $props();

  const LABELS: Record<StartEntry['parts'][number]['id'], string> = {
    system: 'System prompt',
    tools: 'Tool schemas loaded at once',
    law: 'Law',
    vocabulary: 'Vocabulary',
    graph: 'Graph note and map',
    workspace: 'Workspace note',
    deferred: 'Deferred tool list',
  };

  const rows = $derived(start.parts.filter((part) => part.chars !== 0));
  const chars = (value: number): string => value.toLocaleString('en');
</script>

<div class="my-1 grid max-w-xl gap-1.5 rounded-lg border bg-raised px-3 py-2 text-ui" data-start-cost={start.chars}>
  <div class="flex min-w-0 items-center gap-2">
    <Gauge class="size-3.5 shrink-0 text-muted-foreground" />
    <span class="shrink-0 font-medium">Costly start</span>
    <span class="min-w-0 truncate text-muted-foreground">
      {chars(start.chars)} characters ≈ {formatContextTokens(start.tokens)} tokens, over {formatContextPercent(start.share * 100)} of the
      {formatContextTokens(start.window)} window
    </span>
  </div>
  <ul class="grid gap-0.5 text-small">
    {#each rows as row (row.id)}
      <li class="flex items-baseline justify-between gap-4">
        <span class="text-muted-foreground">{LABELS[row.id]}</span>
        {#if row.chars === null}
          <span class="text-muted-foreground">not read</span>
        {:else}
          <span class="font-mono tabular-nums">{chars(row.chars)}</span>
        {/if}
      </li>
    {/each}
  </ul>
  {#if start.inputTokens !== null}
    <p class="text-small text-muted-foreground">The first request read {chars(start.inputTokens)} input tokens.</p>
  {/if}
</div>
