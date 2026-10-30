import type { ThreadListRow } from '@tagma/server/threads/contract/wire/list';
import { tick, untrack } from 'svelte';
import type { Filing } from './filing.js';
import type { ReaderMarks } from '$lib/shared/reading/ReaderMarks.svelte.js';
import type { ProviderCatalog } from '$lib/features/providers/Catalog.svelte.js';
import type { ArchivedThreadsOpen } from './ArchivedThreadsOpen.svelte.js';
import { type ColumnLine, estimateOf, focusable, groupLines, LineCache, shelfLines, threadLines } from './columnLines.js';
import { ColumnWindow } from './ColumnWindow.svelte.js';
import type { AgentsView } from './ColumnHead.svelte';
import { isQuiet, threadTree, type ThreadTreeNode } from './forest.js';
import type { ThreadList } from './List.svelte.js';
import type { MentionDrops } from './MentionDrops.svelte.js';
import { Shelving } from './shelving.svelte.js';
import { threadPeeks } from './threadPeek.svelte.js';
import type { ThreadFolds } from './threadFolds.svelte.js';
import { columnEntries, filedIn, folderChain, foldTeam, matchShelf, nextWaiting, nodeIndex, rootBand } from './tree.js';
import type { ThreadSlot } from './ThreadSlot.svelte.js';
import { worktreeGroups } from './worktrees/worktreeGroups.js';

const ROW_FOCUS = 'a[data-thread], button[data-fold]';

export class ColumnState {
  private readonly list: ThreadList;
  private readonly folds: ThreadFolds;
  private readonly archived: ArchivedThreadsOpen;
  private readonly marks: ReaderMarks;
  renamingId = $state<string | null>(null);
  filter = $state('');
  filterInput = $state<HTMLInputElement | null>(null);
  listEl = $state<HTMLDivElement | null>(null);
  asideEl = $state<HTMLElement | null>(null);
  focusKey = $state<string | null>(null);
  readonly shelving: Shelving;
  readonly win = new ColumnWindow<ColumnLine>(estimateOf);
  private readonly spans = new LineCache();
  readonly places = $derived.by(() => this.host.places);
  readonly archivedTree = $derived.by(() => threadTree(this.list.archived ?? []));
  readonly archivedNodes = $derived.by(() => nodeIndex(this.archivedTree));
  readonly folderIds = $derived.by(() => this.list.folders.map((folder) => folder.id));
  readonly foldTrees = $derived.by(() => (this.archived.open ? [...this.list.tree, ...this.archivedTree] : this.list.tree));
  readonly anyThreadOpen = $derived.by(() => this.folds.anyOpen(this.foldTrees, this.folderIds));
  readonly foldable = $derived.by(() => this.anyThreadOpen || this.folds.canOpenBack);
  readonly filtering = $derived.by(() => this.filter.trim() !== '');
  readonly shown = $derived.by(() => matchShelf(this.catalog.models, this.list.tree, this.list.folders, this.filter));
  readonly pinnedOpen = $derived.by(() => this.filtering || this.folds.isPinnedOpen());
  readonly entries = $derived.by(() =>
    columnEntries(this.shown, this.pinnedOpen, {
      folders: this.list.folders,
      isOpen: (id) => this.folds.isOpen(id),
      keepId: this.host.activeId,
      filtering: this.filtering,
    }),
  );
  readonly markKey = $derived.by(() => String(this.list.aim.tileId));
  readonly agentsView = $derived.by<AgentsView>(() =>
    this.places.several && this.marks.agentsView.get(this.markKey) === 'worktrees' ? 'worktrees' : 'teams',
  );
  readonly grouping = $derived.by(() =>
    this.agentsView === 'worktrees'
      ? worktreeGroups(
          this.list.tree,
          this.places.grouped,
          (id) => this.places.byRoot(this.list.births.aimOf(id) ?? '') ?? this.places.placeOf(this.list.births.sourceOf(id) ?? id),
          (thread) => this.places.creatingOf(thread)?.id ?? null,
        )
      : null,
  );
  readonly closedGroups = $derived.by(() => new Set(this.marks.worktreeFolds.get(this.markKey) ?? []));
  readonly drawnTrees = $derived.by(() =>
    this.grouping === null
      ? this.list.tree
      : [
          ...this.grouping.groups.flatMap((group) => group.trees),
          ...this.grouping.nowhere,
          ...this.places.creations.flatMap((creation) => this.grouping?.creating.get(creation.id) ?? []),
        ],
  );
  readonly unpinning = $derived.by(() => {
    const carried = this.shelving.drag.carried;
    return carried?.kind === 'agent' && this.list.row(carried.id)?.pinnedAt != null ? carried.parentId : null;
  });
  readonly lineView = $derived.by(() => ({
    folds: this.folds,
    activeId: this.host.activeId,
    filtering: this.filtering,
    unpinning: this.unpinning,
    cache: this.spans,
  }));
  readonly lines = $derived.by(() =>
    this.grouping === null
      ? shelfLines(this.entries, this.lineView)
      : groupLines(
          this.grouping,
          this.lineView,
          this.filter,
          this.catalog.models,
          (rootId) => this.groupOpen(rootId),
          this.places.creations,
        ),
  );
  readonly archivedLines = $derived.by(() =>
    this.archivedTree.flatMap((node) =>
      threadLines(node, { ...this.lineView, filtering: false }, { depth: 0, decor: 'plain', drop: null }),
    ),
  );
  readonly kept = $derived.by(() => {
    const keep = new Set<string>();
    if (this.renamingId !== null) keep.add(this.renamingId);
    if (this.shelving.renaming !== null) keep.add(`folder:${this.shelving.renaming}`);
    if (this.focusKey !== null) keep.add(this.focusKey);
    const carried = this.shelving.drag.carried;
    if (carried?.kind === 'trees') for (const id of carried.ids) keep.add(id);
    else if (carried?.kind === 'agent') keep.add(carried.id);
    else if (carried?.kind === 'folder') keep.add(`folder:${carried.folderId}`);
    return keep;
  });
  readonly placed = $derived.by(() => this.win.mounted(this.kept));
  readonly quietPins = $derived.by(() => this.shown.filter((node) => rootBand(node) === 'pinned' && isQuiet(node)));
  private lastWaiting: string | null = null;

