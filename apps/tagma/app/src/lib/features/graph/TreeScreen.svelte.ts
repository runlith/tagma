import type { BatchOp } from '@tagma/server/graph/contract/wire/batch';
import { type BlockMark, type MarkKind } from '@tagma/server/graph/contract/wire/reads';
import type { Block, TreeBlock } from '@tagma/server/graph/contract/wire/rows';
import type { Delivery } from '@tagma/server/graph/contract/wire/tags/law';
import type { StorageMode } from '@tagma/server/projects/contract/wire/project';
import { Failure } from '@runlith/layer/Failure';
import { Platform, type PlatformStorage } from '@runlith/layer/Platform';
import { Scope } from '@runlith/layer/Scope';
import { Screen } from '@runlith/layer/svelte/screen.svelte';
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import { GraphRung } from '$lib/features/workspace/GraphRung.js';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import { BlocksRepo } from './BlocksRepo.js';
import { HiddenStates } from './HiddenStates.svelte.js';
import { ProjectTree } from './ProjectTree.svelte.js';
import { ReadingLens } from './ReadingLens.svelte.js';
import { isRestingState } from './status.js';
import { TagCatalog } from './TagCatalog.svelte.js';

const expandedKey = (projectId: number) => `tagma.expanded.${projectId}`;

export type TreeReading = 'outline' | 'block' | 'graph';

export type TreeScreenOptions = { readonly reading: TreeReading; readonly root?: string | undefined };

export type TitleEdit = { readonly name: string; readonly at: 'start' | 'end' };

export class TreeScreen extends Screen<TreeScreen, TreeScreenOptions>()('TreeScreen', { tier: 'graph' }) {
  private asked = $state<string | null>(null);

  get rootName(): string | null {
    return this.asked ?? this.tree.rootName;
  }

  set rootName(name: string | null) {
    this.asked = name;
  }

  get root(): TreeBlock | undefined {
    return this.rootName === null ? undefined : this.tree.block(this.rootName);
  }

  get rootAbsent(): boolean {
    return this.asked !== null && this.tree.loaded && this.tree.block(this.asked) === undefined;
  }

  expanded = new SvelteSet<string>();
  readonly marks = new SvelteMap<string, MarkKind>();
  readonly ghosts = new SvelteMap<string, Block>();
  lensReturn = $state<string | null>(null);
  editing = $state.raw<TitleEdit | null>(null);
  loaded = $state(false);
  private undoNames: string[] = [];
  readonly readingLens: ReadingLens;
  private structuralBusy = false;

  static override *make(options: TreeScreenOptions) {
    const platform = yield* Platform;
    const screen = new TreeScreen(
      yield* ProjectTree,
      yield* BlocksRepo,
      yield* HiddenStates,
      yield* TagCatalog,
      yield* Notices,
      yield* Failure,
      platform.storage.local,
      yield* Scope,
      (yield* GraphRung.Current).projectId,
      options.reading,
    );
    screen.load(options.root);
    return screen;
  }

  constructor(
    private readonly tree: ProjectTree,
    private readonly repo: BlocksRepo,
    private readonly hidden: HiddenStates,
    private readonly tags: TagCatalog,
    private readonly notices: Notices,
    private readonly failure: Failure,
    private readonly storage: PlatformStorage,
    private readonly life: Scope,
    public readonly projectId: number,
    public readonly reading: TreeReading = 'outline',
  ) {
    super();
    this.readingLens = new ReadingLens(tree.readyNames, tags, storage);
  }

  get blocks(): ReadonlyMap<string, TreeBlock> {
    return this.tree.blocks;
  }

  get trashRoots(): readonly TreeBlock[] {
    return this.tree.trashRoots;
  }

  readonly visibleNames = $derived.by(() => {
    if (this.rootName === null) return [];
    const rows: string[] = [];
    const walk = (name: string) => {
      for (const child of this.visibleChildren(name)) {
        rows.push(child);
        if (this.readingLens.active || this.expanded.has(child)) walk(child);
      }
    };
    walk(this.rootName);
    return rows;
  });

  matchesFilter(name: string): boolean {
    const block = this.tree.block(name);
    return block !== undefined && this.readingLens.matches(block);
  }

  readonly filterVisible = $derived.by(() => {
    if (!this.readingLens.active) return null;
    const visible = new Set<string>();
    for (const block of this.tree.blocks.values()) {
      if (!this.matchesFilter(block.name) && !this.readingLens.exempt.has(block.name)) continue;
      let cursor: string | null = block.name;
      while (cursor !== null && !visible.has(cursor)) {
        visible.add(cursor);
        cursor = this.tree.block(cursor)?.parentName ?? null;
      }
    }
    return visible;
  });

