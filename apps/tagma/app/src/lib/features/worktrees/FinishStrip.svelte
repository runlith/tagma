<script lang="ts">
  import AlertTriangle from '@lucide/svelte/icons/triangle-alert';
  import MergeFact from './MergeFact.svelte';
  import FactStamp from './FactStamp.svelte';
  import GitMerge from '@lucide/svelte/icons/git-merge';
  import GitPullRequest from '@lucide/svelte/icons/git-pull-request';
  import Waiting from '@runlith/chat-ui/Waiting.svelte';
  import type { WorktreePlace } from '@tagma/server/worktrees/contract/wire/rows';
  import { Button } from '$lib/shared/ui/button/index.js';
  import ActLine from './ActLine.svelte';
  import { Worktrees } from './BoardState.svelte.js';
  import { baseName } from './BaseReading.svelte.js';
  import { Finishing } from './Finishing.svelte.js';
  import OutcomeLine from './OutcomeLine.svelte';

  let { row }: { row: WorktreePlace } = $props();

  const finishing = Finishing.use();
  const reading = Worktrees.use().window();
  const facts = $derived(reading.rowOf(row.rootId));
  const conflicts = $derived(facts?.mergeFact.state === 'current' && facts.check === 'conflicts');

  const into = $derived(baseName(row));
  const flight = $derived(finishing.inFlight(row.rootId));
  const acting = $derived(flight?.act ?? null);
  const outcome = $derived(flight === null ? finishing.outcomeOf(row.rootId) : null);
  const pending = $derived(row.pending);
  const waiting = $derived(pending?.state === 'waiting');
  const pullRequest = $derived(finishing.pullRequests.get(row.rootId) ?? null);
  const named = $derived(row.base?.branch != null);
  const busy = $derived(row.agents.working + row.agents.waiting);
</script>

<div
  class="grid shrink-0 gap-1.5 border-t bg-chrome px-3 py-2 text-small"
  data-finish-strip={row.name}
  {@attach reading.observe(row.rootId)}
>
  {#if flight !== null}
    <ActLine {flight} class="text-small" />
  {:else if outcome !== null}
    <OutcomeLine {outcome} class="text-small" />
  {/if}
  {#if reading.unread !== null}<span class="text-destructive">Updates stopped: {reading.unread}</span>{/if}
  <div class="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-muted-foreground">
    <span>Merge into {into}</span>
    {#if facts !== null}<MergeFact row={facts} />{:else}<span>not taken</span>{/if}
  </div>
  {#if (facts?.uncommitted ?? 0) > 0}
    <span class="flex items-center gap-1.5 text-muted-foreground">
      <AlertTriangle class="size-3.5 text-status-stale" />{facts?.uncommitted} uncommitted {facts?.uncommitted === 1 ? 'path' : 'paths'} in the
      worktree
      {#if facts !== null}<FactStamp fact={facts.stateFact} head={row.head} />{/if}
    </span>
  {/if}
  {#if busy > 0}
    <span class="flex items-center gap-1.5 text-status-in-work" data-finish-strip-busy={busy}>
      <span class="ml-1 size-1.5 rounded-full bg-status-in-work"></span>
      {busy === 1 ? '1 agent is still working here' : `${busy} agents are still working here`}
    </span>
  {/if}
  {#if pending !== null}
    <div class="grid gap-0.5" data-finish-strip-pending={pending.state}>
      <span class="flex items-center gap-1.5 text-muted-foreground">
        {#if waiting}
          <Waiting class="size-3.5" />Merges when {into} is free
        {:else}
          <AlertTriangle class="size-3.5 text-status-stale" />The merge waiting for {into} stopped
        {/if}
        <button
          type="button"
          class="text-foreground underline-offset-4 hover:underline"
          disabled={acting !== null}
          onclick={() => void finishing.cancelMerge(row)}
        >
          {waiting ? 'Stop' : 'Dismiss'}
        </button>
      </span>
      {#if pending.refusal !== null}
        <span class="pl-5 text-small text-muted-foreground">{pending.refusal.message}</span>
      {/if}
    </div>
  {/if}
  <div class="flex items-center gap-1.5">
    {#if !conflicts}
      <Button
        size="sm"
        class="h-7 gap-1.5 text-small"
        disabled={acting !== null || waiting || !named}
        onclick={() => finishing.askMerge(row)}
        data-finish-merge
      >
        <GitMerge class="size-3.5" />
        {acting === 'merge' ? 'Merging…' : 'Merge…'}
      </Button>
    {/if}
    {#if conflicts || (facts?.behind ?? 0) > 0}
      <Button
        size="sm"
        variant="outline"
        class="h-7 text-small"
        disabled={acting !== null || !named}
        onclick={() => void finishing.update(row)}
      >
        Update from {into}
      </Button>
    {/if}
    {#if pullRequest !== null}
      <a
        href={pullRequest}
        target="_blank"
        rel="noopener noreferrer"
        class="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-small text-muted-foreground hover:bg-hover hover:text-foreground"
      >
        <GitPullRequest class="size-3.5" />Pull request
      </a>
    {:else}
      <Button
        size="sm"
        variant="ghost"
        class="h-7 gap-1.5 text-small"
        disabled={acting !== null || !named}
        onclick={() => void finishing.pullRequest(row)}
      >
        <GitPullRequest class="size-3.5" />
        {acting === 'pull-request' ? 'Opening…' : 'PR'}
      </Button>
    {/if}
  </div>
</div>
