<script lang="ts">
  import FolderTree from '@lucide/svelte/icons/folder-tree';
  import List from '@lucide/svelte/icons/list';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';
  import { ReaderMarks } from '$lib/shared/reading/ReaderMarks.svelte.js';
  import { GROUPING, groupedIn } from './grouping.js';

  const marks = ReaderMarks.use();
  const byFolder = $derived(groupedIn(marks));
  const label = $derived(byFolder ? 'Show as list' : 'Group by folder');
</script>

<Tooltip text={label}>
  <button
    type="button"
    class="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
    aria-label={label}
    aria-pressed={byFolder}
    onclick={() => marks.grouping.set(GROUPING, byFolder ? 'list' : 'groups')}
    data-change-grouping={byFolder ? 'groups' : 'list'}
  >
    {#if byFolder}<List class="size-3.5" />{:else}<FolderTree class="size-3.5" />{/if}
  </button>
</Tooltip>
