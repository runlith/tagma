<script lang="ts">
  import type { ThreadListRow } from '@tagma/server/threads/contract/wire/list';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';
  import type { Worktrees } from '$lib/features/worktrees/BoardState.svelte.js';
  import WorktreeSwatch from '$lib/features/worktrees/WorktreeSwatch.svelte';
  import { toneOf } from '$lib/features/worktrees/tone.js';
  import { STOWED, Stow } from '../squeeze.svelte.js';

  let { places, row, named = true }: { places: Worktrees; row: ThreadListRow; named?: boolean } = $props();

  const place = $derived(places.placeOf(row.id));
  const label = $derived(place === null ? '' : (place.branch ?? place.name));
</script>

{#if place !== null && place.kind !== 'main'}
  <Tooltip text={named ? null : label} delayMs={300}>
    <span
      class={[
        'inline-flex shrink-0 items-center gap-1 rounded-sm px-1 font-mono text-meta leading-[14px] text-muted-foreground',
        named && 'place-badge',
      ]}
      style={`--tone: ${toneOf(place) ?? 'transparent'}`}
      aria-label={label}
      data-thread-place={place.name}
    >
      <WorktreeSwatch row={place} />
      <span class={['whitespace-nowrap', !named && STOWED]} aria-hidden="true" data-squeeze-piece={Stow.place}>{label}</span>
    </span>
  </Tooltip>
{/if}

<style>
  .place-badge {
    background: color-mix(in oklch, var(--tone) 12%, transparent);
  }
</style>
