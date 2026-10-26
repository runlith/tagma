<script lang="ts">
  import ArrowRightLeft from '@lucide/svelte/icons/arrow-right-left';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import ActLine from '$lib/features/worktrees/ActLine.svelte';
  import { Finishing } from '$lib/features/worktrees/Finishing.svelte.js';
  import WorktreeSwatch from '$lib/features/worktrees/WorktreeSwatch.svelte';
  import { toneOf } from '$lib/features/worktrees/tone.js';
  import * as DropdownMenu from '$lib/shared/ui/dropdown-menu/index.js';
  import { ThreadOnScreen } from '../OnScreen.svelte.js';
  import type { ThreadSlot } from '../ThreadSlot.svelte.js';
  import { ThreadPlace } from '../thread/ThreadPlace.svelte.js';
  import WorktreeMenuItems from './MenuItems.svelte';

  let { host, threadId }: { host: ThreadSlot; threadId: string } = $props();

  const finishing = Finishing.use();
  const onScreen = ThreadOnScreen.use();

  const places = $derived(host.places);
  const place = $derived(host.thread?.get(ThreadPlace) ?? null);
  const standing = $derived(threadId === host.activeId ? (place?.standing ?? null) : places.standingOf(threadId));
  const row = $derived(standing?.kind === 'row' ? standing.row : null);
  const moving = $derived(place?.moveInFlight == null ? null : places.byRoot(place.moveInFlight.rootId));
  const shown = $derived(row !== null && host !== onScreen.host && row.rootId !== places.aimed?.rootId);
  const chip = $derived(moving ?? row);
  const tone = $derived(toneOf(chip));
  const targets = $derived(
    places.rows.filter((other) => other.rootId !== row?.rootId && !other.missing && (other.kind === 'main' || other.branch !== null)),
  );
  const busy = $derived(places.moving.includes(threadId));
  const flight = $derived(row === null ? null : finishing.inFlight(row.rootId));
  const refused = $derived(row !== null && flight === null && finishing.outcomeOf(row.rootId)?.refusal != null);
  const PHASE = { preparing: 'preparing', checkout: 'checking out', failed: 'failed' } as const;
  const UNLISTED =
    'worktree-chip inline-flex h-6 min-w-0 max-w-[16rem] shrink items-center gap-1.5 rounded-md border border-dashed border-muted-foreground/50 px-1.5 font-mono text-meta text-muted-foreground';
</script>

{#if standing?.kind === 'creating'}
  <span class={UNLISTED} data-worktree-chip="creating">
    <WorktreeSwatch row={null} />
    <span class="min-w-0 truncate">{standing.creation.label} · {PHASE[standing.creation.phase]}</span>
  </span>
{:else if standing?.kind === 'deleted' || standing?.kind === 'nowhere'}
  <DropdownMenu.Root>
    <DropdownMenu.Trigger class={[UNLISTED, 'hover:text-foreground']} aria-label="Worktree" data-worktree-chip={standing.kind}>
      <WorktreeSwatch row={null} />
      <span class="min-w-0 truncate">
        {standing.kind === 'deleted' ? `deleted · ${standing.branch ?? 'worktree'}` : 'not in a worktree'}
      </span>
      <ChevronDown class="size-3 shrink-0" />
    </DropdownMenu.Trigger>
    {#if targets.length > 0}
      <DropdownMenu.Content align="start" class="w-64">
        {@render moveItem()}
      </DropdownMenu.Content>
    {/if}
  </DropdownMenu.Root>
{:else if shown && row !== null}
  <DropdownMenu.Root>
    <DropdownMenu.Trigger
      class={[
        'worktree-chip inline-flex h-6 min-w-0 shrink items-center gap-1.5 rounded-md px-1.5 font-mono text-meta text-foreground/85 transition-colors hover:text-foreground',
        flight === null ? 'max-w-[14rem]' : 'max-w-[24rem]',
        tone === null ? 'bg-hover hover:bg-selected' : 'worktree-chip--toned',
        moving !== null && 'worktree-chip--pending',
      ]}
      style={tone === null ? undefined : `--tone: ${tone}`}
      aria-label="Worktree"
      data-worktree-chip={chip?.name}
    >
      <WorktreeSwatch row={chip} />
      <span class="min-w-0 truncate">{chip?.branch ?? chip?.name}</span>
      {#if flight !== null}
        <ActLine {flight} class="min-w-0 shrink font-sans" />
      {:else if refused}
        <TriangleAlert class="size-3 shrink-0 text-destructive" aria-label="The last act was refused" />
      {/if}
      <ChevronDown class="size-3 shrink-0 text-muted-foreground" />
    </DropdownMenu.Trigger>
    <DropdownMenu.Content align="start" class="w-72">
      <WorktreeMenuItems {row} move={targets.length > 0 ? moveItem : undefined} />
    </DropdownMenu.Content>
  </DropdownMenu.Root>
{/if}

{#snippet moveItem()}
  <DropdownMenu.Sub>
    <DropdownMenu.SubTrigger icon={ArrowRightLeft} disabled={busy}>Move to worktree</DropdownMenu.SubTrigger>
    <DropdownMenu.SubContent class="min-w-56">
      {#each targets as target (target.rootId)}
        <DropdownMenu.Item onSelect={() => void places.move(threadId, target.rootId)}>
          {#snippet lead()}<WorktreeSwatch row={target} />{/snippet}
          <span class="font-mono text-small">{target.branch ?? target.name}</span>
        </DropdownMenu.Item>
      {/each}
    </DropdownMenu.SubContent>
  </DropdownMenu.Sub>
{/snippet}

<style>
  :global(.worktree-chip.worktree-chip--toned) {
    background: color-mix(in oklch, var(--tone) 12%, transparent);
    border: 1px solid color-mix(in oklch, var(--tone) 30%, transparent);
  }
  :global(.worktree-chip.worktree-chip--pending) {
    background: repeating-linear-gradient(
      135deg,
      color-mix(in oklch, var(--tone, var(--color-muted-foreground)) 16%, transparent) 0 6px,
      transparent 6px 11px
    );
  }
</style>
