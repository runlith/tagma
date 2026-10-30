import type { ThreadFolder } from '@tagma/server/thread-record/contract/wire/folder';
import { type Carried, ColumnDrag, type DropTarget } from './drag.svelte.js';
import { type Filing, folderNameFor } from './filing.js';
import type { FolderChoice } from './FolderPicker.svelte';
import type { ThreadList } from './List.svelte.js';
import type { Mention, MentionDrops } from './MentionDrops.svelte.js';
import type { ThreadFolds } from './threadFolds.svelte.js';
import type { ThreadTreeNode } from './forest.js';
import type { ThreadSlot } from './ThreadSlot.svelte.js';

export type DrawnColumn = {
  readonly shelved: () => boolean;
  readonly nodeOf: (threadId: string) => ThreadTreeNode | undefined;
  readonly rootOf: (threadId: string) => ThreadTreeNode | undefined;
  readonly roots: () => readonly string[];
};

export class Shelving {
  selection = $state<ReadonlySet<string>>(new Set());
  picking = $state<{ readonly ids: readonly string[]; readonly anchor: HTMLElement } | null>(null);
  renaming = $state<string | null>(null);
  removing = $state<ThreadFolder | null>(null);
  readonly drag: ColumnDrag;
  private selectedFrom: string | null = null;

  constructor(
    private readonly list: ThreadList,
    private readonly folds: ThreadFolds,
    private readonly slot: () => ThreadSlot,
    readonly filing: Filing,
    private readonly drops: MentionDrops,
    private readonly drawn: DrawnColumn,
  ) {
    this.drag = new ColumnDrag({
      carry: (press) => {
        const agent = 'threadId' in press ? drawn.nodeOf(press.threadId)?.row : undefined;
        const parentId = agent?.parentThreadId ?? null;
        if (agent !== undefined && parentId !== null && drawn.nodeOf(parentId) !== undefined) {
          return agent.archivedAt !== null
            ? null
            : { kind: 'agent', id: agent.id, parentId, label: list.labelOf(agent.id) ?? agent.agentId };
        }
        if (!drawn.shelved()) return null;
        if ('folderId' in press) {
          const folder = list.folders.find((held) => held.id === press.folderId);
          return folder === undefined || this.renaming === folder.id ? null : { kind: 'folder', folderId: folder.id, label: folder.name };
        }
        const root = drawn.rootOf(press.threadId);
        if (root === undefined || root.row.archivedAt !== null) return null;
        const ids = this.carriedFrom(root.row.id);
        return { kind: 'trees', ids, label: ids.length === 1 ? (list.labelOf(root.row.id) ?? 'Untitled') : `${ids.length} agents` };
      },
      accepts: (carried, target) => {
        if (target.kind === 'mention') return drops.accepts(target.zone, this.mentionsOf(carried));
        if (carried.kind === 'agent') {
          const pinned = drawn.nodeOf(carried.id)?.row.pinnedAt != null;
          if (target.kind === 'team') return target.parentId === carried.parentId && !pinned;
          return target.kind === 'finished' && target.parentId === carried.parentId && pinned;
        }
        if (target.kind === 'team' || target.kind === 'finished') return false;
        const rows = carried.ids.flatMap((id) => {
          const row = drawn.rootOf(id)?.row;
          return row === undefined ? [] : [row];
        });
        const filed = (folderId: string | null | undefined) => folderId != null && list.folders.some((folder) => folder.id === folderId);
        if (target.kind === 'folder') return rows.some((row) => row.folderId !== target.folderId || row.pinnedAt !== null);
        if (target.kind === 'loose') return rows.some((row) => row.pinnedAt !== null || filed(row.folderId));
        if (target.kind === 'pinned') return rows.some((row) => row.pinnedAt === null);
        return true;
      },
      drop: (carried, target) => {
        if (target.kind === 'mention') {
          this.selection = new Set();
          drops.mention(target.zone, this.mentionsOf(carried));
        } else void (carried.kind === 'agent' ? list.setPinned(carried.id, target.kind === 'team') : this.drop(carried.ids, target));
      },
      outside: (under) => {
        const zone = drops.at(under);
        return zone === null ? null : { kind: 'mention', zone };
      },
      follow: (carried, target) => drops.follow(this.mentionsOf(carried), target?.kind === 'mention' ? target.zone : null),
      folders: () => list.folders,
      reorder: (folderId, place) => void this.filing.reorder(folderId, place),
      isOpen: (folderId) => folds.isOpen(folderId),
      setOpen: (folderId, open) => folds.setOpen(folderId, open),
    });
  }