  get host(): ThreadSlot {
    return this.slot();
  }

  constructor(
    private readonly slot: () => ThreadSlot,
    list: ThreadList,
    folds: ThreadFolds,
    archived: ArchivedThreadsOpen,
    marks: ReaderMarks,
    filing: Filing,
    drops: MentionDrops,
    private readonly catalog: ProviderCatalog,
  ) {
    this.list = list;
    this.folds = folds;
    this.archived = archived;
    this.marks = marks;
    this.shelving = new Shelving(list, folds, slot, filing, drops, {
      shelved: () => this.grouping === null,
      nodeOf: (id) => this.list.node(id),
      rootOf: (id) => this.rootOf(id),
      roots: () => this.lines.flatMap((line) => (line.kind === 'thread' && line.top ? [line.key] : [])),
    });
    $effect.pre(() => {
      const next = this.lines;
      untrack(() => this.win.lay(next));
    });
    $effect(() => {
      if (!this.archived.open) return;
      untrack(() => void this.list.readArchived());
    });
    $effect(() => {
      if (this.host.activeId !== null) untrack(() => this.list.aimBirth(null));
    });
    $effect(() => {
      if (this.listEl === null || this.asideEl === null) return;
      return this.shelving.drag.attach(this.listEl, this.asideEl);
    });
    $effect(() => () => threadPeeks.dismiss());
  }

  get drag() {
    return this.shelving.drag;
  }

  startRename(row: ThreadListRow): void {
    this.renamingId = row.id;
  }

  renamer(id: string) {
    return {
      renaming: this.renamingId === id,
      onRename: (row: ThreadListRow) => this.startRename(row),
      onRenamed: (row: ThreadListRow, title: string) => this.list.rename(row.id, title),
      onRenameEnd: () => (this.renamingId = null),
    };
  }

  groupOpen(rootId: string): boolean {
    return this.filtering || !this.closedGroups.has(rootId);
  }

  toggleGroup(rootId: string): void {
    const closed = new Set(this.closedGroups);
    if (!closed.delete(rootId)) closed.add(rootId);
    this.marks.worktreeFolds.set(
      this.markKey,
      [...closed].filter((id) => this.places.rows.some((row) => row.rootId === id)),
    );
  }

  nodeOf(id: string): ThreadTreeNode | undefined {
    return this.list.node(id) ?? this.archivedNodes.get(id);
  }

