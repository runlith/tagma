<script lang="ts">
  import Bar from '$lib/shared/ui/Bar.svelte';
  import { formatSpan } from '$lib/shared/figures.js';
  import { WallClock } from '$lib/features/workspace/WallClock.svelte.js';

  let { admittedAt, budgetMs }: { admittedAt: number; budgetMs: number } = $props();

  const clock = WallClock.use();
  $effect(() => clock.watch());

  const waited = $derived(Math.max(0, clock.now - admittedAt));
  const share = $derived(Math.min(100, (waited / budgetMs) * 100));
</script>

<span
  class="ml-1 inline-flex shrink-0 items-baseline gap-2 font-mono text-meta text-muted-foreground/60 tabular-nums"
  title="How long the agent has waited, of the most it waits before it reads what is there"
  data-wait-status
>
  <Bar used={share} color="var(--status-in-work)" class="h-0.5 w-10 shrink-0 self-center" />
  <span>waited <span class="text-muted-foreground/90">{formatSpan(waited)}</span> of {formatSpan(budgetMs)}</span>
</span>
