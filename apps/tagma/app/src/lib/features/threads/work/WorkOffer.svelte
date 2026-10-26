<script lang="ts">
  import { SidePanes } from '$lib/app/panes/SidePanes.svelte.js';
  import * as DropdownMenu from '$lib/shared/ui/dropdown-menu/index.js';
  import KnowledgeIcon from '$lib/features/graph/KnowledgeIcon.svelte';
  import { workPane } from './workPane.js';

  const panes = SidePanes.use();
</script>

{#if (panes.main?.activeId ?? null) !== null}
  <DropdownMenu.Item icon={KnowledgeIcon} onSelect={() => panes.open(workPane)}>Work</DropdownMenu.Item>
{/if}
