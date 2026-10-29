<script lang="ts">
  import Pin from '@lucide/svelte/icons/pin';
  import PinOff from '@lucide/svelte/icons/pin-off';
  import type { VirtualAnchor } from '@runlith/primitives/float.svelte';
  import type { Rect } from '@runlith/primitives/place';
  import type { HoverIntent } from '@runlith/primitives/popover.svelte';
  import TagmaAppIcon from '$lib/features/tagma-apps/TagmaAppIcon.svelte';
  import FadeText from '$lib/shared/FadeText.svelte';
  import type { Reorder } from '$lib/shared/Reorder.svelte.js';
  import * as Popover from '$lib/shared/ui/popover/index.js';
  import RailMark from '$lib/shared/ui/RailMark.svelte';
  import { RAIL_HERE, RAIL_IDLE, RAIL_ITEM } from '$lib/shared/ui/rail.js';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';
  import { cn } from '$lib/shared/utils.js';
  import MoreIcon from './MoreIcon.svelte';
  import type { RailPlace } from './place.js';
  import { RailPins } from './RailPins.svelte.js';

  let {
    places,
    pinned,
    current,
    reorder,
  }: { places: readonly RailPlace[]; pinned: ReadonlySet<string>; current: boolean; reorder: Reorder<string> } = $props();

  const HOVER: HoverIntent = { openMs: 180, closeMs: 300 };
  const ROW = '[data-place-row]';
  const GO = '[data-place-go]';
  const PIN = '[data-place-pin]';
  const GO_CLASS =
    'flex min-h-7 min-w-0 flex-1 cursor-default items-center gap-2 rounded-md px-2 py-1 text-left outline-none focus-visible:ring-1 focus-visible:ring-ring';

  const pins = RailPins.use();
  let open = $state(false);
  let trigger: HTMLElement | null = null;
  let held: Rect | null = null;

  const anchor: VirtualAnchor = {
    rect: () => (held ??= trigger?.getBoundingClientRect() ?? { x: 0, y: 0, width: 0, height: 0 }),
    get element() {
      return trigger ?? document.body;
    },
  };

  $effect.pre(() => {
    if (!open) held = null;
  });

  function toggle(place: RailPlace): void {
    if (pinned.has(place.id)) pins.unpin(place.id);
    else pins.pin(place.id, null);
  }

  function step(event: KeyboardEvent & { currentTarget: HTMLElement }): void {
    const control = event.currentTarget;
    const row = control.closest<HTMLElement>(ROW);
    const list = row?.parentElement;
    if (row === null || list === null || list === undefined) return;
    const rows = [...list.querySelectorAll<HTMLElement>(`:scope > ${ROW}`)];
    const at = rows.indexOf(row);
    const column = control.matches(PIN) ? PIN : GO;
    const aimed = ((): readonly [number, string] | null => {
      switch (event.key) {
        case 'ArrowDown':
          return [(at + 1) % rows.length, column];
        case 'ArrowUp':
          return [(at - 1 + rows.length) % rows.length, column];
        case 'Home':
          return [0, column];
        case 'End':
          return [rows.length - 1, column];
        case 'ArrowRight':
          return [at, PIN];
        case 'ArrowLeft':
          return [at, GO];
      }
      return null;
    })();
    if (aimed === null) return;
    event.preventDefault();
    rows[aimed[0]]?.querySelector<HTMLElement>(aimed[1])?.focus();
  }
</script>

{#snippet face(place: RailPlace)}
  {@const Icon = place.icon}
  {#if place.iconUrl !== undefined}
    <TagmaAppIcon
      src={place.iconUrl}
      class={cn(
        'size-3.5 shrink-0 transition-colors',
        place.current ? 'text-foreground' : 'text-muted-foreground group-hover/place:text-foreground',
      )}
    />
  {:else}
    <Icon
      class={cn(
        'size-3.5 shrink-0 transition-colors',
        place.current ? 'text-foreground' : 'text-muted-foreground group-hover/place:text-foreground',
      )}
    />
  {/if}
  <FadeText text={place.label} class="flex-1" />
{/snippet}

<Popover.Root bind:open>
  <Popover.Trigger
    hover={HOVER}
    class={cn(RAIL_ITEM, current ? RAIL_HERE : RAIL_IDLE, 'data-[reorder-over]:text-foreground data-[reorder-over]:before:bg-selected')}
    aria-label="More"
    data-rail-more
    {@attach (node: HTMLElement) => {
      trigger = node;
    }}
    {@attach reorder.outlet((id) => pins.unpin(id))}
  >
    <RailMark {current} />
    <MoreIcon class="size-4" />
  </Popover.Trigger>
  <Popover.Content
    side="right"
    align="start"
    {anchor}
    class="max-h-(--float-available-height) w-56 gap-0 overflow-y-auto p-1"
    aria-label="More"
    data-rail-places
  >
    <ul
      class="flex flex-col"
      {@attach reorder.inlet(
        () => places.map((place) => place.id),
        (id, before) => pins.pin(id, before),
      )}
    >
      {#each places as place (place.id)}
        {@const kept = pinned.has(place.id)}
        {@const reach = place.reach}
        <li
          class={cn(
            'group/place flex items-center rounded-md transition-[background-color,opacity]',
            place.current ? 'bg-selected' : 'hover:bg-hover',
            reorder.carried === place.id && 'opacity-50',
          )}
          data-place-row
        >
          {#if 'href' in reach}
            <a
              href={reach.href}
              class={GO_CLASS}
              aria-current={place.current ? 'page' : undefined}
              data-place-go
              data-reorder-handle={place.id}
              onkeydown={step}
              onmousedown={(event) => event.preventDefault()}
              onclick={() => (open = false)}
            >
              {@render face(place)}
            </a>
          {:else}
            <button
              type="button"
              class={GO_CLASS}
              data-place-go
              data-reorder-handle={place.id}
              onkeydown={step}
              onmousedown={(event) => event.preventDefault()}
              onclick={() => {
                open = false;
                reach.open();
              }}
            >
              {@render face(place)}
            </button>
          {/if}
          <Tooltip text={kept ? 'Unpin from sidebar' : 'Pin to sidebar'} side="right">
            <button
              type="button"
              class={cn(
                'group/pin mr-1 grid size-5 shrink-0 place-items-center rounded-sm outline-none transition-[color,opacity] hover:bg-hover hover:text-foreground focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-ring',
                kept ? 'text-foreground' : 'text-muted-foreground opacity-0 group-hover/place:opacity-100',
              )}
              aria-pressed={kept}
              aria-label={kept ? `Unpin ${place.label} from the sidebar` : `Pin ${place.label} to the sidebar`}
              data-place-pin
              onkeydown={step}
              onmousedown={(event) => event.preventDefault()}
              onclick={() => toggle(place)}
            >
              {#if kept}
                <Pin class="size-3.5 fill-current group-hover/pin:hidden" />
                <PinOff class="hidden size-3.5 group-hover/pin:block" />
              {:else}
                <Pin class="size-3.5" />
              {/if}
            </button>
          </Tooltip>
        </li>
      {/each}
    </ul>
  </Popover.Content>
</Popover.Root>
