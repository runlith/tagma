<script lang="ts">
  import type { ClassValue } from 'svelte/elements';
  import { workDone, workLeft, workShare, type Background } from '$lib/features/executions/load/rows.js';
  import FadeText from '$lib/shared/FadeText.svelte';
  import LoadBar from './LoadBar.svelte';

  let { work, class: className }: { work: Background; class?: ClassValue } = $props();

  const share = $derived(workShare(work));
</script>

<div class={['grid gap-1', className]} data-load-background={work.id}>
  <FadeText class="font-medium" text={work.title} />
  <FadeText class="text-meta text-muted-foreground" text={work.reason} title={work.reason} />
  {#if share !== null}
    <LoadBar taken={share} />
  {/if}
  <span class="flex justify-between gap-2 text-meta text-muted-foreground tabular-nums">
    <span class="stamp">{workDone(work)}</span><span>{workLeft(work)}</span>
  </span>
</div>
