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

const sibling = (a: TreeBlock, b: TreeBlock): number =>
  a.ord - b.ord || a.name.localeCompare(b.name) || a.identity.localeCompare(b.identity);

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
  private readonly identitiesByRow = new Map<number, string>();
  private readonly identitiesByName = new SvelteMap<string, SvelteSet<string>>();
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
        if (frame.type === 'resync') {
          this.pendingChanges = [];
          void this.reload();
        } else this.applyChange(frame);
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
      for (const task of ready ?? []) this.readyNames.add(task.identity);
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
    const direct = this.blocks.get(name);
    if (direct !== undefined) return direct;
    const matching = this.identitiesByName.get(name);
    const identity = matching?.size === 1 ? matching.values().next().value : undefined;
    return identity === undefined ? undefined : this.blocks.get(identity);
  }

  children(name: string): readonly string[] {
    return this.childrenByParent.get(this.block(name)?.identity ?? name) ?? [];
  }

  trash(name: string): TreeBlock | undefined {
    const exact = this.trashRoots.find((row) => row.identity === name);
    if (exact !== undefined) return exact;
    const matching = this.trashRoots.filter((row) => row.name === name);
    return matching.length === 1 ? matching[0] : undefined;
  }

  writeFresh(next: TreeBlock): void {
    const former = this.identitiesByRow.get(next.rowKey);
    if (former !== undefined && former !== next.identity) this.remove(former);
    const existing = this.blocks.get(next.identity);
    if (existing !== undefined && existing.updatedAt > next.updatedAt) return;
    this.blocks.set(next.identity, next);
    this.identitiesByRow.set(next.rowKey, next.identity);
    if (existing === undefined) this.addName(next);
    if (existing !== undefined && existing.parentIdentity === next.parentIdentity && existing.ord === next.ord) return;
    if (existing !== undefined) this.unplace(existing);
    this.place(next);
  }

  applyChange(change: GraphChange): void {
    if (this.pendingChanges) {
      this.pendingChanges.push(change);
      return;
    }
    const identities = new Set<string>();
    const rowKeys = new Set<number>();
    for (const row of change.blocks) {
      rowKeys.add(row.rowKey);
      identities.add(row.identity);
      const former = this.identitiesByRow.get(row.rowKey);
      if (former !== undefined) identities.add(former);
      if (row.deletedAt === null) this.writeFresh(row);
      else if (former !== undefined) this.remove(former);
    }
    for (const identity of identities) this.readyNames.delete(identity);
    for (const identity of change.readyIdentities) this.readyNames.add(identity);
    const touchesTrash =
      change.trash.length > 0 ||
      this.trashRoots.some((row) => rowKeys.has(row.rowKey) || (row.parentIdentity !== null && identities.has(row.parentIdentity)));
    if (!touchesTrash) return;
    this.trashRoots = [
      ...this.trashRoots.filter((row) => !rowKeys.has(row.rowKey) && (row.parentIdentity === null || !identities.has(row.parentIdentity))),
      ...change.trash,
    ].sort(newestDeleted);
  }

  private replaceAll(rows: readonly TreeBlock[]): void {
    this.blocks.clear();
    this.childrenByParent.clear();
    this.roots.clear();
    this.identitiesByRow.clear();
    this.identitiesByName.clear();
    const byParent = new Map<string, TreeBlock[]>();
    for (const row of rows) {
      this.blocks.set(row.identity, row);
      this.identitiesByRow.set(row.rowKey, row.identity);
      this.addName(row);
      if (row.parentIdentity === null) {
        this.roots.add(row.identity);
        continue;
      }
      const siblings = byParent.get(row.parentIdentity);
      if (siblings) siblings.push(row);
      else byParent.set(row.parentIdentity, [row]);
    }
    for (const [parentIdentity, siblings] of byParent) {
      this.childrenByParent.set(
        parentIdentity,
        siblings.sort(sibling).map((row) => row.identity),
      );
    }
  }

  private addName(row: TreeBlock): void {
    let names = this.identitiesByName.get(row.name);
    if (names === undefined) {
      names = new SvelteSet<string>();
      this.identitiesByName.set(row.name, names);
    }
    names.add(row.identity);
  }

  private remove(identity: string): void {
    const existing = this.blocks.get(identity);
    if (existing === undefined) return;
    this.blocks.delete(identity);
    this.identitiesByRow.delete(existing.rowKey);
    const names = this.identitiesByName.get(existing.name);
    names?.delete(identity);
    if (names?.size === 0) this.identitiesByName.delete(existing.name);
    this.unplace(existing);
  }

  private place(row: TreeBlock): void {
    if (row.parentIdentity === null) {
      this.roots.add(row.identity);
      return;
    }
    const siblings = this.childrenByParent.get(row.parentIdentity) ?? [];
    let low = 0;
    let high = siblings.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      const other = this.blocks.get(siblings[middle] as string);
      if (other !== undefined && sibling(other, row) < 0) low = middle + 1;
      else high = middle;
    }
    this.childrenByParent.set(row.parentIdentity, [...siblings.slice(0, low), row.identity, ...siblings.slice(low)]);
  }

  private unplace(row: TreeBlock): void {
    if (row.parentIdentity === null) {
      this.roots.delete(row.identity);
      return;
    }
    const siblings = this.childrenByParent.get(row.parentIdentity);
    if (siblings === undefined) return;
    const kept = siblings.filter((identity) => identity !== row.identity);
    if (kept.length === 0) this.childrenByParent.delete(row.parentIdentity);
    else this.childrenByParent.set(row.parentIdentity, kept);
  }
}
