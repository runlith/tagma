<script lang="ts">
  import MessageSquarePlus from '@lucide/svelte/icons/message-square-plus';
  import * as DropdownMenu from '$lib/shared/ui/dropdown-menu/index.js';
  import { SidePanes } from '$lib/app/panes/SidePanes.svelte.js';
  import { THREAD_PANE } from './pane.js';

  const panes = SidePanes.use();
</script>

<DropdownMenu.Item icon={MessageSquarePlus} onSelect={() => panes.open({ kind: THREAD_PANE, id: null })}
  >New thread beside</DropdownMenu.Item
>
