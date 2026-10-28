<script lang="ts">
  import Ban from '@lucide/svelte/icons/ban';
  import EyeOff from '@lucide/svelte/icons/eye-off';
  import Power from '@lucide/svelte/icons/power';
  import type { Snippet } from 'svelte';
  import type { HTMLAnchorAttributes } from 'svelte/elements';
  import type { ListedBlock } from '@tagma/server/graph/contract/wire/rows';
  import { LIFECYCLE } from '@tagma/server/graph/contract/wire/tags/lifecycle';
  import TagIcon from '$lib/features/graph/TagIcon.svelte';
  import StatusChip from '$lib/features/graph/StatusChip.svelte';
  import WriterBadge from '$lib/features/graph/WriterBadge.svelte';
  import { ReadState } from '$lib/features/graph/ReadState.svelte.js';
  import { SessionRegistry } from '$lib/features/graph/SessionRegistry.svelte.js';
  import { TagCatalog } from '$lib/features/graph/TagCatalog.svelte.js';

  import { timeAgo } from '$lib/shared/time.js';
  import type { TreeScreen } from '$lib/features/graph/TreeScreen.svelte.js';
  import { cn } from '$lib/shared/utils.js';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';

  const readState = ReadState.use();
  const sessions = SessionRegistry.use();
  const tags = TagCatalog.use();

  let {
    block,
    href,
    store,
    childCount = 0,
    layout = 'line',
    link = $bindable(null),
    attributes,
    class: className,
    leading,
    title,
    trailing,
  }: {
    block: ListedBlock;
    href: string;
    store?: TreeScreen;
    childCount?: number;
    layout?: 'line' | 'stacked' | 'compact';
    link?: HTMLAnchorElement | null;
    attributes?: HTMLAnchorAttributes;
    class?: string;
    leading?: Snippet;
    title: Snippet;
    trailing?: Snippet;
  } = $props();

  const off = $derived(tags.switchedOff(block));
  const unread = $derived(readState.isUnread(block.name, block.updatedAt));
  const holder = $derived(tags.holderOf(block));
  const lives = $derived(tags.supports(block, LIFECYCLE));
  const work = $derived(lives && !tags.isResting(block));
</script>

{#snippet state()}
  {#if lives}
    <span class="size-2 shrink-0 rounded-none" style:background={tags.statusVar(block)}></span>
  {/if}
{/snippet}

<div
  class={cn(
    'block-row group/row relative -mx-2 flex rounded-md px-2 py-0.5 transition-colors duration-100 ease-instrument hover:bg-hover',
    layout === 'stacked' ? 'flex-col' : 'items-start',
    className,
  )}
>
  <a
    bind:this={link}
    {...attributes}
    {href}
    class="absolute inset-0 rounded-md"
    aria-label={block.title.trim() || 'Untitled'}
    data-block={block.name}
  ></a>

  <div class={cn('flex min-w-0', layout === 'compact' ? 'items-center' : 'items-start', layout === 'stacked' ? 'w-full' : 'flex-1')}>
    {@render leading?.()}

    <span class="pointer-events-none mr-2 grid h-6 w-4 shrink-0 place-items-center">
      <TagIcon tag={tags.tagOf(block)} class="size-3.5 text-muted-foreground/70" />
    </span>

    {@render title()}
  </div>

  {#if layout === 'compact'}
    {#if childCount > 0}
      <span class="stamp tabular ml-2 shrink-0 self-center text-muted-foreground/60">{childCount}</span>
    {/if}
    {#if lives}
      <span class="ml-2 flex shrink-0 self-center">{@render state()}</span>
    {/if}
    {#if trailing}
      <div class="relative ml-2 flex shrink-0 items-center gap-1.5 self-center">
        {@render trailing()}
      </div>
    {/if}
  {:else}
    <div
      class={cn(
        'pointer-events-none flex h-6 shrink-0 items-center gap-1.5',
        layout === 'stacked' ? 'pl-6' : 'ml-3',
        trailing && 'group-hover/row:fade-under group-has-[[data-state=open]]/row:fade-under',
      )}
    >
      {#if block.blocked}
        <Tooltip text="Blocked by another open task">
          <span class="pointer-events-auto relative grid place-items-center">
            <Ban class="size-3 text-severity-lie/80" />
          </span>
        </Tooltip>
      {/if}
      {#if block.stealth === true}
        <Tooltip text="Stealth: kept in Tagma's data directory, the repository never carries it">
          <span class="pointer-events-auto relative grid place-items-center">
            <EyeOff class="size-3 text-muted-foreground/70" />
          </span>
        </Tooltip>
      {/if}
      {#if off}
        <Tooltip text="Switched off: this rule binds nobody until it is switched on">
          <span class="pointer-events-auto relative grid place-items-center">
            <Power class="size-3 text-muted-foreground/70" />
          </span>
        </Tooltip>
      {/if}
      <StatusChip {block} {store} triggerClass="pointer-events-auto relative" />
      {#if tags.underway(block) && holder !== null}
        <WriterBadge writer={sessions.writerOf(holder)} class="pointer-events-auto relative" />
      {/if}
      {#if childCount > 0}
        <span class="stamp tabular whitespace-nowrap text-muted-foreground/60">{childCount}</span>
      {/if}
      {@render state()}
      {#if work}
        <span
          class={cn(
            'stamp tabular whitespace-nowrap transition-colors',
            unread ? 'font-medium text-foreground/90' : 'text-muted-foreground/45',
          )}
        >
          {timeAgo(block.updatedAt)}
        </span>
      {/if}
    </div>
    {#if trailing}
      <div class="absolute top-0.5 right-1 flex h-6 items-center">
        {@render trailing()}
      </div>
    {/if}
  {/if}
</div>
