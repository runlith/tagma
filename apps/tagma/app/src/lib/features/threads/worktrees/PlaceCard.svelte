<script lang="ts">
  import type { ThreadStanding, Worktrees } from '$lib/features/worktrees/BoardState.svelte.js';
  import FadeText from '$lib/shared/FadeText.svelte';
  import EventCard from './EventCard.svelte';
  import type { WorktreePlace } from './worktreePlace.js';

  let { place, places, standing = null }: { place: WorktreePlace; places: Worktrees; standing?: ThreadStanding | null } = $props();

  type Unlisted = { readonly name: string; readonly absent: string | null };

  const row = $derived(places.byRoot(place.rootId));
  const unlisted = $derived.by((): Unlisted => {
    if (standing?.kind === 'creating')
      return { name: standing.creation.label, absent: standing.creation.phase === 'failed' ? 'failed' : 'being made' };
    const branch =
      place.event === 'setup' ? (standing?.kind === 'deleted' && standing.rootId === place.rootId ? standing.branch : null) : place.branch;
    if (!places.known) return { name: branch ?? 'a worktree', absent: null };
    return { name: branch ?? 'worktree', absent: 'deleted' };
  });
  const bare = $derived(row === null && place.event === 'created' && place.branch === null ? place.name : null);
  const name = $derived(row?.branch ?? row?.name ?? bare ?? unlisted.name);
  const absent = $derived(row === null && bare === null ? unlisted.absent : null);
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

<EventCard
  outcome={failed ? 'failed' : busy ? 'pending' : 'done'}
  {verb}
  {row}
  {name}
  {absent}
  {tail}
  data-worktree-place={setup ?? place.event}
>
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
</EventCard>

{#snippet tail()}
  {#if place.event === 'merged'}
    <span class="shrink-0 text-muted-foreground">into</span>
    <FadeText class="font-mono text-meta" text={place.base} />
    <span class="shrink-0 font-mono text-meta text-muted-foreground">{place.commit.slice(0, 8)}</span>
  {/if}
{/snippet}
