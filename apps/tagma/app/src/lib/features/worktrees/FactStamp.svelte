<script lang="ts">
  import type { WorktreeFact } from '@tagma/server/worktrees/contract/wire/rows';
  import { timeCompact } from '$lib/shared/time.js';

  let { fact, head, compact = false }: { fact: WorktreeFact; head: string | null; compact?: boolean } = $props();

  let now = $state(Date.now());
  $effect(() => {
    if (fact.baseTime === null || fact.state === 'current' || fact.state === 'untaken') return;
    const timer = setInterval(() => (now = Date.now()), 60_000);
    return () => clearInterval(timer);
  });

  const base = $derived(fact.base === null ? null : fact.base.slice(0, 7));
  const age = $derived(fact.baseTime === null ? null : timeCompact(new Date(fact.baseTime).toISOString(), now));
  const title = $derived(
    [
      `Fact: ${fact.state}`,
      fact.head === null ? null : `HEAD ${fact.head}`,
      fact.indexStamp === undefined ? null : `Index ${fact.indexStamp}`,
      fact.driverRevision === undefined ? null : `Graph driver ${fact.driverRevision}`,
      fact.fingerprint === undefined ? null : `Merge configuration ${fact.fingerprint}`,
      fact.base === null ? null : `Base ${fact.base}`,
      fact.baseTime === null ? null : `Base committed ${new Date(fact.baseTime).toLocaleString()}`,
      fact.takenAt === null ? null : `Taken ${new Date(fact.takenAt).toLocaleString()}`,
    ]
      .filter((part) => part !== null)
      .join('\n'),
  );
</script>

<span
  class={[
    'inline-flex items-center gap-1 whitespace-nowrap text-meta',
    fact.state === 'previous' ? 'text-status-stale' : 'text-muted-foreground',
  ]}
  data-worktree-fact={fact.state}
  {title}
>
  {#if fact.state === 'current'}
    {#if !compact}current{/if}
  {:else if fact.state === 'untaken'}
    not taken
  {:else}
    {#if fact.state === 'queued'}<span>queued</span>{:else}<span>{fact.head !== head ? 'previous HEAD' : 'previous'}</span>{/if}
    {#if fact.head !== null && fact.head !== head}<span class="font-mono">{fact.head.slice(0, 7)}</span>{/if}
    {#if base !== null}
      <span>base</span>
      <span class="font-mono">{base}</span>
    {/if}
    {#if age !== null}<span>{age === 'now' ? 'just committed' : `${age} old`}</span>{/if}
  {/if}
</span>
