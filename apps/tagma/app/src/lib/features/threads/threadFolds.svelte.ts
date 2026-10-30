import { Service } from '@runlith/layer/key';
import { ReaderMarks } from '$lib/shared/reading/ReaderMarks.svelte.js';
import { TileRung, type TileAim } from '$lib/features/workspace/TileRung.js';
import type { ThreadTreeNode } from './forest.js';

export type FoldShape = {
  readonly closed: readonly string[] | undefined;
  readonly stubs: readonly string[] | undefined;
  readonly more: readonly string[];
};

class SetMemo {
  private from: readonly string[] | undefined = undefined;
  private held: ReadonlySet<string> = new Set();

  of(list: readonly string[] | undefined): ReadonlySet<string> {
    if (list !== this.from) {
      this.from = list;
      this.held = new Set(list ?? []);
    }
    return this.held;
  }
}

export class ThreadFolds extends Service<ThreadFolds>()('ThreadFolds', { tier: 'tile' }) {
  static *make() {
    return new ThreadFolds(yield* TileRung.Current, yield* ReaderMarks);
  }

  private closedFrom = $state<readonly string[] | null>(null);
  private moreOpen = $state<readonly string[]>([]);
  private readonly closedSets = new SetMemo();
  private readonly stubSets = new SetMemo();

  constructor(
    private readonly aim: TileAim,
    private readonly marks: ReaderMarks,
  ) {
    super();
  }

  isOpen(id: string): boolean {
    return !this.closed.has(id);
  }

  toggle(id: string): void {
    const closed = new Set(this.closed);
    if (!closed.delete(id)) closed.add(id);
    this.marks.threadFolds.set(this.project, [...closed]);
  }

  isStubOpen(parentId: string): boolean {
    return this.openStubs.has(parentId);
  }

  toggleStub(parentId: string): void {
    const stubs = new Set(this.openStubs);
    if (!stubs.delete(parentId)) stubs.add(parentId);
    this.marks.openThreadStubs.set(this.project, [...stubs]);
  }

  isMoreOpen(parentId: string): boolean {
    return this.moreOpen.includes(parentId);
  }

  toggleMore(parentId: string): void {
    this.moreOpen = this.moreOpen.includes(parentId) ? this.moreOpen.filter((id) => id !== parentId) : [...this.moreOpen, parentId];
  }

  isPinnedOpen(): boolean {
    return this.marks.pinnedBandFolded.get(this.project) !== true;
  }

  togglePinned(): void {
    this.marks.pinnedBandFolded.set(this.project, this.isPinnedOpen());
  }

  closeAll(trees: readonly ThreadTreeNode[], folderIds: readonly string[] = []): void {
    const closed = new Set(this.closed);
    const closedFrom: string[] = [];
    const shut = (id: string): void => {
      if (closed.has(id)) return;
      closed.add(id);
      closedFrom.push(id);
    };
    const close = (node: ThreadTreeNode): void => {
      if (node.children.length > 0) shut(node.row.id);
      for (const child of node.children) close(child);
    };
    for (const id of folderIds) shut(id);
    for (const tree of trees) close(tree);
    this.marks.threadFolds.set(this.project, [...closed]);
    this.marks.openThreadStubs.set(this.project, []);
    this.moreOpen = [];
    this.closedFrom = closedFrom.length > 0 ? closedFrom : null;
  }

  openBack(): void {
    const closedFrom = this.closedFrom;
    if (closedFrom === null) return;
    this.closedFrom = null;
    const receipt = new Set(closedFrom);
    const kept = this.marks.threadFolds.get(this.project) ?? [];
    this.marks.threadFolds.set(
      this.project,
      kept.filter((id) => !receipt.has(id)),
    );
  }

  anyOpen(trees: readonly ThreadTreeNode[], folderIds: readonly string[] = []): boolean {
    const hasOpenParent = (node: ThreadTreeNode): boolean =>
      (node.children.length > 0 && this.isOpen(node.row.id)) || node.children.some(hasOpenParent);
    return folderIds.some((id) => this.isOpen(id)) || trees.some(hasOpenParent);
  }

  setOpen(id: string, open: boolean): void {
    if (this.isOpen(id) !== open) this.toggle(id);
  }

  get canOpenBack(): boolean {
    return this.closedFrom !== null;
  }

  get shape(): FoldShape {
    return { closed: this.marks.threadFolds.get(this.project), stubs: this.marks.openThreadStubs.get(this.project), more: this.moreOpen };
  }

  private get closed(): ReadonlySet<string> {
    return this.closedSets.of(this.marks.threadFolds.get(this.project));
  }

  private get openStubs(): ReadonlySet<string> {
    return this.stubSets.of(this.marks.openThreadStubs.get(this.project));
  }

  private get project(): string {
    return String(this.aim.tileId);
  }
}
