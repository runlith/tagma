<script lang="ts">
  import Archive from '@lucide/svelte/icons/archive';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import ChevronsUpDown from '@lucide/svelte/icons/chevrons-up-down';
  import Folder from '@lucide/svelte/icons/folder';
  import Pin from '@lucide/svelte/icons/pin';
  import PinOff from '@lucide/svelte/icons/pin-off';
  import Plus from '@lucide/svelte/icons/plus';
  import Search from '@lucide/svelte/icons/search';
  import X from '@lucide/svelte/icons/x';
  import { threadMark, type ThreadState } from '$lib/features/threads/Life.svelte';
  import { Notices } from '$lib/features/notices/Service.svelte.js';
  import { Filing } from '$lib/features/threads/filing.js';
  import { FolderActs } from '$lib/features/threads/FolderActs.js';
  import { ThreadList } from '$lib/features/threads/List.svelte.js';
  import ListRefused from '$lib/features/threads/ListRefused.svelte';
  import { ProviderCatalog } from '$lib/features/providers/Catalog.svelte.js';
  import { ThreadFolds } from '$lib/features/threads/threadFolds.svelte.js';
  import type { ThreadTreeNode } from '$lib/features/threads/forest.js';
  import { columnEntries, type FolderEntry, matchShelf } from '$lib/features/threads/tree.js';
  import { Addresses } from '$lib/features/workspace/Addresses.js';
  import { cn } from '$lib/shared/utils.js';
  import { Attention } from '../attention/Attention.svelte.js';
  import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
  import Actions from './Actions.svelte';
  import Sheet from './Sheet.svelte';
  import Swipe from './Swipe.svelte';
  import Tabs from './Tabs.svelte';
  import ThreadRow from './ThreadRow.svelte';

  let { project, draft }: { project: string; draft: string } = $props();

  type Filter = Extract<ThreadState, 'working' | 'waiting' | 'failed' | 'unread'>;

  const FILTERS: readonly { id: Filter; label: string }[] = [
    { id: 'waiting', label: 'Waiting' },
    { id: 'working', label: 'Working' },
    { id: 'failed', label: 'Failed' },
    { id: 'unread', label: 'Unread' },
  ];
  const ACTIONS_PX = 144;

  const list = ThreadList.use();
  const catalog = ProviderCatalog.use();
  const filing = new Filing(list, FolderActs.use(), Notices.use());
  const folds = ThreadFolds.use();
  const workspace = Workspace.use();
  const attention = Attention.use();
  const addresses = Addresses.use();

  let query = $state('');
  let filter = $state<Filter | null>(null);
  let picking = $state(false);
  let reading = $state(false);
  let holdingId = $state<string | null>(null);
  const held = $derived(holdingId === null ? null : (list.row(holdingId) ?? null));

  function walk(nodes: readonly ThreadTreeNode[], visit: (node: ThreadTreeNode) => void): void {
    for (const node of nodes) {
      visit(node);
      walk(node.children, visit);
    }
  }

  const byState = $derived.by(() => {
    const found = new Map<ThreadState, ThreadTreeNode[]>();
    walk(list.tree, (node) => {
      const state = threadMark(node.row).state;
      const bucket = found.get(state);
      if (bucket === undefined) found.set(state, [node]);
      else bucket.push(node);
    });
    return found;
  });
  const chips = $derived(
    FILTERS.flatMap((chip) => {
      const count = byState.get(chip.id)?.length ?? 0;
      return count > 0 || filter === chip.id ? [{ ...chip, count }] : [];
    }),
  );
  const searching = $derived(query.trim() !== '');
  const shown = $derived(matchShelf(catalog.models, list.tree, list.folders, query));
  const entries = $derived(
    columnEntries(shown, searching || folds.isPinnedOpen(), {
      folders: list.folders,
      isOpen: (id) => folds.isOpen(id),
      keepId: null,
      filtering: searching,
    }),
  );
  const filtered = $derived(filter === null ? null : (byState.get(filter) ?? []).map((node) => ({ ...node, children: [] })));

  const needs = $derived.by(() => {
    const counts = new Map<number, number>();
    for (const row of attention.rows) if (row.kind !== 'finished') counts.set(row.project.id, (counts.get(row.project.id) ?? 0) + 1);
    return counts;
  });

  async function more(): Promise<void> {
    reading = true;
    try {
      await list.readMore();
    } finally {
      reading = false;
    }
  }