  private lensMemoryKey(): string | null {
    return this.rootName === null ? null : `tagma.filter.${this.reading}.${this.projectId}.${this.rootName}`;
  }

  block(name: string): TreeBlock | undefined {
    return this.tree.block(name) ?? this.ghosts.get(name);
  }

  get lensActive(): boolean {
    return this.marks.size > 0 || this.ghosts.size > 0;
  }

  setLens(marks: readonly BlockMark[], blocks: readonly Block[]): void {
    this.marks.clear();
    this.ghosts.clear();
    for (const mark of marks) this.marks.set(mark.blockName, mark.mark);
    for (const row of blocks) {
      if (row.deletedAt !== null) this.ghosts.set(row.name, row);
    }
  }

  clearLens(): void {
    this.marks.clear();
    this.ghosts.clear();
  }

  children(name: string): readonly string[] {
    return this.tree.children(name);
  }

  visibleChildren(name: string): string[] {
    const hidden = new Set(this.hidden.hiddenStates);
    for (const state of this.readingLens.states) {
      if (isRestingState(state)) hidden.delete(state);
    }
    let rows = this.children(name).filter((childName) => {
      const child = this.tree.block(childName);
      return child === undefined || this.tags.showsInOutline(child, hidden);
    });
    const filterSet = this.filterVisible;
    if (filterSet !== null) rows = rows.filter((childName) => filterSet.has(childName));
    const ghosts = [...this.ghosts.values()].filter((row) => row.parentName === name).map((row) => row.name);
    return this.sortRows(ghosts.length === 0 ? rows : [...rows, ...ghosts]);
  }

  private sortRows(names: readonly string[]): string[] {
    const mode = this.readingLens.sortMode;
    if (mode === 'manual') return [...names];
    const rows = [...names];
    rows.sort((a, b) => {
      const blockA = this.tree.block(a);
      const blockB = this.tree.block(b);
      if (!blockA || !blockB) return 0;
      if (mode === 'updated-asc') return blockA.updatedAt.localeCompare(blockB.updatedAt) || a.localeCompare(b);
      if (mode === 'created-desc') return blockB.createdAt.localeCompare(blockA.createdAt) || a.localeCompare(b);
      return blockB.updatedAt.localeCompare(blockA.updatedAt) || a.localeCompare(b);
    });
    return rows;
  }

  hasChildren(name: string): boolean {
    return this.visibleChildren(name).length > 0;
  }

  isBlocked(name: string): boolean {
    return this.tree.block(name)?.blocked === true;
  }

  load(rootBlockName?: string): void {
    this.asked = rootBlockName ?? null;
    this.restoreExpanded();
    const lensKey = this.lensMemoryKey();
    if (lensKey !== null) this.readingLens.restore(lensKey);
    if (this.rootName !== null) this.expanded.add(this.rootName);
    this.loaded = true;
  }

  toggle(name: string): void {
    if (this.expanded.has(name)) this.expanded.delete(name);
    else this.expanded.add(name);
    this.persistExpanded();
  }

  private closedFrom = $state<string[] | null>(null);

  readonly anyOpen = $derived.by(() => {
    for (const name of this.expanded) {
      if (name !== this.rootName) return true;
    }
    return false;
  });

  get canOpenBack(): boolean {
    return this.closedFrom !== null;
  }

  closeAll(): void {
    this.closedFrom = [...this.expanded].filter((name) => name !== this.rootName);
    this.expanded.clear();
    if (this.rootName !== null) this.expanded.add(this.rootName);
    this.persistExpanded();
  }

  openBack(): void {
    const closed = this.closedFrom;
    if (closed === null) return;
    this.closedFrom = null;
    for (const name of closed) this.expanded.add(name);
    this.persistExpanded();
  }

  setBranch(name: string, expand: boolean): void {
    const walk = (node: string) => {
      if (expand) this.expanded.add(node);
      else this.expanded.delete(node);
      for (const child of this.children(node)) walk(child);
    };
    walk(name);
    this.persistExpanded();
  }

  expand(name: string): void {
    if (this.expanded.has(name)) return;
    this.expanded.add(name);
    this.persistExpanded();
  }

  collapse(name: string): void {
    if (!this.expanded.has(name)) return;
    this.expanded.delete(name);
    this.persistExpanded();
  }

  edit(name: string, at: TitleEdit['at'] = 'end'): void {
    this.editing = { name, at };
  }