  rootOf(id: string): ThreadTreeNode | undefined {
    let node = this.nodeOf(id);
    for (let hops = 0; node?.row.parentThreadId && hops <= this.list.size; hops += 1) {
      const parent = this.nodeOf(node.row.parentThreadId);
      if (parent === undefined) break;
      node = parent;
    }
    return node;
  }

  rowLink(id: string): HTMLAnchorElement | null {
    return this.listEl?.querySelector<HTMLAnchorElement>(`a[data-thread="${CSS.escape(id)}"]`) ?? null;
  }

  lineDrop(line: ColumnLine): string | undefined {
    if (line.kind === 'thread' || line.kind === 'stub') return line.drop ?? undefined;
    if (line.kind === 'folder' || line.kind === 'empty') return `folder:${line.entry.folder.id}`;
    return undefined;
  }

  lineTeam(line: ColumnLine): string | undefined {
    if (line.kind === 'thread' && line.node.children.length > 0) return `team:${line.node.row.id}`;
    if (line.kind === 'stub' && line.fold === 'finished') return `finished:${line.parent.id}`;
    return undefined;
  }

  lineTint(line: ColumnLine): boolean {
    const team = this.lineTeam(line);
    if (team !== undefined && this.drag.aimsAt(team)) return true;
    const drop = this.lineDrop(line);
    if (drop === undefined || line.kind === 'folder') return false;
    if (drop === 'loose') return this.drag.aims({ kind: 'loose' });
    return drop.startsWith('folder:') && this.drag.aims({ kind: 'folder', folderId: drop.slice('folder:'.length) });
  }

  lineLifted(line: ColumnLine): boolean {
    const carried = this.drag.carried;
    if (carried?.kind !== 'folder') return false;
    return line.kind === 'folder' ? line.entry.folder.id === carried.folderId : this.lineDrop(line) === `folder:${carried.folderId}`;
  }

  openFilter(): void {
    this.filterInput?.focus();
  }

  windowKeys(event: KeyboardEvent): void {
    if (event.key === 'Escape' && this.shelving.selection.size > 0 && !event.defaultPrevented) {
      this.shelving.selection = new Set();
      return;
    }
    if (event.key !== '/' && event.key !== 'a') return;
    if (event.defaultPrevented || event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const inColumn = this.asideEl?.contains(target) ?? false;
    if (target !== document.body && !inColumn) return;
    if (target.closest('input, textarea, select, [contenteditable], [role="textbox"]') !== null) return;
    event.preventDefault();
    if (event.key === '/') this.openFilter();
    else void this.jumpWaiting();
  }

  filterKeys(event: KeyboardEvent, find: (text: string) => void): void {
    if (event.isComposing) return;
    if (event.key === 'Enter' || (event.code === 'KeyK' && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey)) {
      event.preventDefault();
      find(this.filter.trim());
    } else if (event.key === 'Escape') {
      if (this.filter === '') return;
      this.filter = '';
      event.preventDefault();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.edge(true);
    }
  }

  listKeys(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.matches(ROW_FOCUS)) return;
    const at = this.lineIndexOf(target);
    if (at < 0 && !this.tailLinks().includes(target)) return;
    if (target.dataset.fold === 'folder' && event.key === 'F2') {
      this.shelving.renaming = target.dataset.folder ?? null;
      event.preventDefault();
      return;
    }
    if (target.dataset.fold !== undefined && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) {
      this.foldKeys(event, target, at);
      return;
    }
    if (!this.threadKey(event, target, at)) return;
    event.preventDefault();
  }

  async jumpWaiting(): Promise<void> {
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.thread : undefined;
    const path = nextWaiting(this.drawnTrees, focused ?? this.lastWaiting, this.host.activeId);
    if (path === null) return;
    this.lastWaiting = path[path.length - 1]?.row.id ?? null;
    await this.reveal(path);
  }

  async revealThread(id: string): Promise<void> {
    if (this.filtering && this.win.indexFor(id) < 0) this.filter = '';
    const group = this.grouping?.groupOf.get(id);
    if (group !== undefined && this.closedGroups.has(group)) this.toggleGroup(group);
    const chain: string[] = [];
    let at = this.nodeOf(id)?.row.parentThreadId ?? null;
    for (let hops = 0; at !== null && hops <= this.list.size; hops += 1) {
      if (this.grouping !== null && this.grouping.groupOf.get(at) !== group) break;
      chain.unshift(at);
      at = this.nodeOf(at)?.row.parentThreadId ?? null;
    }
    const path = [...chain, id];
    const nodes = this.grouping === null ? new Map<string, ThreadTreeNode>() : this.groupIndex(this.grouping);
    for (let depth = 0; !this.filtering && depth < chain.length; depth += 1) {
      const parent = chain[depth] as string;
      this.openFold(parent, nodes.get(parent), nodes.get(path[depth + 1] as string));
    }
    await tick();
    await this.focusThread(id);
  }

