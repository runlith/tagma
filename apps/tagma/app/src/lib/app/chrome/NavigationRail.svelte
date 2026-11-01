<script lang="ts">
  import { Router } from '@runlith/layer/Router';
  import PanelIcon from '$lib/shared/ui/PanelIcon.svelte';
  import { RAIL_IDLE, RAIL_ITEM } from '$lib/shared/ui/rail.js';
  import AttentionButton from '../attention/AttentionButton.svelte';
  import AppMenu from './AppMenu.svelte';
  import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
  import { Keymap } from '../keys/Keymap.svelte.js';
  import { cn } from '$lib/shared/utils.js';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';
  import { App } from '@runlith/layer/svelte/App.svelte';
  import { ColumnRegistry } from './ColumnRegistry.js';
  import RailPlaces from './RailPlaces.svelte';
  import type { Snippet } from 'svelte';

  let { projects }: { projects?: Snippet } = $props();

  const workspace = Workspace.use();
  const app = App.current();
  const router = Router.use();
  const keymap = Keymap.use();
  const inProject = $derived(Boolean(router.params.project));
  const project = $derived(workspace.contextProject);
  const columns = ColumnRegistry.use();
  const column = $derived(columns.at(router.routeId, router.params, inProject, app));
</script>

<nav class="flex w-12 shrink-0 flex-col items-center border-r bg-chrome py-1.5" aria-label="Surfaces">
  {#if projects}
    {@render projects()}
    {#if project}<span class="my-1.5 h-px w-6 shrink-0 bg-border" aria-hidden="true"></span>{/if}
  {/if}
  {#if project}
    {#key project.id}
      <RailPlaces {project} />
    {/key}
  {/if}
  <div class="mt-auto flex shrink-0 flex-col items-center gap-1.5 pt-1.5">
    <AttentionButton />
    <AppMenu />
    {#if column !== null}
      {@const words = `${column.open ? 'Hide' : 'Show'} the ${column.label}`}
      <Tooltip text={words} keys={keymap.spell(keymap.mod('Backslash'))} side="right" class="flex">
        <button
          type="button"
          class={cn(RAIL_ITEM, RAIL_IDLE)}
          aria-label={words}
          aria-pressed={column.open}
          onclick={() => column.toggle()}
        >
          <PanelIcon side="left" class="size-4" />
        </button>
      </Tooltip>
    {/if}
  </div>
</nav>
