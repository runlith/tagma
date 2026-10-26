<script lang="ts">
  import GitBranchPlus from '@lucide/svelte/icons/git-branch-plus';
  import GitMerge from '@lucide/svelte/icons/git-merge';
  import Waiting from '@runlith/chat-ui/Waiting.svelte';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import Wrench from '@lucide/svelte/icons/wrench';
  import type { ThreadStanding, Worktrees } from '$lib/features/worktrees/BoardState.svelte.js';
  import WorktreeSwatch from '$lib/features/worktrees/WorktreeSwatch.svelte';
  import { toneOf } from '$lib/features/worktrees/tone.js';
  import type { WorktreePlace } from './worktreePlace.js';

  let { place, places, standing = null }: { place: WorktreePlace; places: Worktrees; standing?: ThreadStanding | null } = $props();

  const row = $derived(places.byRoot(place.rootId));
  const tone = $derived(toneOf(row));
  const unlisted = $derived.by(() => {
    if (standing?.kind === 'creating')
      return `${standing.creation.label} · ${standing.creation.phase === 'failed' ? 'failed' : 'being made'}`;
    const branch =
      place.event === 'setup' ? (standing?.kind === 'deleted' && standing.rootId === place.rootId ? standing.branch : null) : place.branch;
    if (!places.known) return branch ?? 'a worktree';
    return `deleted · ${branch ?? 'worktree'}`;
  });
  const name = $derived(row?.branch ?? row?.name ?? (place.event === 'created' && place.branch === null ? place.name : unlisted));
  const setup = $derived(place.event === 'setup' ? (row?.setup ?? place.setup) : null);
  const failed = $derived(setup === 'failed');
  const busy = $derived(setup === 'pending' || setup === 'running');
  const clock = (iso: string): string => {
    const at = new Date(iso);
    const time = at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return at.toDateString() === new Date(place.occurredAt).toDateString()
      ? time
      : `${at.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
  };
  const verb = $derived(
    place.event === 'created'
      ? 'Started in'
      : place.event === 'merged'
        ? place.mode === 'squash'
          ? 'Squashed'
          : place.mode === 'rebase'
            ? 'Rebased'
            : 'Merged'
        : busy
          ? 'Setting up'
          : failed
            ? 'Setup failed in'
            : 'Set up',
  );
</script>

<div
  class={['place-card my-1 grid max-w-xl gap-1 rounded-lg border bg-raised px-3 py-2 text-ui', failed && 'place-card--failed']}
  style={tone === null ? undefined : `--tone: ${tone}`}
  data-worktree-place={setup ?? place.event}
>
  <div class="flex min-w-0 items-center gap-2">
    {#if failed}
      <TriangleAlert class="size-3.5 shrink-0 text-destructive" />
    {:else if busy}
      <Waiting class="size-3.5 text-muted-foreground" />
    {:else if place.event === 'created'}
      <GitBranchPlus class="size-3.5 shrink-0 text-muted-foreground" />
    {:else if place.event === 'merged'}
      <GitMerge class="size-3.5 shrink-0 text-muted-foreground" />
    {:else}
      <Wrench class="size-3.5 shrink-0 text-muted-foreground" />
    {/if}
    <span class="shrink-0 font-medium">{verb}</span>
    <span class="place-chip inline-flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 font-mono text-meta">
      <WorktreeSwatch {row} />
      <span class="min-w-0 truncate">{name}</span>
    </span>
    {#if place.event === 'merged'}
      <span class="shrink-0 text-muted-foreground">into</span>
      <span class="min-w-0 truncate font-mono text-meta">{place.base}</span>
      <span class="shrink-0 font-mono text-meta text-muted-foreground">{place.commit.slice(0, 8)}</span>
    {/if}
  </div>
  {#if place.event === 'merged' && (place.waitedSince !== undefined || (place.after !== undefined && place.after.act !== 'keep'))}
    <p class="text-small text-muted-foreground" data-worktree-merged-after={place.after?.outcome}>
      {#if place.waitedSince !== undefined}Waited for {place.base} to be free since {clock(place.waitedSince)}.{/if}
      {#if place.after !== undefined && place.after.act !== 'keep'}
        {place.after.outcome === 'refused'
          ? `Not deleted: ${place.after.reason ?? ''}`
          : place.after.outcome === 'branch-kept'
            ? `Deleted; branch kept: ${place.after.reason ?? ''}`
            : 'Deleted, and its branch with it.'}
      {/if}
    </p>
  {/if}
  {#if place.event === 'setup' && failed}
    <p class="text-small text-muted-foreground">
      {place.step === null ? '' : `At its ${place.step} step. `}{place.reason ?? ''}
    </p>
    {#if place.execution !== null}
      <p class="font-mono text-meta text-muted-foreground">
        read_output execution {place.execution.execution} incarnation {place.execution.incarnation}
      </p>
    {/if}
  {/if}
</div>

<style>
  .place-card {
    border-left: 3px solid var(--tone, var(--color-border));
  }
  .place-card--failed {
    border-left-color: var(--color-destructive);
  }
  .place-chip {
    background: color-mix(in oklch, var(--tone, var(--color-muted-foreground)) 12%, transparent);
  }
</style>
