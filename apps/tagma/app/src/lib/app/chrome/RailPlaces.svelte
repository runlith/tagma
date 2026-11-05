<script lang="ts">
  import type { Project } from '@tagma/server/graph/contract/wire/rows';
  import { Router } from '@runlith/layer/Router';
  import { Overlay } from '@runlith/primitives/Overlay.svelte';
  import { launchesOf } from '$lib/features/plugin-views/launchers.js';
  import PluginIcon from '$lib/features/plugin-views/PluginIcon.svelte';
  import { ViewSets } from '$lib/features/plugin-views/ViewSets.svelte.js';
  import { ViewWindows } from '$lib/features/plugin-views/windows/ViewWindows.js';
  import WindowIcon from '$lib/features/plugin-views/windows/WindowIcon.svelte';
  import { AgentTypes } from '$lib/features/threads/AgentTypes.svelte.js';
  import LibraryIcon from '$lib/features/threads/LibraryIcon.svelte';
  import { AgentLibraryOverlay } from '$lib/features/threads/overlay.js';
  import { SurfaceRegistry } from '$lib/features/workspace/surface.js';
  import { Visits } from '$lib/features/workspace/Visits.svelte.js';
  import { glide, Reorder } from '$lib/shared/Reorder.svelte.js';
  import RailMark from '$lib/shared/ui/RailMark.svelte';
  import { RAIL_HERE, RAIL_IDLE, RAIL_ITEM } from '$lib/shared/ui/rail.js';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';
  import { cn } from '$lib/shared/utils.js';
  import MorePlaces from './MorePlaces.svelte';
  import { launchPlaceId, type RailPlace } from './place.js';
  import { RailPins } from './RailPins.svelte.js';

  let { project }: { project: Project } = $props();

  const LIBRARY_RAIL = 70;

  const pins = RailPins.use();
  const visits = Visits.use();
  const router = Router.use();
  const overlay = Overlay.use();
  const sets = ViewSets.use();
  const windows = ViewWindows.use();
  const types = AgentTypes.use();

  const surfaces = SurfaceRegistry.use();

  const standing = $derived(router.params.project ? surfaces.railOf(surfaces.of(router.routeId, router.params)) : null);

  const library: RailPlace = {
    id: 'agents.library',
    label: 'Agent library',
    icon: LibraryIcon,
    current: false,
    reach: { open: () => overlay.open(AgentLibraryOverlay, { projectId: project.id, onSaved: () => void types.read(true) }) },
  };

  const places = $derived.by((): readonly RailPlace[] => {
    const declared = surfaces.rail.map((entry) => ({
      rail: entry.rail ?? 0,
      place: {
        id: entry.surface,
        label: entry.label,
        icon: entry.icon,
        iconUrl: entry.iconUrl,
        mark: entry.mark,
        current: standing === entry.surface,
        reach: { href: visits.href(project, entry.surface) },
      } satisfies RailPlace,
    }));
    const launches = launchesOf(sets.sets, project).map((launch): RailPlace => ({
      id: launchPlaceId(launch.plugin, launch.view),
      label: launch.title,
      icon: WindowIcon,
      current: false,
      reach: { open: () => windows.open(launch) },
    }));
    return [
      ...[...declared, { rail: LIBRARY_RAIL, place: library }].toSorted((left, right) => left.rail - right.rail).map((one) => one.place),
      ...launches,
    ];
  });
  const byId = $derived(new Map(places.map((place) => [place.id, place])));
  const pinned = $derived(pins.ids.flatMap((id) => byId.get(id) ?? []));
  const pinnedIds = $derived(new Set(pinned.map((place) => place.id)));
  const elsewhere = $derived(places.some((place) => place.current && !pinnedIds.has(place.id)));

  const reorder = new Reorder(
    () => pinned.map((place) => place.id),
    (id, before) => pins.pin(id, before),
    'y',
  );
  const shown = $derived.by(() => {
    const incoming = reorder.incoming === null ? undefined : byId.get(reorder.incoming);
    return reorder.arranged(incoming === undefined ? pinned : [...pinned, incoming], (place) => place.id);
  });
</script>

<div class="flex shrink-0 flex-col items-center gap-1.5 self-stretch py-1.5">
  <div class="relative flex w-full flex-col items-center gap-1.5" {@attach reorder.attach}>
    {#each shown as place (place.id)}
      {@const carried = reorder.carried === place.id}
      {@const reach = place.reach}
      {@const Icon = place.icon}
      {@const Mark = place.mark}
      <div
        class={cn(
          'shrink-0 rounded-md',
          carried ? 'relative z-10 cursor-grabbing bg-chrome transition-[opacity,scale]' : 'transition-transform',
          carried && reorder.leaving && 'scale-75 opacity-50',
        )}
        style:translate={reorder.offset(place.id)}
        data-reorder-item={place.id}
        data-carried={carried || undefined}
        animate:glide
      >
        {#snippet glyph()}
          {#if place.iconUrl !== undefined}
            <PluginIcon src={place.iconUrl} class="size-4" />
          {:else}
            <Icon class="size-4" />
          {/if}
        {/snippet}
        <Tooltip text={reorder.carried !== null ? null : place.label} side="right">
          {#if 'href' in reach}
            <a
              href={reach.href}
              aria-label={place.label}
              aria-current={place.current ? 'page' : undefined}
              class={cn(RAIL_ITEM, place.current ? RAIL_HERE : RAIL_IDLE)}
              data-reorder-handle={place.id}
            >
              <RailMark current={place.current} />
              {#if Mark !== undefined}
                <Mark {project}>{@render glyph()}</Mark>
              {:else}
                {@render glyph()}
              {/if}
            </a>
          {:else}
            <button
              type="button"
              aria-label={place.label}
              class={cn(RAIL_ITEM, RAIL_IDLE)}
              data-reorder-handle={place.id}
              onclick={reach.open}
            >
              {@render glyph()}
            </button>
          {/if}
        </Tooltip>
      </div>
    {/each}
  </div>
  <MorePlaces {places} pinned={pinnedIds} current={elsewhere} {reorder} />
</div>
