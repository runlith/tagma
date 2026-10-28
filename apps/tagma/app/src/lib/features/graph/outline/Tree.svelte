<script lang="ts">
  import Plus from '@lucide/svelte/icons/plus';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import TagIcon from '$lib/features/graph/TagIcon.svelte';
  import OutlineRow from '$lib/features/graph/outline/Row.svelte';
  import { TagCatalog } from '$lib/features/graph/TagCatalog.svelte.js';
  import { Button } from '$lib/shared/ui/button/index.js';
  import * as Dialog from '$lib/shared/ui/dialog/index.js';
  import * as DropdownMenu from '$lib/shared/ui/dropdown-menu/index.js';
  import { timeAgo } from '$lib/shared/time.js';
  import type { TreeScreen } from '$lib/features/graph/TreeScreen.svelte.js';

  const tags = TagCatalog.use();

  let { store }: { store: TreeScreen } = $props();

  const rootChildren = $derived(store.rootName === null ? [] : store.visibleChildren(store.rootName));

  let trashOpen = $state(false);

  function onWindowKeydown(event: KeyboardEvent): void {
    if (event.code !== 'KeyZ' || !(event.metaKey || event.ctrlKey) || event.shiftKey) return;
    const target = event.target as HTMLElement | null;
    if (target && (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
    if (store.canUndo) {
      event.preventDefault();
      void store.undoLastDelete();
    }
  }
</script>

<svelte:window onkeydown={onWindowKeydown} />

{#if !tags.served}
  <div class="flex items-center gap-2 pl-6 text-ui text-muted-foreground">
    <span>{tags.error === null ? 'Loading vocabulary…' : 'Vocabulary unavailable.'}</span>
    {#if tags.error !== null}
      <button type="button" class="rounded-md px-2 py-1 text-foreground hover:bg-hover" onclick={() => tags.retry()}>Retry</button>
    {/if}
  </div>
{:else}
  <div class="-ml-2">
    {#each rootChildren as name (name)}
      <OutlineRow {store} {name} />
    {/each}

    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        class="group/add -mx-2 mt-0.5 flex h-8 items-center rounded-lg pr-2 pl-4 text-ui text-muted-foreground/70 transition-colors hover:bg-hover hover:text-foreground data-[state=open]:bg-selected data-[state=open]:text-foreground"
      >
        <span class="mr-2 grid size-4 place-items-center rounded-full border border-dashed border-current">
          <Plus class="size-3" />
        </span>
        Add block
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="start" class="min-w-40" returnFocus={false}>
        {#each tags.titleOnly as tag (tag)}
          <DropdownMenu.Item onSelect={() => store.rootName !== null && store.createChild(store.rootName, tag)}>
            {#snippet lead()}<TagIcon {tag} class="size-3.5" />{/snippet}
            <span class="capitalize">{tag}</span>
          </DropdownMenu.Item>
        {/each}
      </DropdownMenu.Content>
    </DropdownMenu.Root>

    {#if store.trashRoots.length > 0}
      <div class="mt-3 border-t border-vein pt-2">
        <button
          type="button"
          class="-mx-2 flex h-7 items-center gap-2 rounded-lg pr-2 pl-4 text-small text-muted-foreground/60 transition-colors hover:bg-hover hover:text-foreground"
          onclick={() => (trashOpen = true)}
        >
          <span class="grid w-4 place-items-center"><Trash2 class="size-3" /></span>
          Trash
          <span class="stamp tabular">{store.trashRoots.length}</span>
        </button>
      </div>
    {/if}
  </div>
{/if}

<Dialog.Root bind:open={trashOpen}>
  <Dialog.Content class="sm:max-w-xl">
    <Dialog.Header>
      <Dialog.Title class="text-page">Trash</Dialog.Title>
      <Dialog.Description>Deleted blocks stay here until restored.</Dialog.Description>
    </Dialog.Header>
    <div class="-mx-2 max-h-96 overflow-y-auto px-2">
      {#each store.trashRoots as row (row.name)}
        <div class="group/trash flex items-center gap-2 rounded-lg px-2 py-1.5 text-ui transition-colors hover:bg-hover">
          <TagIcon tag={tags.tagOf(row)} class="size-3.5 shrink-0 text-muted-foreground" />
          <span class="min-w-0 flex-1 truncate {row.title.trim() ? '' : 'text-muted-foreground'}">
            {row.title.trim() || 'Untitled'}
          </span>
          {#if row.deletedAt}
            <span class="shrink-0 stamp tabular text-muted-foreground/60">{timeAgo(row.deletedAt)}</span>
          {/if}
          <Button variant="outline" size="xs" onclick={() => store.restore(row.name)}>Restore</Button>
        </div>
      {/each}
    </div>
  </Dialog.Content>
</Dialog.Root>
