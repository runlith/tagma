<script lang="ts">
  import ChevronsUpDown from '@lucide/svelte/icons/chevrons-up-down';
  import Folder from '@lucide/svelte/icons/folder';
  import GitBranch from '@lucide/svelte/icons/git-branch';
  import type { WorktreePlace } from '@tagma/server/worktrees/contract/wire/rows';
  import { untrack } from 'svelte';
  import type { Worktrees } from '$lib/features/worktrees/BoardState.svelte.js';
  import WorktreeSwatch from '$lib/features/worktrees/WorktreeSwatch.svelte';
  import { toneOf } from '$lib/features/worktrees/tone.js';
  import FadeText from '$lib/shared/FadeText.svelte';
  import * as DropdownMenu from '$lib/shared/ui/dropdown-menu/index.js';
  import type { BirthPlace, PlaceStanding } from '../birth/BirthPlace.svelte.js';
  import { MAIN_CHECKOUT } from '../Draft.svelte.js';
  import type { ShownThread } from '../ShownThread.js';
  import { ThreadPlace } from '../thread/ThreadPlace.svelte.js';
  import { draftPlaceOf } from '../worktrees/acts.js';

  let { shown, place, places }: { shown: ShownThread; place: BirthPlace; places: Worktrees } = $props();

  const reading = untrack(() => places.window());
  const main = $derived(places.main);
  const unversioned = $derived(main !== null && reading.rowOf(main.rootId)?.reading === 'no-repository');
  const drafting = $derived(shown.id === null);
  const standing = $derived<PlaceStanding | null>(drafting ? place.standing : (shown.lease?.get(ThreadPlace).standing ?? null));
  const chosen = $derived(place.chosen);
  const row = $derived(standing?.kind === 'row' ? standing.row : null);
  const tone = $derived(row === null || row.kind === 'main' ? null : toneOf(row));
  const worktrees = $derived(places.targets.filter((one) => one.kind !== 'main'));
  const PHASE = { preparing: 'preparing', checkout: 'checking out', failed: 'failed' } as const;

  const baseOf = (one: WorktreePlace): string | null => (one.kind === 'main' ? null : one.branch);
  const PICKER =
    'flex h-6 min-w-0 shrink items-center gap-1.5 rounded-md px-1.5 text-muted-foreground transition-colors hover:bg-hover hover:text-foreground data-[state=open]:bg-selected data-[state=open]:text-foreground';
</script>

{#snippet where(at: PlaceStanding)}
  {#if at.kind === 'row'}
    <WorktreeSwatch row={at.row} />
    {#if at.row.kind === 'main'}
      <span class="shrink-0">Main checkout</span>
    {:else}
      <span class="shrink-0">Worktree</span>
      <FadeText class="font-mono text-foreground/85" text={at.row.name} />
    {/if}
  {:else if at.kind === 'new'}
    <WorktreeSwatch row={null} />
    <span class="shrink-0">New worktree</span>
  {:else if at.kind === 'creating'}
    <WorktreeSwatch row={null} />
    <FadeText class="font-mono" text={at.creation.label} />
    <span class={['shrink-0', at.creation.phase === 'failed' && 'text-destructive']}>{PHASE[at.creation.phase]}</span>
  {:else if at.kind === 'deleted'}
    <WorktreeSwatch row={null} />
    <span class="shrink-0">Deleted worktree</span>
    {#if at.branch !== null}<FadeText class="font-mono" text={at.branch} />{/if}
  {:else}
    <WorktreeSwatch row={null} />
    <span class="shrink-0">Not in a worktree</span>
  {/if}
{/snippet}

<div
  class={['flex min-w-0 flex-1 items-center gap-2 rounded-md text-small', tone !== null && !unversioned && 'place-strip--toned']}
  style={tone === null ? undefined : `--tone: ${tone}`}
  data-place-strip={unversioned ? 'folder' : standing === null ? undefined : standing.kind === 'row' ? standing.row.kind : standing.kind}
  {@attach main === null ? undefined : reading.observe(main.rootId)}
>
  {#if unversioned && main !== null}
    <span class="flex min-w-0 items-center gap-1.5 px-1.5 text-muted-foreground" title={main.folder}>
      <Folder class="size-3.5 shrink-0" />
      <FadeText text={main.folder.split('/').findLast((part) => part !== '') ?? main.folder} />
    </span>
  {:else if standing !== null}
    {#if drafting}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger class={PICKER} aria-label="Where this thread runs">
          {@render where(standing)}
          <ChevronsUpDown class="size-3 shrink-0 opacity-60" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="start" class="max-h-80 min-w-56 overflow-y-auto">
          {#if main !== null}
            <DropdownMenu.Item here={chosen.kind === 'main'} onSelect={() => place.pick(MAIN_CHECKOUT)}>
              {#snippet lead()}<WorktreeSwatch row={main} />{/snippet}
              Main checkout
            </DropdownMenu.Item>
          {/if}
          {#each worktrees as one (one.rootId)}
            <DropdownMenu.Item
              here={chosen.kind === 'worktree' && chosen.rootId === one.rootId}
              onSelect={() => place.pick(draftPlaceOf(one))}
            >
              {#snippet lead()}<WorktreeSwatch row={one} />{/snippet}
              <span class="font-mono">{one.branch ?? one.name}</span>
            </DropdownMenu.Item>
          {/each}
          <DropdownMenu.Separator />
          <DropdownMenu.Item
            here={chosen.kind === 'new'}
            onSelect={() => place.pick({ kind: 'new', base: chosen.kind === 'new' ? chosen.base : row === null ? null : baseOf(row) })}
          >
            {#snippet lead()}<WorktreeSwatch row={null} />{/snippet}
            New worktree
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    {:else}
      <span class="flex min-w-0 shrink items-center gap-1.5 px-1.5 text-muted-foreground">{@render where(standing)}</span>
    {/if}
    <span class="flex-1"></span>
    {#if standing.kind === 'new'}
      {@const base = standing.base}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger class={PICKER} aria-label="The branch the new worktree starts from">
          <span class="shrink-0">from</span>
          <FadeText class="font-mono" text={base ?? main?.branch ?? 'main'} />
          <ChevronsUpDown class="size-3 shrink-0 opacity-60" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="end" class="max-h-80 min-w-56 overflow-y-auto">
          {#each places.bases as one (one.rootId)}
            <DropdownMenu.Item here={baseOf(one) === base} onSelect={() => place.pick({ kind: 'new', base: baseOf(one) })}>
              {#snippet lead()}<WorktreeSwatch row={one} />{/snippet}
              <span class="font-mono">{one.branch}</span>
            </DropdownMenu.Item>
          {/each}
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    {:else if row !== null}
      <span class="flex min-w-0 shrink items-center gap-1 px-1.5 text-muted-foreground" data-place-branch>
        <GitBranch class="size-3.5 shrink-0" />
        {#if row.branch === null}
          <span class="shrink-0">detached</span>
        {:else}
          <FadeText class="font-mono" text={row.branch} />
        {/if}
      </span>
    {/if}
  {/if}
</div>

<style>
  .place-strip--toned {
    background: color-mix(in oklch, var(--tone) 9%, transparent);
  }
</style>