  leave(edit: TitleEdit): void {
    if (this.editing === edit) this.editing = null;
  }

  async rename(name: string, title: string): Promise<void> {
    const current = this.tree.block(name);
    if (current?.title === title) return;
    try {
      const row = await this.repo.update.run({ name, changes: { title } }, { throwOnError: true });
      const fresh = this.tree.block(name);
      if (row && fresh) this.tree.writeFresh({ ...fresh, ...row });
    } catch (error) {
      this.failure.report(error);
    }
  }

  async setBody(name: string, body: string): Promise<void> {
    try {
      const row = await this.repo.update.run({ name, changes: { body } }, { throwOnError: true });
      const fresh = this.tree.block(name);
      if (row && fresh) this.tree.writeFresh({ ...fresh, ...row });
    } catch (error) {
      this.failure.report(error);
    }
  }

  async setStatus(name: string, status: string): Promise<void> {
    await this.mutate(() => this.repo.update.run({ name, changes: { status } }, { throwOnError: true }));
  }

  async claim(name: string): Promise<void> {
    await this.mutate(() => this.repo.claim.run(name, { throwOnError: true }));
  }

  async release(name: string): Promise<void> {
    await this.mutate(() => this.repo.release.run(name, { throwOnError: true }));
  }

  async done(name: string): Promise<void> {
    await this.mutate(() => this.repo.done.run({ name }, { throwOnError: true }));
  }

  async close(name: string): Promise<void> {
    await this.mutate(() => this.repo.close.run(name, { throwOnError: true }));
  }

  async setLawEnabled(name: string, enabled: boolean): Promise<void> {
    await this.mutate(() => this.repo.setLawEnabled.run({ name, enabled }, { throwOnError: true }));
  }

  async setStorage(name: string, storage: StorageMode): Promise<void> {
    await this.mutate(() => this.repo.setStorage.run({ name, storage }, { throwOnError: true }));
  }

  async setLawDelivery(name: string, delivery: Delivery | null): Promise<void> {
    await this.mutate(() => this.repo.setLawDelivery.run({ name, delivery }, { throwOnError: true }));
  }

  async remove(name: string): Promise<boolean> {
    let removed = false;
    await this.structural(async () => {
      const target = this.tree.block(name);
      if (!target) return;
      const rows = this.visibleNames;
      const previous = rows[rows.indexOf(name) - 1];
      const writing = this.editing?.name === name;
      try {
        await this.repo.trash.run(name, { throwOnError: true });
        await this.tree.reload();
        this.undoNames.push(name);
        if (writing && previous !== undefined) this.edit(previous, 'end');
        this.notices.undoable(`Deleted “${target.title.trim() || 'Untitled'}” · ${name}`, () => void this.restore(name), this.life);
        removed = true;
      } catch (error) {
        this.failure.report(error);
      }
    });
    return removed;
  }

  async restore(name: string): Promise<boolean> {
    try {
      await this.repo.restore.run(name, { throwOnError: true });
      await this.tree.reload();
      this.undoNames = this.undoNames.filter((item) => item !== name);
      return true;
    } catch (error) {
      this.failure.report(error);
      return false;
    }
  }

  get canUndo(): boolean {
    return this.undoNames.length > 0;
  }

  async undoLastDelete(): Promise<void> {
    const name = this.undoNames.at(-1);
    if (name !== undefined) await this.restore(name);
  }

  async createAfter(name: string): Promise<void> {
    await this.structural(async () => {
      const source = this.tree.block(name);
      if (!source || source.parentName === null) return;
      const parentName = source.parentName;
      try {
        const siblings = this.children(parentName);
        const nextId = siblings[siblings.indexOf(name) + 1];
        const next = nextId === undefined ? undefined : this.tree.block(nextId);
        const gated = source.tags.some((tag) => this.tags.declared.includes(tag) && !this.tags.createsFromTitle(tag));
        if (gated) return;
        const ops: BatchOp[] = [{ op: 'create', $id: 'n', parentId: parentName, tags: [...source.tags], title: '' }];
        if (next) ops.push({ op: 'update', id: '$n', ord: (source.ord + next.ord) / 2 });
        const result = await this.repo.applyBatch.run(ops, { throwOnError: true });
        await this.tree.reload();
        const createdName = result?.ids.n;
        if (createdName !== undefined) {
          this.readingLens.exempt.add(createdName);
          this.edit(createdName, 'start');
        }
      } catch (error) {
        this.failure.report(error);
      }
    });
  }

