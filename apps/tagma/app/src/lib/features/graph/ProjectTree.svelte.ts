import type { TreeBlock } from '@tagma/server/graph/contract/wire/rows';
import { Failure } from '@runlith/layer/Failure';
import { Scope } from '@runlith/layer/Scope';
import { Service } from '@runlith/layer/key';
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import { GraphRung, type GraphAim } from '$lib/features/workspace/GraphRung.js';
import { BlocksRepo } from './BlocksRepo.js';
import { GraphFeed } from './Feed.js';
import type { GraphChange } from '$lib/wire/Live.js';
import { SelectionRepo } from './SelectionRepo.js';

const sibling = (a: TreeBlock, b: TreeBlock): number => a.ord - b.ord || a.name.localeCompare(b.name);

const newestDeleted = (a: TreeBlock, b: TreeBlock): number => (b.deletedAt ?? '').localeCompare(a.deletedAt ?? '');

export class ProjectTree extends Service<ProjectTree>()('ProjectTree', { tier: 'graph', eager: true }) {
  static *make() {
    return new ProjectTree(
      yield* GraphRung.Current,
      yield* BlocksRepo,
      yield* SelectionRepo,
      yield* GraphFeed,
      yield* Scope,
      yield* Failure,
    );
  }

  readonly blocks = new SvelteMap<string, TreeBlock>();
  readonly childrenByParent = new SvelteMap<string, readonly string[]>();
  readonly readyNames = new SvelteSet<string>();
  trashRoots = $state<readonly TreeBlock[]>([]);
  loaded = $state(false);

  private readonly roots = new SvelteSet<string>();
  readonly rootName = $derived<string | null>(this.roots.values().next().value ?? null);

  private pendingChanges: GraphChange[] | null = null;
  private reloadGeneration = 0;

  constructor(
    readonly aim: GraphAim,
    private readonly blocksRepo: BlocksRepo,
    private readonly selection: SelectionRepo,
    feed: GraphFeed,
    scope: Scope,
    private readonly failure: Failure,
  ) {
    super();
    scope.defer(
      feed.frames((frame) => {
        if (frame.type === 'resync') void this.reload();
        else this.applyChange(frame);
      }),
    );
  }

  async reload(): Promise<void> {
    const generation = ++this.reloadGeneration;
    this.pendingChanges ??= [];
    try {
      const aim = { projectId: this.aim.projectId, branch: this.aim.branch };
      const [rows, ready, trashRows] = await Promise.all([
        this.blocksRepo.tree.refresh({ throwOnError: true }),
        this.selection.ready.key(aim).refresh({ throwOnError: true }),
        this.selection.trash.key(aim).refresh({ throwOnError: true }),
      ]);
      if (generation !== this.reloadGeneration) return;
      this.replaceAll(rows ?? []);
      this.readyNames.clear();
      for (const task of ready ?? []) this.readyNames.add(task.name);
      this.trashRoots = trashRows ?? [];
      this.loaded = true;
    } catch (error) {
      this.failure.report(error);
    } finally {
      if (generation === this.reloadGeneration) {
        const pending = this.pendingChanges ?? [];
        this.pendingChanges = null;
        for (const change of pending) this.applyChange(change);
      }
    }
  }

  block(name: string): TreeBlock | undefined {
    return this.blocks.get(name);
  }

  children(name: string): readonly string[] {
    return this.childrenByParent.get(name) ?? [];
  }

  writeFresh(next: TreeBlock): void {
    const existing = this.blocks.get(next.name);
    if (existing !== undefined && existing.updatedAt > next.updatedAt) return;
    this.blocks.set(next.name, next);
    if (existing !== undefined && existing.parentName === next.parentName && existing.ord === next.ord) return;
    if (existing !== undefined) this.unplace(existing);
    this.place(next);
  }

  applyChange(change: GraphChange): void {
    if (this.pendingChanges) {
      this.pendingChanges.push(change);
      return;
    }
    const names = new Set<string>();
    for (const row of change.blocks) {
      names.add(row.name);
      if (row.deletedAt === null) this.writeFresh(row);
      else this.remove(row.name);
    }
    for (const name of names) this.readyNames.delete(name);
    for (const name of change.ready) this.readyNames.add(name);
    const touchesTrash =
      change.trash.length > 0 ||
      this.trashRoots.some((row) => names.has(row.name) || (row.parentName !== null && names.has(row.parentName)));
    if (!touchesTrash) return;
    this.trashRoots = [
      ...this.trashRoots.filter((row) => !names.has(row.name) && (row.parentName === null || !names.has(row.parentName))),
      ...change.trash,
    ].sort(newestDeleted);
  }

  private replaceAll(rows: readonly TreeBlock[]): void {
    this.blocks.clear();
    this.childrenByParent.clear();
    this.roots.clear();
    const byParent = new Map<string, TreeBlock[]>();
    for (const row of rows) {
      this.blocks.set(row.name, row);
      if (row.parentName === null) {
        this.roots.add(row.name);
        continue;
      }
      const siblings = byParent.get(row.parentName);
      if (siblings) siblings.push(row);
      else byParent.set(row.parentName, [row]);
    }
    for (const [parentName, siblings] of byParent) {
      this.childrenByParent.set(
        parentName,
        siblings.sort(sibling).map((row) => row.name),
      );
    }
  }

  private remove(name: string): void {
    const existing = this.blocks.get(name);
    if (existing === undefined) return;
    this.blocks.delete(name);
    this.unplace(existing);
  }

  private place(row: TreeBlock): void {
    if (row.parentName === null) {
      this.roots.add(row.name);
      return;
    }
    const siblings = this.childrenByParent.get(row.parentName) ?? [];
    let low = 0;
    let high = siblings.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      const other = this.blocks.get(siblings[middle] as string);
      if (other !== undefined && sibling(other, row) < 0) low = middle + 1;
      else high = middle;
    }
    this.childrenByParent.set(row.parentName, [...siblings.slice(0, low), row.name, ...siblings.slice(low)]);
  }

  private unplace(row: TreeBlock): void {
    if (row.parentName === null) {
      this.roots.delete(row.name);
      return;
    }
    const siblings = this.childrenByParent.get(row.parentName);
    if (siblings === undefined) return;
    const kept = siblings.filter((name) => name !== row.name);
    if (kept.length === 0) this.childrenByParent.delete(row.parentName);
    else this.childrenByParent.set(row.parentName, kept);
  }
}