  private groupIndex(grouping: NonNullable<ColumnState['grouping']>): ReadonlyMap<string, ThreadTreeNode> {
    return nodeIndex(grouping.groups.map((group) => group.trees).flat(), grouping.nowhere, ...grouping.creating.values());
  }

  private async reveal(path: readonly ThreadTreeNode[]): Promise<void> {
    const target = path[path.length - 1];
    if (target === undefined) return;
    if (this.grouping !== null) {
      await this.revealThread(target.row.id);
      return;
    }
    if (this.filtering && this.win.indexFor(target.row.id) < 0) this.filter = '';
    const root = path[0] as ThreadTreeNode;
    if (!this.filtering && rootBand(root) === 'pinned' && !this.folds.isPinnedOpen()) this.folds.togglePinned();
    const folderId = filedIn(root, this.list.folders);
    if (!this.filtering && folderId !== null) for (const id of folderChain(this.list.folders, folderId)) this.folds.setOpen(id, true);
    for (let depth = 0; !this.filtering && depth < path.length - 1; depth += 1) {
      this.openFold((path[depth] as ThreadTreeNode).row.id, path[depth], path[depth + 1]);
    }
    await tick();
    await this.focusThread(target.row.id);
  }

  private openFold(parentId: string, parent: ThreadTreeNode | undefined, child: ThreadTreeNode | undefined): void {
    if (!this.folds.isOpen(parentId)) this.folds.toggle(parentId);
    if (parent === undefined || child === undefined) return;
    const fold = foldTeam(parent.children, this.host.activeId);
    if (fold.finished.includes(child) && child !== fold.kept && !this.folds.isStubOpen(parentId)) this.folds.toggleStub(parentId);
    if (fold.moreWorking.includes(child) && !this.folds.isMoreOpen(parentId)) this.folds.toggleMore(parentId);
  }

  private threadKey(event: KeyboardEvent, target: HTMLElement, at: number): boolean {
    const id = target.dataset.thread ?? '';
    const node = this.nodeOf(id);
    switch (event.key) {
      case 'ArrowDown':
      case 'j':
        this.step(target, 1);
        return true;
      case 'ArrowUp':
      case 'k':
        this.step(target, -1);
        return true;
      case 'a':
        void this.jumpWaiting();
        return true;
      case 'p':
        if (node === undefined) return false;
        this.pin(id);
        return true;
      case 'e':
        if (node === undefined) return false;
        this.archiveThread(id, at);
        return true;
      case 'm':
        if (node === undefined || this.grouping !== null) return false;
        this.shelving.pickFor(id, target);
        return true;
      case 'Home':
        this.edge(true);
        return true;
      case 'End':
        this.edge(false);
        return true;
      case 'ArrowRight':
        if (node === undefined || node.children.length === 0) return false;
        if (!this.filtering && !this.folds.isOpen(id)) this.folds.toggle(id);
        else {
          const next = this.nextStop(at, 1);
          if (next >= 0 && this.ownerOf(this.lines[next]) === id) void this.focusIndex(next);
        }
        return true;
      case 'ArrowLeft':
        this.leftOf(node, at, id);
        return true;
      case '/':
        this.openFilter();
        return true;
      default:
        return false;
    }
  }

  private leftOf(node: ThreadTreeNode | undefined, at: number, id: string): void {
    const line = this.lines[at];
    if (!this.filtering && node !== undefined && node.children.length > 0 && this.folds.isOpen(id)) this.folds.toggle(id);
    else if (node?.row.parentThreadId) void this.focusThread(node.row.parentThreadId);
    else if (line?.kind === 'thread' && line.drop?.startsWith('folder:')) {
      const folder = this.win.indexFor(`folder:${line.drop.slice('folder:'.length)}`);
      if (folder >= 0) void this.focusIndex(folder);
    }
  }

