<script lang="ts">
  import type { ThreadListRow } from '@tagma/server/threads/contract/wire/list';
  import CornerLeftUp from '@lucide/svelte/icons/corner-left-up';
  import { untrack } from 'svelte';
  import { Overlay } from '@runlith/primitives/Overlay.svelte';
  import { Notices } from '$lib/features/notices/Service.svelte.js';
  import { ProviderCatalog } from '$lib/features/providers/Catalog.svelte.js';
  import { AreaFrame } from '$lib/app/panes/AreaFrame.svelte.js';
  import { Palette } from '$lib/app/panes/palette.js';
  import { Seam } from '@runlith/seam/Seam.svelte';
  import SeamHandle from '@runlith/seam/SeamHandle.svelte';
  import { Seams } from '$lib/shared/seams/Seams.svelte.js';
  import { THREADS_SEAM } from './seams.js';
  import type { ThreadSlot } from './ThreadSlot.svelte.js';
  import { ThreadList } from './List.svelte.js';
  import { FolderActs } from './FolderActs.js';
  import { Filing } from './filing.js';
  import { MentionDrops } from './MentionDrops.svelte.js';
  import ThreadMenu from './Menu.svelte';
  import ThreadRow from './Row.svelte';
  import { Squeeze, Stow } from './squeeze.svelte.js';
  import { ThreadFolds } from './threadFolds.svelte.js';
  import type { ThreadTreeNode } from './forest.js';
  import type { ContextAim } from './contextAim.svelte.js';
  import { ArchivedThreadsOpen } from './ArchivedThreadsOpen.svelte.js';
  import ArchivedFoot from './ArchivedFoot.svelte';
  import type { ColumnLine } from './columnLines.js';
  import ColumnHead from './ColumnHead.svelte';
  import { ColumnState } from './ColumnState.svelte.js';
  import Conversations from './Conversations.svelte';
  import FoldStub from './FoldStub.svelte';
  import FolderRow from './FolderRow.svelte';
  import ListReading from './ListReading.svelte';
  import ListRefused from './ListRefused.svelte';
  import PinnedBand from './PinnedBand.svelte';
  import ShelfLayer from './ShelfLayer.svelte';
  import { ReaderMarks } from '$lib/shared/reading/ReaderMarks.svelte.js';
  import WorktreeSwatch from '$lib/features/worktrees/WorktreeSwatch.svelte';
  import WorktreeDepartedGroup from './worktrees/DepartedGroup.svelte';
  import MoveToWorktree from './worktrees/MoveToWorktree.svelte';
  import PlaceBadge from './worktrees/PlaceBadge.svelte';
  import WorktreeNowhere from './worktrees/NowhereHeader.svelte';
  import WorktreeAwayRow from './worktrees/AwayRow.svelte';
  import WorktreeCreating from './worktrees/Creating.svelte';
  import WorktreeGroupHeader from './worktrees/GroupHeader.svelte';

  let { host, onCollapse }: { host: ThreadSlot; onCollapse?: () => void } = $props();

  type ThreadDraw = Extract<ColumnLine, { kind: 'thread' }>;

  const overlay = Overlay.use();
  const seams = Seams.use();
  const marks = ReaderMarks.use();
  const list = ThreadList.use();
  const folderActs = FolderActs.use();
  const folds = ThreadFolds.use();
  const squeeze = new Squeeze();
  const col = new ColumnState(
    untrack(() => host),
    list,
    folds,
    ArchivedThreadsOpen.use(),
    marks,
    new Filing(list, folderActs, Notices.use()),
    MentionDrops.use(),
    ProviderCatalog.use(),
  );
  const { shelving, drag, win } = col;
  const places = $derived(host.places);

  function find(text: string): void {
    overlay.open(Palette, text === '' ? {} : { query: text });
  }

  const seam = new Seam(seams.seam(THREADS_SEAM), { onCommit: (size) => seams.set(THREADS_SEAM, size), onCollapse: () => onCollapse?.() });
  const frame = AreaFrame.use();
  $effect(() => frame.show('column', seam));

  const ROW_MENU =
    'absolute right-2 top-1 grid h-[18px] w-5 translate-y-0.5 place-items-center rounded-md text-muted-foreground opacity-0 transition-[opacity,transform,color,background-color] duration-150 ease-instrument hover:bg-hover hover:text-foreground group-hover:translate-y-0 group-hover:opacity-100 group-has-[:focus-visible]:translate-y-0 group-has-[:focus-visible]:opacity-100 group-has-[[data-state=open]]:translate-y-0 group-has-[[data-state=open]]:opacity-100';
</script>

<svelte:window onkeydown={(event) => col.windowKeys(event)} />

