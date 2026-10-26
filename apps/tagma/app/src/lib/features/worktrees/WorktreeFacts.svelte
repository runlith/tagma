<script lang="ts">
  import type { WorktreePlace, WorktreeRow } from '@tagma/server/worktrees/contract/wire/rows';
  import type { ClassValue } from 'svelte/elements';
  import AgentCounts from '$lib/shared/ui/AgentCounts.svelte';
  import { Worktrees } from './BoardState.svelte.js';
  import { STATUS_WORDS } from './tone.js';
  import FactStamp from './FactStamp.svelte';

  let {
    row: place,
    facts,
    unread,
    diffClass = '',
    class: className = '',
  }: {
    row: WorktreePlace;
    facts?: WorktreeRow | null;
    unread?: string | null;
    diffClass?: ClassValue;
    class?: ClassValue;
  } = $props();

  const reading = Worktrees.use().window();
  const row = $derived(facts === undefined ? reading.rowOf(place.rootId) : facts);
  const status = $derived(row === null ? null : STATUS_WORDS[row.status]);
  const agents = $derived(place.agents.working + place.agents.waiting);
</script>

<span
  class={['flex shrink-0 items-center gap-1.5 text-small leading-none', className]}
  data-worktree-facts
  {@attach facts === undefined ? reading.observe(place.rootId) : undefined}
>
  {#if (unread ?? reading.unread) !== null}
    <span class="text-destructive" title={unread ?? reading.unread ?? undefined}>updates stopped</span>
  {/if}
  {#if place.missing}
    <span class="text-destructive">missing</span>
  {:else if agents === 0}
    {#if row === null}
      <span class="text-muted-foreground">not taken</span>
    {:else if row.stateFact.state === 'current' && (row.kind !== 'tagma' || row.mergeFact.state === 'current') && status !== null}
      <span class={['whitespace-nowrap', status.ink]} data-worktree-status={row.status}>{status.word}</span>
    {:else}
      <FactStamp fact={row.stateFact.state === 'current' ? row.mergeFact : row.stateFact} head={place.head} compact />
    {/if}
  {/if}
  <AgentCounts waiting={place.agents.waiting} working={place.agents.working} />
  {#if agents > 0 && row !== null && row.stateFact.state !== 'current'}
    <FactStamp fact={row.stateFact} head={place.head} compact />
  {/if}
  {#if row !== null && row.stateFact.state !== 'untaken'}
    {#if row.diff !== null && (row.diff.added > 0 || row.diff.removed > 0)}
      <span class={['whitespace-nowrap font-mono text-meta tabular text-muted-foreground', diffClass]}>
        <span class="text-status-done">+{row.diff.added}</span>
        <span class="text-destructive/80">−{row.diff.removed}</span>
      </span>
    {/if}
    {#if row.ahead !== null && row.ahead > 0}
      <span class={['whitespace-nowrap font-mono text-meta tabular text-muted-foreground', diffClass]}>↑{row.ahead}</span>
    {/if}
    {#if row.behind !== null && row.behind > 0}
      <span class={['whitespace-nowrap font-mono text-meta tabular text-status-stale', diffClass]}>↓{row.behind}</span>
    {/if}
  {/if}
</span>