  private foldKeys(event: KeyboardEvent, target: HTMLElement, at: number): void {
    const expanded = target.getAttribute('aria-expanded') === 'true';
    const fold = target.dataset.fold;
    if (event.key === 'ArrowRight' && !expanded) target.click();
    else if (event.key === 'ArrowRight' && (fold === 'finished' || fold === 'worktree' || fold === 'folder')) this.step(target, 1);
    else if (expanded) target.click();
    else if (target.dataset.parent !== undefined) void this.focusThread(target.dataset.parent);
    else if (fold === 'folder') {
      const above = this.parentFolderIndex(at);
      if (above >= 0) void this.focusIndex(above);
    }
    event.preventDefault();
  }

  private pin(id: string): void {
    const row = this.nodeOf(id)?.row;
    if (row === undefined || row.archivedAt !== null || this.list.busy(id, 'pin')) return;
    void this.list.setPinned(id, row.pinnedAt === null);
  }

  private archiveThread(id: string, at: number): void {
    const row = this.nodeOf(id)?.row;
    if (row === undefined || row.archivedAt !== null || this.list.busy(id, 'archive')) return;
    const stay = this.survivor(at, id);
    void this.list.setArchived(id, true);
    if (stay !== null) void tick().then(() => this.focusThread(stay));
  }

  private survivor(at: number, id: string): string | null {
    for (const step of [1, -1] as const) {
      for (let index = this.nextStop(at, step); index >= 0; index = this.nextStop(index, step)) {
        const line = this.lines[index] as ColumnLine;
        const owner = line.kind === 'thread' ? line.key : line.kind === 'stub' ? line.parent.id : null;
        if (owner === null || !this.list.holdsUnder(owner, id)) return line.key;
      }
    }
    return null;
  }

  private lineElement(key: string): HTMLElement | null {
    return this.listEl?.querySelector<HTMLElement>(`[data-line="${CSS.escape(key)}"]`) ?? null;
  }

  private tailLinks(): HTMLElement[] {
    if (this.listEl === null) return [];
    return Array.from(this.listEl.querySelectorAll<HTMLElement>(ROW_FOCUS)).filter((element) => element.closest('[data-line]') === null);
  }

  private lineIndexOf(element: HTMLElement): number {
    const key = element.closest<HTMLElement>('[data-line]')?.dataset.line;
    return key === undefined ? -1 : this.win.indexFor(key);
  }

  private nextStop(from: number, step: 1 | -1): number {
    for (let index = from + step; index >= 0 && index < this.lines.length; index += step) {
      if (focusable(this.lines[index] as ColumnLine)) return index;
    }
    return -1;
  }

  private async focusIndex(index: number): Promise<void> {
    const line = this.lines[index];
    if (line === undefined) return;
    this.focusKey = line.key;
    this.win.scrollTo(index);
    await tick();
    this.lineElement(line.key)?.querySelector<HTMLElement>(ROW_FOCUS)?.focus();
  }

  private async focusThread(id: string): Promise<void> {
    const index = this.win.indexFor(id);
    if (index >= 0) await this.focusIndex(index);
  }

  private step(target: HTMLElement, delta: 1 | -1): void {
    const at = this.lineIndexOf(target);
    if (at >= 0) {
      const next = this.nextStop(at, delta);
      if (next >= 0) void this.focusIndex(next);
      else if (delta > 0) this.tailLinks()[0]?.focus();
      return;
    }
    const tail = this.tailLinks();
    const next = tail[tail.indexOf(target) + delta];
    if (next !== undefined) next.focus();
    else if (delta < 0) {
      const last = this.nextStop(this.lines.length, -1);
      if (last >= 0) void this.focusIndex(last);
    }
  }

  private edge(first: boolean): void {
    const tail = this.tailLinks();
    if (!first && tail.length > 0) {
      tail[tail.length - 1]?.focus();
      return;
    }
    const index = first ? this.nextStop(-1, 1) : this.nextStop(this.lines.length, -1);
    if (index >= 0) void this.focusIndex(index);
    else if (first) tail[0]?.focus();
  }

  private ownerOf(line: ColumnLine | undefined): string | null | undefined {
    if (line === undefined) return undefined;
    if (line.kind === 'stub') return line.parent.id;
    if (line.kind === 'thread') return line.node.row.parentThreadId;
    return undefined;
  }

  private parentFolderIndex(at: number): number {
    const line = this.lines[at];
    if (line?.kind !== 'folder') return -1;
    for (let index = at - 1; index >= 0; index -= 1) {
      const above = this.lines[index];
      if (above?.kind === 'folder' && above.entry.depth === line.entry.depth - 1) return index;
    }
    return -1;
  }
}