<aside
  bind:this={col.asideEl}
  class="@container flex min-h-0 shrink-0 flex-col overflow-hidden border-r bg-chrome"
  style:width="{seam.size}px"
  aria-label="Agents"
  {@attach squeeze.column}
>
  <div class="flex min-h-0 flex-1 flex-col gap-1 py-1.5">
    <ColumnHead
      {host}
      bind:filter={col.filter}
      bind:input={col.filterInput}
      view={col.agentsView}
      several={places.several}
      filtering={col.filtering}
      anyOpen={col.anyThreadOpen}
      foldable={col.foldable}
      onFilterKeys={(event) => col.filterKeys(event, find)}
      onView={(next) => marks.agentsView.set(col.markKey, next)}
      onCollapse={() => folds.closeAll(col.foldTrees, col.folderIds)}
      onExpand={() => folds.openBack()}
      onNewFolder={() => void shelving.shelve([], 'New folder')}
    />

    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      bind:this={col.listEl}
      class="relative min-h-0 flex-1 overflow-y-auto px-1.5"
      data-drop="loose"
      onkeydown={(event) => col.listKeys(event)}
      onfocusin={(event) => (col.focusKey = (event.target as HTMLElement).closest<HTMLElement>('[data-line]')?.dataset.line ?? null)}
      onfocusout={() => (col.focusKey = null)}
      onclickcapture={(event) => shelving.select(event)}
      {@attach win.column}
    >
      {#if list.refused !== null}
        <ListRefused reason={list.refused} onRetry={() => list.retry()} />
      {/if}
      {#if list.roots === null}
        {#if list.refused === null}<ListReading />{/if}
      {:else if list.tree.length === 0 && places.creations.length === 0 && list.folders.length === 0}
        <p class="px-2 py-1 text-ui text-muted-foreground">Nothing yet. Ask the agent about this project.</p>
      {:else if col.filtering && col.shown.length === 0}
        <p class="px-2 py-1 text-small text-muted-foreground">Nothing in the loaded rows.</p>
      {/if}
      {#if col.grouping === null}
        {#each places.creations as creation (creation.id)}
          <WorktreeCreating {places} {creation} />
        {/each}
      {/if}
      <div class="relative" style:height="{win.height}px" {@attach win.span}>
        {#each col.placed as { line, index } (line.key)}
          <div
            class={[
              'absolute inset-x-0 flow-root rounded-md',
              col.lineTint(line) && 'bg-status-open/5',
              col.lineLifted(line) && 'opacity-40',
            ]}
            style:top="{win.offset(index)}px"
            data-line={line.key}
            data-drop={col.lineDrop(line)}
            data-team={col.lineTeam(line)}
            {@attach win.measure(line.key)}
          >
            {@render drawLine(line, false)}
          </div>
        {/each}
      </div>
      <Conversations query={col.filter} projectId={host.projectId} />
      {#if drag.line !== null}
        <span
          class="pointer-events-none absolute right-3.5 h-0.5 rounded-full bg-status-open"
          style:top="{drag.line.top - 1}px"
          style:left="{drag.line.left}px"
          aria-hidden="true"
        ></span>
      {/if}
      {#if list.more > 0}
        <button
          type="button"
          class="mt-1 w-full rounded-md px-2 py-1 text-left text-small text-muted-foreground hover:bg-hover hover:text-foreground"
          onclick={() => void list.readMore()}
        >
          {list.more} more
        </button>
      {/if}
      <WorktreeDepartedGroup />
    </div>
  </div>

  <ShelfLayer {shelving} part="bar" />
  <ArchivedFoot lines={col.archivedLines} {drag} draw={archivedLine} />
</aside>

<SeamHandle {seam} label="Resize the thread column" />

<ShelfLayer {shelving} part="floating" />

{#snippet drawLine(line: ColumnLine, inArchive: boolean)}
  {#if line.kind === 'rule'}
    <span class="my-1 block h-px bg-vein" aria-hidden="true"></span>
  {:else if line.kind === 'pinned'}
    <PinnedBand
      count={line.count}
      open={col.pinnedOpen}
      aimed={drag.aims({ kind: 'pinned' })}
      quiet={col.quietPins}
      onToggle={() => folds.togglePinned()}
    />
  {:else if line.kind === 'folder'}
    {@const entry = line.entry}
    {@const id = entry.folder.id}
    <FolderRow
      {entry}
      aimed={drag.aims({ kind: 'folder', folderId: id })}
      adding={shelving.adding(id)}
      renaming={shelving.renaming === id}
      onToggle={() => folds.toggle(id)}
      onStartRename={() => (shelving.renaming = id)}
      onRename={(name) => folderActs.rename(id, name)}
      onCancelRename={() => (shelving.renaming = null)}
      onNew={() => shelving.newAgentIn(id)}
      onNewFolder={() => void shelving.shelve([], 'New folder', id)}
      onArchive={() => void shelving.filing.archive(entry.trees.map((node) => node.row.id))}
      onRemove={() => (shelving.removing = entry.folder)}
    />
  {:else if line.kind === 'empty'}
    <p class="py-1 pr-2 text-small text-muted-foreground/70" style:padding-left="calc(var(--spacing) * {8 + line.entry.depth * 3})">
      Empty — drag agents here
    </p>
  {:else if line.kind === 'thread'}
    {@render threadRow(line, inArchive)}
  {:else if line.kind === 'stub'}
    <FoldStub
      fold={line.fold}
      parentId={line.parent.id}
      depth={line.depth}
      count={line.count}
      expanded={line.expanded}
      through={line.through}
      onToggle={() => (line.fold === 'finished' ? folds.toggleStub(line.parent.id) : folds.toggleMore(line.parent.id))}
    />
  {:else if line.kind === 'away'}
    <WorktreeAwayRow away={line.away} depth={line.depth} onReveal={(id) => void col.revealThread(id)} />
  {:else if line.kind === 'group'}
    <WorktreeGroupHeader
      row={line.group.row}
      open={line.open}
      current={places.aimed?.rootId === line.group.row.rootId}
      onToggle={() => col.toggleGroup(line.group.row.rootId)}
    />
  {:else if line.kind === 'creating'}
    <WorktreeCreating {places} creation={line.creation} />
  {:else}
    <WorktreeNowhere count={line.count} />
  {/if}
{/snippet}

{#snippet archivedLine(line: ColumnLine)}
  {@render drawLine(line, true)}
{/snippet}

{#snippet threadRow(line: ThreadDraw, inArchive: boolean)}
  {@const node = line.node}
  {@const shelf = line.decor === 'shelf'}
  {@const own = line.top && !inArchive}
  <ThreadRow
    {node}
    depth={line.depth}
    parent={line.parent}
    {host}
    {squeeze}
    {folds}
    activeId={host.activeId}
    actions={inArchive ? archivedActions : actions}
    query={inArchive ? '' : col.filter}
    {...own ? col.renamer(node.row.id) : {}}
    unborn={own && list.births.unborn(node.row.id)}
    badge={shelf && places.several ? placeBadge : undefined}
    aside={own ? (line.decor === 'group' ? crumb : line.decor === 'nowhere' ? placeNowhere : undefined) : undefined}
    selected={own && shelf && shelving.selection.has(node.row.id)}
    lifted={!inArchive && drag.lifts(node.row.id)}
    onUnpin={inArchive ? undefined : (row) => void list.setPinned(row.id, false)}
  />
{/snippet}

{#snippet placeBadge(row: ThreadListRow, step: number)}
  <PlaceBadge {places} {row} named={step < Stow.place} />
{/snippet}

{#snippet crumb(node: ThreadTreeNode)}
  {@const from = col.grouping?.crumbs.get(node.row.id)}
  {#if from !== undefined}
    <button
      type="button"
      class="flex max-w-full min-w-0 items-center gap-1 rounded-sm pb-0.5 pl-8 pr-2 text-left text-small text-muted-foreground/80 hover:text-foreground"
      data-thread-crumb={from.parent.id}
      onclick={() => void col.revealThread(from.parent.id)}
    >
      <CornerLeftUp class="size-3 shrink-0" />
      <span class="min-w-0 truncate">
        {from.parent.parentThreadId === null ? from.parent.title.trim() || 'Untitled' : (from.parent.name ?? from.parent.agentId)}
      </span>
      <span class="shrink-0 opacity-60">·</span>
      <WorktreeSwatch row={from.row} />
      <span class="min-w-0 shrink truncate font-mono">{from.row.branch ?? from.row.name}</span>
    </button>
  {/if}
{/snippet}

{#snippet placeNowhere(node: ThreadTreeNode)}
  <MoveToWorktree {places} thread={node.row.id} />
{/snippet}

{#snippet actions(node: ThreadTreeNode, aim: ContextAim)}
  <ThreadMenu
    row={node.row}
    {list}
    {host}
    {aim}
    onRename={() => col.startRename(node.row)}
    onMove={col.grouping === null && node.row.parentThreadId === null
      ? () => shelving.pickFor(node.row.id, col.rowLink(node.row.id) ?? document.body)
      : undefined}
    class={ROW_MENU}
  />
{/snippet}

{#snippet archivedActions(node: ThreadTreeNode, aim: ContextAim)}
  <ThreadMenu row={node.row} {list} {host} {aim} archived onRename={() => col.startRename(node.row)} class={ROW_MENU} />
{/snippet}
