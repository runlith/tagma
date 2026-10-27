<script lang="ts">
  import Waiting from '@runlith/chat-ui/Waiting.svelte';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import ChevronsDownUp from '@lucide/svelte/icons/chevrons-down-up';
  import FilePlus from '@lucide/svelte/icons/file-plus';
  import Folder from '@lucide/svelte/icons/folder';
  import FolderOpen from '@lucide/svelte/icons/folder-open';
  import FolderPlus from '@lucide/svelte/icons/folder-plus';
  import { elementScroll, observeElementOffset, observeElementRect, Virtualizer, type VirtualItem } from '@tanstack/virtual-core';
  import { tick, untrack } from 'svelte';
  import { ENTRY_INK, ENTRY_LETTER } from '$lib/features/checkout/entryLetter.js';
  import { handHues } from '$lib/features/checkout/handHues.js';
  import { holderName } from '$lib/features/worktrees/holders.js';
  import { holderKey } from '@tagma/server/workspace/contract/wire/checkout';
  import { Holdings } from '$lib/features/checkout/Holdings.svelte.js';
  import { Outside } from './Outside.svelte.js';
  import FileIcon from '$lib/shared/FileIcon.svelte';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';
  import { ThreadNames } from '$lib/shared/threads/Names.svelte.js';
  import { cn } from '$lib/shared/utils.js';
  import { Column } from './Column.svelte.js';
  import { Explorer, type TreeRow } from './Explorer.svelte.js';
  import { FileOps } from './FileOps.svelte.js';
  import { FileSearch } from './FileSearch.svelte.js';
  import { kindFor } from './tab.js';
  import { Checkout } from '../Selection.svelte.js';
  import { FileOpener } from './FileOpener.svelte.js';
  import { Tabs } from './Tabs.svelte.js';
  import TreeMenu from './TreeMenu.svelte';
  import TreeName from './TreeName.svelte';
  import { dropMoves, type MenuAim } from './treeMoves.js';

  type EntryRow = Extract<TreeRow, { readonly kind: 'entry' }>;

  const explorer = Explorer.use();
  const ops = FileOps.use();
  const search = FileSearch.use();
  const tabs = Tabs.use();
  const opener = FileOpener.use();
  const checkout = Checkout.use();
  const holdings = Holdings.use();
  const names = ThreadNames.use();
  const column = Column.use();
  const outside = Outside.use();

  const ROW = 24;

  const rows = $derived(explorer.rows);

  let virtualizer = $state.raw<Virtualizer<HTMLElement, HTMLElement> | undefined>();
  let mounted = $state.raw<readonly VirtualItem[]>([]);
  let total = $state(0);

  function options(element: HTMLElement) {
    return {
      count: rows.length,
      getScrollElement: () => element,
      estimateSize: () => ROW,
      getItemKey: (index: number) => rows[index]?.key ?? index,
      overscan: 8,
      observeElementRect,
      observeElementOffset,
      scrollToFn: elementScroll,
      onChange: () => publish(),
    };
  }

  function publish(): void {
    const made = virtualizer;
    if (made === undefined) return;
    mounted = made.getVirtualItems();
    total = made.getTotalSize();
  }

  $effect(() => {
    const element = host;
    if (element === null) return;
    const made = new Virtualizer(untrack(() => options(element)));
    const release = made._didMount();
    virtualizer = made;
    return () => {
      release();
      virtualizer = undefined;
      mounted = [];
      total = 0;
    };
  });

  $effect(() => {
    const made = virtualizer;
    const element = host;
    void rows;
    if (made === undefined || element === null) return;
    made.setOptions(options(element));
    made._willUpdate();
    publish();
  });

  let host = $state<HTMLElement | null>(null);
  let focused = $state<string | null>(null);
  const tabbable = $derived(
    mounted.some((item) => rows[item.index]?.key === focused) ? focused : (rows[mounted[0]?.index ?? 0]?.key ?? null),
  );
  let typed = '';
  let typedAt = 0;

  const rowOf = (path: string): HTMLElement | undefined =>
    [...(host?.querySelectorAll<HTMLElement>('[data-tree-path]') ?? [])].find((node) => node.dataset['treePath'] === path);

  const opens = (row: EntryRow): boolean => row.type === 'directory' || (row.type === 'link' && row.target === 'directory');

  const readable = (row: EntryRow): boolean => row.type === 'file' || (row.type === 'link' && row.target === 'file');

  const active = $derived.by(() => {
    const tab = tabs.active;
    return tab !== null && tab.kind !== 'diff' && tab.rootId === explorer.rootId ? tab.path : null;
  });

  let intent = 0;

  function latest(): () => boolean {
    const mine = ++intent;
    return () => mine === intent;
  }

  $effect(() => () => void (intent += 1));

  $effect(() => {
    const path = active;
    if (path === null) return;
    untrack(() => {
      const live = latest();
      void explorer
        .reveal(path)
        .then(() => tick())
        .then(() => {
          if (!live()) return;
          focused = path;
          reveal(path);
        });
    });
  });

  $effect(() => {
    const point = column.pointed;
    if (point === null || point.root !== explorer.rootId) return;
    untrack(() => {
      column.release(point);
      const live = latest();
      void explorer.reveal(point.path).then(async (found) => {
        if (!found || !live()) return;
        explorer.unfold(point.path);
        await tick();
        if (live()) focusRow(point.path);
      });
    });
  });

  $effect(() => {
    void column.focusing;
    untrack(() => {
      if (column.view === 'files') (rowOf(focused ?? '') ?? host)?.focus();
    });
  });

  function openFile(row: EntryRow, how: 'preview' | 'open'): void {
    const rootId = explorer.rootId;
    if (rootId === null || !readable(row)) return;
    const root = checkout.row?.path;
    if (row.mediaType !== undefined && root !== undefined && !opener.shows(`${root}/${row.path}`, row.mediaType)) return;
    tabs.open({ rootId, path: row.path, kind: kindFor(row.path) }, how);
  }

  function activate(row: EntryRow, how: 'preview' | 'open'): void {
    focused = row.path;
    if (opens(row)) explorer.toggle(row.path, row.ignored);
    else openFile(row, how);
  }

  let menu = $state<MenuAim | null>(null);
  let dropOn = $state<string | null>(null);
  let dragged: readonly string[] = [];
  let releaseDrag: (() => void) | null = null;

  const entryRows = (): EntryRow[] => rows.filter((row): row is EntryRow => row.kind === 'entry');

  function targets(row: EntryRow): readonly string[] {
    return explorer.selected.has(row.path) ? [...explorer.selected] : [row.path];
  }

  function pick(row: EntryRow, event: MouseEvent): void {
    focused = row.path;
    if (event.metaKey || event.ctrlKey) explorer.select(row.path, 'toggle');
    else if (event.shiftKey) explorer.select(row.path, 'range');
    else {
      explorer.select(row.path, 'only');
      activate(row, 'preview');
    }
  }

  function aside(event: MouseEvent, row: EntryRow): void {
    event.preventDefault();
    if (!explorer.selected.has(row.path)) explorer.select(row.path, 'only');
    focused = row.path;
    menu = { x: event.clientX, y: event.clientY, path: row.path, directory: opens(row), paths: targets(row) };
  }

  function createHere(kind: 'file' | 'folder'): void {
    const row = entryRows().find((one) => one.path === focused);
    const dir = row === undefined ? '' : opens(row) ? row.path : parentOf(row.path);
    ops.beginCreate(dir ?? '', kind);
  }

  function findIn(dir: string): void {
    search.include = `${dir}/**`;
    column.show('search');
  }

  function dragStart(event: DragEvent, row: EntryRow): void {
    dragged = targets(row);
    releaseDrag?.();
    releaseDrag = ops.holdTree();
    event.dataTransfer?.setData('text/plain', row.path);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copyMove';
  }

  function dragOver(event: DragEvent, dir: string): void {
    if (dragged.length === 0 || dropMoves(dragged, dir).length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    dropOn = dir;
  }

  function dragEnd(): void {
    dragged = [];
    dropOn = null;
    releaseDrag?.();
    releaseDrag = null;
  }

  function drop(event: DragEvent, dir: string): void {
    const moves = dropMoves(dragged, dir);
    if (moves.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    dragEnd();
    void ops.move(moves);
  }

  function holdersOf(path: string): { readonly name: string; readonly hue: string; readonly lines: string }[] {
    const verdict = holdings.of(path)?.verdict;
    if (verdict === undefined || verdict.verdict !== 'proven') return [];
    const hands = verdict.hands.filter((hand) => !hand.retired);
    const hues = handHues(hands.map((hand) => ({ threadId: holderKey(hand.holder) })));
    return hands.map((hand) => ({
      name: holderName(hand.holder, (thread) => names.of(thread)?.label ?? null),
      hue: hues.get(holderKey(hand.holder)) ?? 'var(--hand-1)',
      lines: `+${hand.added} −${hand.removed}`,
    }));
  }

  const titleOf = (held: readonly { readonly name: string; readonly lines: string }[]): string | undefined =>
    held.length === 0 ? undefined : held.map((one) => `${one.name} ${one.lines}`).join(', ');

  function reveal(path: string): void {
    const at = rows.findIndex((row) => row.key === path);
    if (at !== -1) virtualizer?.scrollToIndex(at, { align: 'auto' });
  }

  function focusRow(path: string): void {
    focused = path;
    reveal(path);
    void tick().then(() => rowOf(path)?.focus());
  }

  function parentOf(path: string): string | null {
    const cut = path.lastIndexOf('/');
    return cut === -1 ? null : path.slice(0, cut);
  }

  function jump(letter: string): void {
    const now = Date.now();
    typed = now - typedAt > 800 ? letter : typed + letter;
    typedAt = now;
    const entries = rows.filter((row): row is EntryRow => row.kind === 'entry');
    const from = Math.max(
      entries.findIndex((row) => row.path === focused),
      0,
    );
    const ordered = [...entries.slice(typed.length === 1 ? from + 1 : from), ...entries.slice(0, from)];
    const hit = ordered.find((row) => row.name.toLowerCase().startsWith(typed));
    if (hit !== undefined) focusRow(hit.path);
  }

  function editing(event: KeyboardEvent, row: EntryRow | undefined): boolean {
    const mod = event.metaKey || event.ctrlKey;
    if (mod && event.code === 'KeyZ') {
      void (event.shiftKey ? ops.redo() : ops.undo());
    } else if (mod && event.key === 'Backspace' && row !== undefined) {
      void ops.trash(targets(row));
    } else if ((event.key === 'F2' || (event.key === 'Enter' && !mod)) && row !== undefined) {
      ops.beginRename(row.path);
    } else if (event.key === 'Escape' && explorer.selected.size > 1) {
      explorer.select(focused ?? '', 'only');
    } else return false;
    event.preventDefault();
    return true;
  }

  function keys(event: KeyboardEvent): void {
    if (event.altKey) return;
    const entries = entryRows();
    const at = entries.findIndex((row) => row.path === focused);
    const row = entries[at];
    if (editing(event, row)) return;
    if (event.ctrlKey) return;
    if (event.key === 'ArrowDown' && event.metaKey && row !== undefined) {
      event.preventDefault();
      activate(row, 'open');
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = entries[Math.min(Math.max(at + (event.key === 'ArrowDown' ? 1 : -1), 0), entries.length - 1)];
      if (next !== undefined) focusRow(next.path);
    } else if (event.key === 'ArrowRight' && row !== undefined) {
      event.preventDefault();
      if (opens(row) && !row.open) explorer.toggle(row.path, row.ignored);
      else if (row.open) {
        const child = entries[at + 1];
        if (child !== undefined && child.path.startsWith(`${row.path}/`)) focusRow(child.path);
      }
    } else if (event.key === 'ArrowLeft' && row !== undefined) {
      event.preventDefault();
      if (row.open) explorer.collapse(row.path);
      else {
        const parent = parentOf(row.path);
        if (parent !== null) focusRow(parent);
      }
    } else if ((event.key === ' ' || event.key === 'Enter') && row !== undefined) {
      event.preventDefault();
      activate(row, event.key === 'Enter' ? 'open' : 'preview');
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      const edge = event.key === 'Home' ? entries[0] : entries.at(-1);
      if (edge !== undefined) focusRow(edge.path);
    } else if (event.key.length === 1 && !event.metaKey && event.key !== ' ') {
      jump(event.key.toLowerCase());
    }
  }
</script>

{#snippet lead(row: EntryRow)}
  {#if opens(row)}
    {#if row.open}<ChevronDown class="size-3 shrink-0 text-muted-foreground" />{:else}<ChevronRight
        class="size-3 shrink-0 text-muted-foreground"
      />{/if}
    {#if row.open}<FolderOpen class="size-3.5 shrink-0 text-muted-foreground" />{:else}<Folder
        class="size-3.5 shrink-0 text-muted-foreground"
      />{/if}
  {:else}
    <span class="size-3 shrink-0"></span>
    <FileIcon path={row.path} />
  {/if}
{/snippet}

<div class="flex min-h-0 flex-1 flex-col" data-files-explorer>
  <div class="flex h-7 shrink-0 items-center justify-end gap-px px-1.5">
    <Tooltip text="New file">
      <button
        type="button"
        class="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
        aria-label="New file"
        onclick={() => createHere('file')}
      >
        <FilePlus class="size-3.5" />
      </button>
    </Tooltip>
    <Tooltip text="New folder">
      <button
        type="button"
        class="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
        aria-label="New folder"
        onclick={() => createHere('folder')}
      >
        <FolderPlus class="size-3.5" />
      </button>
    </Tooltip>
    <Tooltip text="Collapse folders">
      <button
        type="button"
        class="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
        aria-label="Collapse folders"
        onclick={() => explorer.expanded.clear()}
      >
        <ChevronsDownUp class="size-3.5" />
      </button>
    </Tooltip>
  </div>
  <div
    bind:this={host}
    class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto pb-2 outline-none"
    role="tree"
    tabindex="-1"
    aria-label="Files"
    onkeydown={keys}
    ondragover={(event) => dragOver(event, '')}
    ondrop={(event) => drop(event, '')}
  >
    {#if explorer.listingOf('')?.failed}
      <p class="px-3 py-2 text-ui text-muted-foreground" data-files-failed>{explorer.listingOf('')?.failed}</p>
    {:else if explorer.listingOf('') === undefined}
      <div class="grid gap-2 p-3" aria-busy="true">
        {#each [48, 76, 62, 70] as width, index (index)}
          <span class="block h-2 animate-pulse rounded-sm bg-selected" style:width="{width}%"></span>
        {/each}
      </div>
    {/if}
    <div class="relative w-full" style={`height:${total}px`}>
      {#each mounted as item (item.key)}
        {@const row = rows[item.index]}
        {#if row === undefined}
          <!-- the window ahead of the rows: nothing to draw -->
        {:else if row.kind === 'entry'}
          {@const status = explorer.statusOf(row.path, opens(row))}
          {@const held = status === undefined || opens(row) ? [] : holdersOf(row.path)}
          {@const selected = active === row.path || explorer.selected.has(row.path)}
          {#if row.renaming}
            <div
              class="absolute inset-x-0 flex h-6 w-full min-w-0 items-center gap-1.5 bg-selected pr-2 text-ui"
              style:padding-left="calc(var(--spacing) * {row.depth * 3 + 2})"
              style:top="{item.start}px"
              data-tree-renaming={row.path}
            >
              {@render lead(row)}
              <TreeName
                initial={row.name}
                stem={!opens(row)}
                label="Rename {row.name}"
                onCommit={(name) => ops.commitDraft(name)}
                onCancel={() => {
                  ops.endDraft();
                  rowOf(row.path)?.focus();
                }}
              />
            </div>
          {:else}
            <button
              type="button"
              role="treeitem"
              aria-level={row.depth + 1}
              aria-expanded={opens(row) ? row.open : undefined}
              aria-selected={selected}
              tabindex={tabbable === row.path ? 0 : -1}
              class={cn(
                'absolute inset-x-0 flex h-6 w-full min-w-0 items-center gap-1.5 pr-2 text-left text-ui outline-none',
                selected ? 'bg-selected' : 'hover:bg-hover',
                dropOn !== null && (opens(row) ? dropOn === row.path : dropOn === parentOf(row.path)) && 'inset-ring-1 inset-ring-ring',
                'focus-visible:inset-ring-1 focus-visible:inset-ring-ring',
                row.ignored && 'text-muted-foreground/60',
                row.type === 'link' && (row.target === 'broken' || row.target === 'outside' || row.target === 'unreadable') && 'opacity-60',
              )}
              style:padding-left="calc(var(--spacing) * {row.depth * 3 + 2})"
              style:top="{item.start}px"
              title={titleOf(held)}
              data-tree-path={row.path}
              data-tree-kind={opens(row) ? 'directory' : 'file'}
              draggable="true"
              onclick={(event) => pick(row, event)}
              oncontextmenu={(event) => aside(event, row)}
              ondragstart={(event) => dragStart(event, row)}
              ondragover={(event) => dragOver(event, opens(row) ? row.path : (parentOf(row.path) ?? ''))}
              ondrop={(event) => drop(event, opens(row) ? row.path : (parentOf(row.path) ?? ''))}
              ondragend={dragEnd}
              ondblclick={() => {
                if (!opens(row)) openFile(row, 'open');
              }}
            >
              {@render lead(row)}
              <span
                class={cn(
                  'min-w-0 flex-1 truncate',
                  status !== undefined && !row.ignored && ENTRY_INK[status],
                  status === 'deleted' && 'line-through',
                )}>{row.name}</span
              >
              {#if row.loading}
                <Waiting class="size-3 text-muted-foreground" label="Loading" />
              {/if}
              {#each held as one (one.name)}
                <span class="size-1.5 shrink-0 rounded-full" style:background={one.hue} data-tree-holder></span>
              {/each}
              {#if status !== undefined}
                {#if opens(row)}
                  <span class={cn('shrink-0 text-meta opacity-40', ENTRY_INK[status])} data-tree-bubble>●</span>
                {:else}
                  <span class={cn('w-3 shrink-0 text-center font-mono text-meta font-bold', ENTRY_INK[status])} data-tree-letter>
                    {ENTRY_LETTER[status]}
                  </span>
                {/if}
              {/if}
            </button>
          {/if}
        {:else if row.kind === 'draft'}
          <div
            class="absolute inset-x-0 flex h-6 w-full min-w-0 items-center gap-1.5 pr-2 text-ui"
            style:padding-left="calc(var(--spacing) * {row.depth * 3 + 2})"
            style:top="{item.start}px"
            data-tree-draft={row.mode}
          >
            <span class="size-3 shrink-0"></span>
            {#if row.mode === 'folder'}<Folder class="size-3.5 shrink-0 text-muted-foreground" />{:else}<FileIcon path="" />{/if}
            <TreeName
              label={row.mode === 'folder' ? 'New folder name' : 'New file name'}
              onCommit={(name) => ops.commitDraft(name)}
              onCancel={() => {
                ops.endDraft();
                host?.focus();
              }}
            />
          </div>
        {:else if row.kind === 'more'}
          <button
            type="button"
            class="absolute inset-x-0 flex h-6 w-full items-center text-left text-small text-muted-foreground/70 transition-colors hover:bg-hover hover:text-foreground disabled:pointer-events-none"
            style:padding-left="calc(var(--spacing) * {row.depth * 3 + 8})"
            style:top="{item.start}px"
            disabled={row.loading}
            onclick={() => explorer.more(row.dir)}
            data-tree-more={row.dir}
          >
            {row.loading ? 'Loading…' : `${row.remaining} more`}
          </button>
        {:else}
          <p
            class="absolute inset-x-0 flex h-6 items-center text-small text-muted-foreground/70"
            style:padding-left="calc(var(--spacing) * {row.depth * 3 + 8})"
            style:top="{item.start}px"
            data-tree-note
          >
            {row.text}
          </p>
        {/if}
      {/each}
    </div>
  </div>

  <TreeMenu
    aim={menu}
    onClose={() => (menu = null)}
    onCreate={(dir, kind) => ops.beginCreate(dir, kind)}
    onRename={(path) => ops.beginRename(path)}
    onDelete={(paths) => void ops.trash(paths)}
    onCopy={(path, relative) => ops.copy(path, relative)}
    onFind={findIn}
    onReveal={(path) => void ops.reveal(path)}
    onOpenIn={(path, editor) => void outside.open({ projectId: tabs.projectId, rootId: explorer.rootId, path, line: null }, editor)}
  />
</div>
