<script lang="ts">
  import Ellipsis from '@lucide/svelte/icons/ellipsis';
  import type { Snippet } from 'svelte';
  import * as DropdownMenu from '$lib/shared/ui/dropdown-menu/index.js';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';
  import { ReaderMarks } from '$lib/shared/reading/ReaderMarks.svelte.js';
  import { DIFF_WIDTH, DIFF_WRAP, widthOf } from './diffWidth.js';

  let { extra }: { extra?: Snippet } = $props();

  const marks = ReaderMarks.use();
  const width = $derived(widthOf(marks.widths.get(DIFF_WIDTH)));
  const wrap = $derived(marks.wraps.get(DIFF_WRAP) === true);
</script>

<DropdownMenu.Root>
  <Tooltip text="View options">
    <DropdownMenu.Trigger
      class="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-hover hover:text-foreground data-[state=open]:bg-selected data-[state=open]:text-foreground"
      aria-label="View options"
    >
      <Ellipsis class="size-3.5" />
    </DropdownMenu.Trigger>
  </Tooltip>
  <DropdownMenu.Content align="end" class="min-w-52">
    <DropdownMenu.Group>
      <DropdownMenu.GroupHeading>Diff</DropdownMenu.GroupHeading>
      <DropdownMenu.RadioGroup value={width} onValueChange={(next) => marks.widths.set(DIFF_WIDTH, next)}>
        <DropdownMenu.RadioItem value="patch">Changes only</DropdownMenu.RadioItem>
        <DropdownMenu.RadioItem value="whole">Whole file</DropdownMenu.RadioItem>
      </DropdownMenu.RadioGroup>
      <DropdownMenu.CheckboxItem checked={wrap} onCheckedChange={(next) => marks.wraps.set(DIFF_WRAP, next)}>
        Wrap long lines
      </DropdownMenu.CheckboxItem>
    </DropdownMenu.Group>
    {#if extra !== undefined}
      <DropdownMenu.Separator />
      {@render extra()}
    {/if}
  </DropdownMenu.Content>
</DropdownMenu.Root>