</script>

<svelte:head><title>{project}</title></svelte:head>

<header class="grid shrink-0 gap-2 bg-chrome px-3 pt-2 pb-2">
  <div class="flex items-center gap-1">
    <button
      type="button"
      class="-ml-1 flex min-h-11 min-w-0 flex-1 items-center gap-1.5 px-1 text-left active:opacity-70"
      aria-label="Switch project"
      onclick={() => (picking = true)}
    >
      <span class="min-w-0 truncate text-title">{project}</span>
      <ChevronsUpDown class="size-4 shrink-0 text-muted-foreground" />
    </button>
    <a class="grid size-11 shrink-0 place-items-center rounded-full text-foreground active:bg-hover" href={draft} aria-label="New thread">
      <Plus class="size-4" />
    </a>
  </div>
  <label class="flex h-10 items-center gap-2 rounded-lg bg-hover px-3 text-muted-foreground">
    <Search class="size-4 shrink-0" />
    <input
      type="search"
      class="min-w-0 flex-1 bg-transparent text-body text-foreground outline-none placeholder:text-muted-foreground"
      placeholder="Search threads"
      enterkeyhint="search"
      bind:value={query}
    />
    {#if searching}
      <button type="button" class="-mr-2 grid size-10 place-items-center" aria-label="Clear search" onclick={() => (query = '')}>
        <X class="size-4" />
      </button>
    {/if}
  </label>
  {#if chips.length > 0}
    <div class="-mx-3 flex gap-1.5 overflow-x-auto px-3">
      <button
        type="button"
        class={cn(
          'min-h-8 shrink-0 rounded-full px-3 text-ui font-medium',
          filter === null ? 'bg-primary text-primary-foreground' : 'bg-hover text-muted-foreground',
        )}
        onclick={() => (filter = null)}
      >
        All
      </button>
      {#each chips as chip (chip.id)}
        <button
          type="button"
          class={cn(
            'flex min-h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-ui font-medium',
            filter === chip.id ? 'bg-primary text-primary-foreground' : 'bg-hover text-muted-foreground',
          )}
          aria-pressed={filter === chip.id}
          onclick={() => (filter = filter === chip.id ? null : chip.id)}
        >
          {chip.label}<span class="tabular opacity-70">{chip.count}</span>
        </button>
      {/each}
    </div>
  {/if}
</header>

<div class="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-4">
  {#if filtered !== null}
    {#each filtered as node (node.row.id)}
      <ThreadRow {node} {project} />
    {:else}
      <p class="px-4 pt-6 text-body text-muted-foreground">Nothing here now.</p>
    {/each}
  {:else}
    {#if list.refused !== null}
      <div class="px-2 pt-6"><ListRefused reason={list.refused} onRetry={() => list.retry()} /></div>
    {/if}
    {#each entries as entry (entry.key)}
      {#if entry.kind === 'pinned'}
        {@const open = searching || folds.isPinnedOpen()}
        <button
          type="button"
          class="flex min-h-10 w-full items-center gap-1.5 px-4 text-small font-medium text-muted-foreground"
          aria-expanded={open}
          onclick={() => folds.togglePinned()}
        >
          Pinned · {entry.count}
          <ChevronRight class={['size-3.5 transition-transform', open && 'rotate-90']} />
        </button>
      {:else if entry.kind === 'line'}
        <div class="mx-4 my-2 h-px bg-border"></div>
      {:else if entry.kind === 'folder'}
        {@render branch(entry)}
      {:else}
        {@render root(entry.node)}
      {/if}
    {:else}
      {#if list.refused === null}
        <p class="px-4 pt-6 text-body text-muted-foreground">
          {list.roots === null ? 'Reading…' : searching ? 'No thread matches.' : 'No threads yet.'}
        </p>
      {/if}
    {/each}
    {#if list.more > 0 && !searching}
      <button
        type="button"
        class="flex min-h-12 w-full items-center justify-center px-4 text-ui font-medium text-primary disabled:text-muted-foreground"
        disabled={reading}
        onclick={() => void more()}
      >
        {reading ? 'Reading…' : `${list.more} more`}
      </button>
    {/if}
  {/if}
</div>

<Tabs on="threads" />

{#if picking}
  <Sheet label="Projects" title="Projects" onClose={() => (picking = false)}>
    {#each workspace.projects as other (other.id)}
      {@const count = needs.get(other.id) ?? 0}
      <a
        href={addresses.thread(null, other.name)}
        class={cn('flex min-h-12 items-center gap-3 px-5 active:bg-hover', other.name === project && 'bg-selected')}
        onclick={() => (picking = false)}
      >
        <span class="min-w-0 flex-1 truncate text-body">{other.name}</span>
        {#if count > 0}<span class="tabular text-ui font-medium text-status-open">{count}</span>{/if}
      </a>
    {/each}
  </Sheet>
{/if}

{#if held !== null}
  <Actions row={held} onClose={() => (holdingId = null)} />
{/if}

{#snippet branch(entry: FolderEntry)}
  <button
    type="button"
    class="flex min-h-12 w-full items-center gap-3 pr-4 text-left active:bg-hover"
    style:padding-left="calc(var(--spacing) * {4 + entry.depth * 4})"
    aria-expanded={entry.open}
    onclick={() => folds.toggle(entry.folder.id)}
  >
    <ChevronRight class={['size-4 shrink-0 text-muted-foreground transition-transform', entry.open && 'rotate-90']} />
    <Folder class="size-4 shrink-0 text-muted-foreground" />
    <span class="min-w-0 flex-1 truncate text-body font-medium">{entry.folder.name}</span>
    {#if entry.team.working > 0}<span class="size-1.5 rounded-full bg-status-in-work"></span>{/if}
    {#if entry.team.asking > 0}<span class="size-1.5 rounded-full bg-status-open"></span>{/if}
    <span class="tabular text-small text-muted-foreground">{entry.trees.length}</span>
  </button>
  {#each entry.folders as sub (sub.key)}
    {@render branch(sub)}
  {/each}
  {#each entry.drawn as node (node.row.id)}
    <div style:padding-left="calc(var(--spacing) * {4 + entry.depth * 4})">{@render root(node)}</div>
  {/each}
{/snippet}

{#snippet root(node: ThreadTreeNode)}
  {@const pinned = node.row.pinnedAt !== null}
  <ThreadRow {node} {project}>
    {#snippet frame(line)}
      <Swipe width={ACTIONS_PX} onHold={() => (holdingId = node.row.id)}>
        {#snippet actions(close)}
          <button
            type="button"
            class="flex flex-1 flex-col items-center justify-center gap-1 bg-status-open text-small font-medium text-primary-foreground disabled:opacity-60"
            disabled={list.busy(node.row.id, 'pin')}
            onclick={() => {
              close();
              void (pinned ? list.setPinned(node.row.id, false) : filing.pin([node.row.id]));
            }}
          >
            {#if pinned}<PinOff class="size-4" />Unpin{:else}<Pin class="size-4" />Pin{/if}
          </button>
          <button
            type="button"
            class="flex flex-1 flex-col items-center justify-center gap-1 bg-status-none text-small font-medium text-primary-foreground disabled:opacity-60"
            disabled={list.busy(node.row.id, 'archive')}
            onclick={() => {
              close();
              void filing.archive([node.row.id]);
            }}
          >
            <Archive class="size-4" />Archive
          </button>
        {/snippet}
        {@render line()}
      </Swipe>
    {/snippet}
  </ThreadRow>
{/snippet}
