<script lang="ts">
  import AlertTriangle from '@lucide/svelte/icons/triangle-alert';
  import GitMerge from '@lucide/svelte/icons/git-merge';
  import GitPullRequest from '@lucide/svelte/icons/git-pull-request';
  import Callout from '@runlith/chat-ui/Callout.svelte';
  import type { WorktreePlace } from '@tagma/server/worktrees/contract/wire/rows';
  import { Button } from '$lib/shared/ui/button/index.js';
  import Working from '$lib/shared/ui/Working.svelte';
  import ActLine from './ActLine.svelte';
  import { Worktrees } from './BoardState.svelte.js';
  import { baseName } from './BaseReading.svelte.js';
  import FactStamp from './FactStamp.svelte';
  import { Finishing } from './Finishing.svelte.js';
  import MergeFact from './MergeFact.svelte';
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
  const uncommitted = $derived(facts?.uncommitted ?? 0);

  const reason = $derived(pending?.refusal?.message ?? null);
  const pendingKey = $derived(pending === null ? null : `${pending.state}:${pending.queuedAt}`);
  let openedKey = $state<string | null>(null);
  let clipped = $state(false);
  const opened = $derived(pendingKey !== null && openedKey === pendingKey);

  const agentWords = $derived(
    row.agents.working > 0
      ? busy === 1
        ? '1 agent is still working here'
        : `${busy} agents are still working here`
      : busy === 1
        ? '1 agent here waits for you'
        : `${busy} agents here wait for you`,
  );

  function toggle(): void {
    openedKey = opened ? null : pendingKey;
  }

  function cancel(): void {
    if (acting === null) void finishing.cancelMerge(row);
  }
</script>

{#snippet waitingActs()}
  <Button size="xs" variant="outline" disabled={acting !== null} onclick={cancel}>Stop</Button>
  {#if reason !== null}
    <Button size="xs" variant="ghost" class="text-muted-foreground" aria-expanded={opened} onclick={toggle}>
      {opened ? 'Hide details' : 'Details'}
    </Button>
  {/if}
{/snippet}

{#snippet stoppedActs()}
  <Button size="xs" variant="ghost" class="text-muted-foreground" aria-expanded={opened} onclick={toggle}>
    {opened ? 'Show less' : 'Show all'}
  </Button>
{/snippet}

<div class="grid shrink-0 gap-2 border-t bg-chrome px-3 py-2 text-small" data-finish-strip={row.name} {@attach reading.observe(row.rootId)}>
  {#if flight !== null}
    <ActLine {flight} class="text-small" />
  {:else if outcome !== null}
    <OutcomeLine {outcome} class="text-small" />
  {/if}
  {#if reading.unread !== null}<span class="text-destructive">Updates stopped: {reading.unread}</span>{/if}

  <div class="grid gap-1">
    <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
      <GitMerge class="size-3.5 shrink-0 text-muted-foreground" />
      <span class="text-ui text-muted-foreground">Merge into <span class="font-medium text-foreground">{into}</span></span>
      <span class="ml-auto flex items-center">
        {#if facts !== null}<MergeFact row={facts} />{:else}<span class="text-muted-foreground">not taken</span>{/if}
      </span>
    </div>
    {#if busy > 0}
      <span class="flex items-center gap-2 text-muted-foreground" data-finish-strip-busy={busy}>
        <span class="grid size-3.5 shrink-0 place-items-center">
          {#if row.agents.working > 0}<Working />{:else}<span class="block size-1.75 bg-status-open"></span>{/if}
        </span>
        {agentWords}
      </span>
    {/if}
    {#if uncommitted > 0}
      <span class="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-muted-foreground">
        <AlertTriangle class="size-3.5 shrink-0 text-status-stale" />
        <span>{uncommitted} uncommitted {uncommitted === 1 ? 'path stays' : 'paths stay'} out of the merge</span>
        {#if facts !== null}<FactStamp fact={facts.stateFact} head={row.head} />{/if}
      </span>
    {/if}
  </div>

  {#if pending !== null}
    <div data-finish-strip-pending={pending.state}>
      {#if waiting}
        <Callout
          tone="pending"
          title={`Merges when ${into} is free`}
          note={opened ? (reason ?? undefined) : undefined}
          class="bg-background"
          actions={waitingActs}
        />
      {:else}
        <Callout
          tone="error"
          title={`The merge into ${into} stopped`}
          note={reason ?? undefined}
          clamp={!opened}
          bind:clipped
          onDismiss={cancel}
          class="bg-background"
          actions={clipped || opened ? stoppedActs : undefined}
        />
      {/if}
    </div>
  {/if}

  <div class="flex items-center gap-1.5">
    {#if !conflicts && !waiting}
      <Button
        size="sm"
        class="h-7 gap-1.5 text-small"
        disabled={acting !== null || !named}
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
