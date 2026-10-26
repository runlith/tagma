<script lang="ts">
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import type { ListedBlock } from '@tagma/server/graph/contract/wire/rows';
  import StatusMenuItems from '$lib/features/graph/StatusMenuItems.svelte';
  import * as DropdownMenu from '$lib/shared/ui/dropdown-menu/index.js';
  import { type StateMark, statusText } from '$lib/features/graph/status.js';
  import { TagCatalog } from '$lib/features/graph/TagCatalog.svelte.js';
  import type { TreeScreen } from '$lib/features/graph/TreeScreen.svelte.js';
  import { cn } from '$lib/shared/utils.js';

  const tags = TagCatalog.use();

  let {
    block,
    store,
    always = false,
    triggerClass,
  }: { block: ListedBlock; store?: TreeScreen; always?: boolean; triggerClass?: string } = $props();

  const marks = $derived(always ? tags.marks(block) : tags.rowMarks(block));
  const interactive = $derived(store !== undefined && tags.actions(block).length > 0);

  const TONE: Record<StateMark['tone'], string> = {
    status: '',
    building: 'text-status-in-work',
    muted: 'text-muted-foreground',
  };

  function chipClass(mark: StateMark): string {
    return cn(
      'inline-flex h-[19px] shrink-0 items-center gap-1.5 rounded-full border border-current/25 bg-current/10 pr-2 pl-1.5 font-sans text-small leading-none font-medium',
      mark.tone === 'status' ? statusTone : TONE[mark.tone],
    );
  }

  const statusTone = $derived(statusText(tags.statusOf(block) ?? 'open'));
</script>

{#each marks as mark (`${mark.tone}:${mark.label}`)}
  {#if mark.tone === 'status' && interactive && store}
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        class={cn(
          chipClass(mark),
          'cursor-pointer pr-1.5 transition-colors duration-150 ease-instrument hover:opacity-80 data-[state=open]:opacity-80',
          triggerClass,
        )}
      >
        <span class="size-1.5 rounded-full bg-current"></span>
        <span class="label-lift">{mark.label}</span>
        <ChevronDown class="size-3 opacity-60" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="start" class="min-w-44">
        <StatusMenuItems {block} {store} />
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  {:else}
    <span class={chipClass(mark)}>
      <span class="size-1.5 rounded-full bg-current"></span>
      <span class="label-lift">{mark.label}</span>
    </span>
  {/if}
{/each}
