<script lang="ts" generics="T extends ChangeItem">
  import Folder from '@lucide/svelte/icons/folder';
  import type { Snippet } from 'svelte';
  import type { Attachment } from 'svelte/attachments';
  import PathText from '$lib/shared/PathText.svelte';
  import ChangeRow from './ChangeRow.svelte';
  import { type ChangeItem, insetOf, opens } from './changeItem.js';
  import { pathGroups } from './pathGroups.js';

  let {
    items,
    grouped,
    selected = null,
    depth = 0,
    onOpen,
    onKeep,
    link,
    acts,
    aside,
  }: {
    items: readonly T[];
    grouped: boolean;
    selected?: string | null;
    depth?: number;
    onOpen?: ((item: T) => void) | undefined;
    onKeep?: ((item: T) => void) | undefined;
    link?: ((item: T) => Attachment<HTMLElement>) | undefined;
    acts?: Snippet<[T]>;
    aside?: Snippet<[T]>;
  } = $props();

  const groups = $derived(grouped ? pathGroups(items) : [{ directory: '', entries: items }]);
</script>

{#each groups as group (group.directory)}
  {#if grouped && group.directory !== ''}
    <div
      class="flex h-6 min-w-0 items-center gap-1.5 pr-2 text-small text-muted-foreground/75"
      style:padding-left="{insetOf(depth)}px"
      data-change-group={group.directory}
    >
      <Folder class="size-3.5 shrink-0 text-muted-foreground/55" />
      <PathText path={group.directory.slice(0, -1)} />
    </div>
  {/if}
  {#each group.entries as item (item.path)}
    {#snippet rowActs()}
      {@render acts?.(item)}
    {/snippet}
    {#snippet rowAside()}
      {@render aside?.(item)}
    {/snippet}
    <ChangeRow
      path={item.path}
      status={item.status}
      lines={item.lines}
      selected={item.path === selected}
      bare={grouped}
      depth={depth + (grouped && group.directory !== '' ? 1 : 0)}
      onOpen={opens(item) && onOpen !== undefined ? () => onOpen(item) : undefined}
      onKeep={opens(item) && onKeep !== undefined ? () => onKeep(item) : undefined}
      link={opens(item) ? link?.(item) : undefined}
      acts={acts === undefined ? undefined : rowActs}
      aside={aside === undefined ? undefined : rowAside}
    />
  {/each}
{/each}
