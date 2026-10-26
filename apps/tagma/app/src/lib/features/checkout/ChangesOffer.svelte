<script lang="ts">
  import FileDiff from '@lucide/svelte/icons/file-diff';
  import { SidePanes } from '$lib/app/panes/SidePanes.svelte.js';
  import * as DropdownMenu from '$lib/shared/ui/dropdown-menu/index.js';
  import { changesPane } from './paneContent.js';

  const panes = SidePanes.use();
</script>

{#if (panes.main?.activeId ?? null) !== null}
  <DropdownMenu.Item icon={FileDiff} onSelect={() => panes.open(changesPane)}>Changes</DropdownMenu.Item>
{/if}