  async shelve(ids: readonly string[], name: string, parentId: string | null = null): Promise<void> {
    const folder = await this.filing.shelve(ids, name, parentId);
    if (folder === null) return;
    if (parentId !== null) this.folds.setOpen(parentId, true);
    this.folds.setOpen(folder.id, ids.length === 0);
    this.renaming = folder.id;
  }

  async confirmRemove(): Promise<void> {
    const folder = this.removing;
    this.removing = null;
    if (folder !== null) await this.filing.remove(folder);
  }

  async drop(ids: readonly string[], target: DropTarget): Promise<void> {
    this.selection = new Set();
    if (target.kind === 'folder') await this.filing.file(ids, target.folderId);
    else if (target.kind === 'loose') await this.filing.file(ids, null);
    else if (target.kind === 'pinned') await this.filing.pin(ids);
    else if (target.kind === 'new') await this.shelve(ids, folderNameFor(ids.map((id) => this.list.labelOf(id) ?? '')));
    else if (target.kind === 'archive') await this.filing.archive(ids);
  }

  pickFor(threadId: string, anchor: HTMLElement): void {
    const root = this.drawn.rootOf(threadId);
    if (root === undefined || root.row.archivedAt !== null) return;
    this.picking = { ids: this.carriedFrom(root.row.id), anchor };
  }

  pick(ids: readonly string[], choice: FolderChoice): void {
    this.selection = new Set();
    if (choice.kind === 'folder') void this.filing.file(ids, choice.folderId);
    else if (choice.kind === 'loose') void this.filing.file(ids, null);
    else void this.filing.shelve(ids, choice.name);
  }

  placeOf(ids: readonly string[]): string | null | undefined {
    const places = new Set(ids.map((id) => this.drawn.rootOf(id)?.row.folderId ?? null));
    return places.size === 1 ? [...places][0] : undefined;
  }

  newAgentIn(folderId: string): void {
    this.list.aimBirth(folderId);
    this.folds.setOpen(folderId, true);
    this.slot().startDraft();
  }

  select(event: MouseEvent): void {
    if (!this.drawn.shelved() || event.button !== 0 || !(event.metaKey || event.ctrlKey || event.shiftKey)) return;
    const link = event.target instanceof Element ? event.target.closest<HTMLElement>('a[data-thread]') : null;
    const root = link === null ? undefined : this.drawn.rootOf(link.dataset.thread ?? '');
    if (root === undefined || root.row.archivedAt !== null) return;
    event.preventDefault();
    event.stopPropagation();
    const id = root.row.id;
    const next = new Set(this.selection);
    const active = this.slot().activeId;
    const from = this.selectedFrom ?? (active === null ? null : (this.drawn.rootOf(active)?.row.id ?? null));
    if (event.shiftKey && from !== null) {
      const order = this.drawn.roots();
      const [low, high] = [order.indexOf(from), order.indexOf(id)].sort((left, right) => left - right) as [number, number];
      if (low >= 0) for (const between of order.slice(low, high + 1)) next.add(between);
      else next.add(id);
    } else if (!next.delete(id)) next.add(id);
    this.selection = next;
    this.selectedFrom = id;
  }

  arrivesAt(target: DropTarget | null): string {
    if (target === null) return '';
    if (target.kind === 'folder') return this.list.folders.find((folder) => folder.id === target.folderId)?.name ?? '';
    if (target.kind === 'team' || target.kind === 'finished') return target.kind === 'team' ? 'Pinned' : 'Finished';
    if (target.kind === 'mention') return 'Mention';
    return { loose: 'No folder', pinned: 'Pinned', new: 'New folder', archive: 'Archive' }[target.kind];
  }

  adding(folderId: string): number {
    const carried = this.drag.carried;
    if (carried?.kind !== 'trees' || !this.drag.aims({ kind: 'folder', folderId })) return 0;
    return carried.ids.filter((id) => this.drawn.rootOf(id)?.row.folderId !== folderId).length;
  }

  private carriedFrom(rootId: string): readonly string[] {
    return this.selection.has(rootId) && this.selection.size > 1 ? [...this.selection] : [rootId];
  }

  private mentionsOf(carried: Carried | null): readonly Mention[] {
    if (carried === null || carried.kind === 'folder') return [];
    const ids = carried.kind === 'trees' ? carried.ids : [carried.id];
    return ids.map((id) => ({ name: id, title: this.list.labelOf(id) ?? '' }));
  }
}
