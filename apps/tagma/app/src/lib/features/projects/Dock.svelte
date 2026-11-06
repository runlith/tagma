<script lang="ts">
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import ChevronUp from '@lucide/svelte/icons/chevron-up';
  import type { Project } from '@tagma/server/graph/contract/wire/rows';
  import { Keymap } from '$lib/app/keys/Keymap.svelte.js';
  import Badge from '$lib/shared/ui/Badge.svelte';
  import RailMark from '$lib/shared/ui/RailMark.svelte';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';
  import { cn } from '$lib/shared/utils.js';
  import { Notices } from '$lib/features/notices/Service.svelte.js';
  import { ContextAim } from '$lib/shared/contextAim.svelte.js';
  import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
  import { ShellOps, shellActs } from '$lib/features/workspace/ShellOps.js';
  import { labelOf } from '$lib/features/workspace/mark.js';
  import { countOf, pulseWords } from './words.js';
  import { placeAction } from './actions.js';
  import { ProjectPrefetch } from './Prefetch.js';
  import { ProjectPulse } from './Pulse.svelte.js';
  import { glide, Reorder } from '$lib/shared/Reorder.svelte.js';
  import { ProjectStrip } from './Strip.svelte.js';
  import { MentionDrops } from '$lib/features/threads/MentionDrops.svelte.js';
  import { mentionOf } from './mention.js';
  import StripMenu from './StripMenu.svelte';
  import Crest from './Crest.svelte';
  import Tile from './Tile.svelte';

  type Side = 'above' | 'below';

  const strip = ProjectStrip.use();
  const pulse = ProjectPulse.use();
  const prefetch = ProjectPrefetch.use();
  const workspace = Workspace.use();
  const shell = shellActs(ShellOps.use(), Notices.use());
  const keymap = Keymap.use();
  const drops = MentionDrops.use();
  const reorder = new Reorder(
    () => strip.projects.map((project) => project.id),
    (id, before) => strip.move(id, before),
    'y',
    drops.beyond((id: number) => {
      const project = strip.projects.find((one) => one.id === id);
      return project === undefined ? null : mentionOf(project);
    }),
  );
  const aim = new ContextAim();
  let aimed = $state<Project | null>(null);
  let scroller = $state<HTMLElement | null>(null);
  let hidden = $state<Readonly<Record<number, Side>>>({});

  const ids = (side: Side): number[] => strip.projects.filter((project) => hidden[project.id] === side).map((project) => project.id);
  const edge = (side: Side) => {
    const out = ids(side);
    const counts = out.map((id) => pulse.of(id));
    return {
      any: out.length > 0,
      working: counts.reduce((sum, count) => sum + count.working, 0),
      awaiting: counts.some((count) => count.awaiting > 0),
      first: out.find((id) => {
        const count = pulse.of(id);
        return count.awaiting > 0 || count.working > 0;
      }),
    };
  };
  const above = $derived(edge('above'));
  const below = $derived(edge('below'));

  function open(tile: Project): void {
    if (tile.id !== workspace.activeTileId) void shell.openProject(strip.entry(tile).id, 'strip');
  }

  const marksOf = (tile: Project): readonly number[] => workspace.groupOf(tile.id)?.members.map((member) => member.id) ?? [tile.id];

  function tileOf(id: number | undefined): HTMLElement | null {
    return id === undefined ? null : (scroller?.querySelector<HTMLElement>(`[data-strip-project="${id}"]`) ?? null);
  }

  function reveal(id: number | undefined, behavior: ScrollBehavior): void {
    tileOf(id)?.scrollIntoView({ block: 'nearest', behavior });
  }

  $effect(() => {
    const root = scroller;
    if (root === null) return;
    const watch = new IntersectionObserver(
      (entries) => {
        const next = { ...hidden };
        for (const entry of entries) {
          const id = Number((entry.target as HTMLElement).dataset.stripProject);
          const top = entry.rootBounds?.top ?? 0;
          if (entry.intersectionRatio >= 0.75) delete next[id];
          else next[id] = entry.boundingClientRect.top < top ? 'above' : 'below';
        }
        hidden = next;
      },
      { root, threshold: [0, 0.75, 1] },
    );
    for (const project of strip.projects) {
      const tile = tileOf(project.id);
      if (tile !== null) watch.observe(tile);
    }
    return () => watch.disconnect();
  });

  $effect(() => reveal(workspace.activeTileId ?? undefined, 'instant'));