  async createChild(parentName: string, tag: string, storage?: StorageMode): Promise<void> {
    await this.structural(async () => {
      try {
        const created = await this.repo.create.run({ parentId: parentName, tags: [tag], title: '', storage }, { throwOnError: true });
        this.expand(parentName);
        await this.tree.reload();
        if (created) {
          this.readingLens.exempt.add(created.name);
          this.edit(created.name, 'start');
        }
      } catch (error) {
        this.failure.report(error);
      }
    });
  }

  async indent(name: string): Promise<void> {
    await this.structural(async () => {
      const block = this.tree.block(name);
      if (!block || block.parentName === null) return;
      const visible = this.visibleChildren(block.parentName);
      const index = visible.indexOf(name);
      if (index <= 0) return;
      const newParentName = visible[index - 1];
      if (newParentName === undefined) return;
      const tail = this.children(newParentName).at(-1);
      const ord = tail !== undefined ? (this.tree.block(tail)?.ord ?? 0) + 1 : 1;
      const writing = this.editing?.name === name;
      try {
        await this.repo.update.run({ name, changes: { parentId: newParentName, ord } }, { throwOnError: true });
        this.expand(newParentName);
        await this.tree.reload();
        if (writing) this.edit(name, 'end');
      } catch (error) {
        this.failure.report(error);
      }
    });
  }

  async outdent(name: string): Promise<void> {
    await this.structural(async () => {
      const block = this.tree.block(name);
      if (!block || block.parentName === null || block.parentName === this.rootName) return;
      const parent = this.tree.block(block.parentName);
      if (!parent || parent.parentName === null) return;
      const parentSiblings = this.children(parent.parentName);
      const parentIndex = parentSiblings.indexOf(parent.name);
      const followingId = parentSiblings[parentIndex + 1];
      const following = followingId === undefined ? undefined : this.tree.block(followingId);
      const ord = following ? (parent.ord + following.ord) / 2 : parent.ord + 1;
      const writing = this.editing?.name === name;
      try {
        await this.repo.update.run({ name, changes: { parentId: parent.parentName, ord } }, { throwOnError: true });
        await this.tree.reload();
        if (writing) this.edit(name, 'end');
      } catch (error) {
        this.failure.report(error);
      }
    });
  }

  async moveUp(name: string): Promise<void> {
    await this.moveAmongSiblings(name, -1);
  }

  async moveDown(name: string): Promise<void> {
    await this.moveAmongSiblings(name, 1);
  }

  private async moveAmongSiblings(name: string, step: -1 | 1): Promise<void> {
    if (this.readingLens.sortMode !== 'manual') return;
    await this.structural(async () => {
      const block = this.tree.block(name);
      if (!block || block.parentName === null) return;
      const visible = this.visibleChildren(block.parentName);
      const visibleIndex = visible.indexOf(name);
      const neighbourName = visible[visibleIndex + step];
      if (neighbourName === undefined) return;
      const siblings = this.children(block.parentName);
      const ord = this.ordAround(siblings, siblings.indexOf(neighbourName), step);
      const writing = this.editing?.name === name;
      try {
        await this.repo.update.run({ name, changes: { ord } }, { throwOnError: true });
        await this.tree.reload();
        if (writing) this.edit(name, 'end');
      } catch (error) {
        this.failure.report(error);
      }
    });
  }

  private async structural(operation: () => Promise<void>): Promise<void> {
    if (this.structuralBusy) return;
    this.structuralBusy = true;
    try {
      await operation();
    } finally {
      this.structuralBusy = false;
    }
  }

  private ordAround(siblings: readonly string[], targetIndex: number, step: -1 | 1): number {
    const neighbour = this.tree.block(siblings[targetIndex] ?? '');
    const beyondName = siblings[targetIndex + step];
    const beyond = beyondName === undefined ? undefined : this.tree.block(beyondName);
    if (!neighbour) return 0;
    if (!beyond) return neighbour.ord + step;
    return (neighbour.ord + beyond.ord) / 2;
  }

  private async mutate(operation: () => Promise<unknown>): Promise<void> {
    try {
      await operation();
      await this.tree.reload();
    } catch (error) {
      this.failure.report(error);
    }
  }

  private restoreExpanded(): void {
    try {
      const stored = JSON.parse(this.storage.getItem(expandedKey(this.projectId)) ?? '[]') as string[];
      for (const name of stored) this.expanded.add(name);
    } catch {}
  }

  private persistExpanded(): void {
    this.storage.setItem(expandedKey(this.projectId), JSON.stringify([...this.expanded]));
  }
}