</script>

{#snippet marker(side: Side, at: ReturnType<typeof edge>)}
  {#if at.working > 0 || at.awaiting}
    <button
      type="button"
      class={cn(
        'absolute left-1/2 z-10 flex h-4 -translate-x-1/2 items-center gap-0.5 rounded-sm bg-chrome px-1 stamp font-semibold text-status-in-work shadow-raised',
        side === 'above' ? 'top-0' : 'bottom-0',
      )}
      aria-label={`${side === 'above' ? 'More projects above' : 'More projects below'}: ${pulseWords({ working: at.working, awaiting: at.awaiting ? 1 : 0 })}`}
      onclick={() => reveal(at.first, 'smooth')}
    >
      {#if side === 'above'}<ChevronUp class="size-3" />{:else}<ChevronDown class="size-3" />{/if}
      {#if at.working > 0}{countOf(at.working)}{/if}
      {#if at.awaiting}<span class="size-1.5 bg-status-open"></span>{/if}
    </button>
  {/if}
{/snippet}

<div class="relative flex min-h-0 w-full shrink flex-col" role="group" aria-label="Projects">
  {@render marker('above', above)}
  <div
    bind:this={scroller}
    class="dock-scroll relative flex min-h-0 flex-col items-center gap-1.5 overflow-y-auto py-1.5 no-scrollbar"
    data-fade-above={above.any || undefined}
    data-fade-below={below.any || undefined}
    {@attach reorder.attach}
  >
    {#each reorder.arranged(strip.projects, (project) => project.id) as project, place (project.id)}
      {@const current = project.id === workspace.activeTileId}
      {@const counts = pulse.of(project.id)}
      {@const action = placeAction(place, strip.projects.length)}
      {@const chord = action === null ? null : keymap.spell(action)}
      {@const label = labelOf(project)}
      {@const words = pulseWords(counts)}
      {@const carried = reorder.carried === project.id}
      <div
        class={cn('shrink-0 rounded-md', carried ? 'relative z-10 cursor-grabbing bg-chrome' : 'transition-transform')}
        style:translate={reorder.offset(project.id)}
        data-reorder-item={project.id}
        data-carried={carried || undefined}
        animate:glide
      >
        <Tooltip text={reorder.carried !== null ? null : label} keys={chord} side="right">
          <button
            type="button"
            class="group relative grid size-9 shrink-0 place-items-center rounded-md transition-colors"
            aria-label={words === '' ? label : `${label}, ${words}`}
            aria-current={current ? 'page' : undefined}
            data-strip-project={project.id}
            data-reorder-handle={project.id}
            onclick={() => open(project)}
            oncontextmenu={(event) => {
              aimed = project;
              aim.aim(event);
            }}
            onpointerenter={() => prefetch.hover(strip.entry(project))}
            onpointerleave={() => prefetch.leave()}
          >
            <RailMark {current} />
            <span class="relative grid">
              <Badge count={counts.working} tone="work" class="-right-1.5 -bottom-1.5"
                ><Tile {project} marks={marksOf(project)} lit={current} /></Badge
              >
              {#if counts.working > 0}<Crest />{/if}
              {#if counts.awaiting > 0}
                <span class="absolute -bottom-1 -left-1 size-2 bg-status-open ring-2 ring-chrome" aria-hidden="true">
                  <span class="absolute inset-0 animate-ping bg-status-open"></span>
                </span>
              {/if}
            </span>
          </button>
        </Tooltip>
      </div>
    {/each}
  </div>
  {@render marker('below', below)}
</div>

<StripMenu {aim} project={aimed} />
