import type { TreeBlock } from '@tagma/server/graph/contract/wire/rows';
import { Platform, type PlatformStorage } from '@runlith/layer/Platform';
import { Screen } from '@runlith/layer/svelte/screen.svelte';
import { SvelteSet } from 'svelte/reactivity';
import { HiddenStates } from '$lib/features/graph/HiddenStates.svelte.js';
import { ProjectTree } from '$lib/features/graph/ProjectTree.svelte.js';
import { TagCatalog } from '$lib/features/graph/TagCatalog.svelte.js';
import { GraphRung } from '$lib/features/workspace/GraphRung.js';
import { type TreeLine, treeLines } from './treeLines.js';

const expandedKey = (projectId: number) => `tagma.sidebarExpanded.${projectId}`;

export class SidebarTree extends Screen<SidebarTree>()('SidebarTree', { tier: 'graph' }) {
  static override *make() {
    const platform = yield* Platform;
    return new SidebarTree(
      yield* ProjectTree,
      yield* HiddenStates,
      yield* TagCatalog,
      platform.storage.local,
      (yield* GraphRung.Current).projectId,
    );
  }

  readonly expanded = new SvelteSet<string>();

  constructor(
    private readonly tree: ProjectTree,
    private readonly hidden: HiddenStates,
    private readonly tags: TagCatalog,
    private readonly storage: PlatformStorage,
    private readonly projectId: number,
  ) {
    super();
    for (const name of storedNames(storage.getItem(expandedKey(projectId)))) this.expanded.add(name);
  }

  readonly openNames = $derived.by(() => new Set([...this.expanded].map((name) => this.tree.block(name)?.identity ?? name)));

  readonly lines: readonly TreeLine[] = $derived.by(() => {
    const root = this.tree.rootName;
    return root === null ? [] : treeLines(root, (name) => this.visibleChildren(name), this.openNames);
  });

  block(name: string): TreeBlock | undefined {
    return this.tree.block(name);
  }

  visibleChildren(name: string): readonly string[] {
    const hidden = this.hidden.hiddenStates;
    return this.tree.children(name).filter((child) => {
      const block = this.tree.block(child);
      return block !== undefined && this.tags.showsInOutline(block, hidden);
    });
  }

  toggle(name: string): void {
    if (this.openNames.has(name)) this.collapse(name);
    else this.expand(name);
  }

  expand(name: string): void {
    if (this.openNames.has(name)) return;
    this.expanded.add(name);
    this.persist();
  }

  collapse(name: string): void {
    if (!this.openNames.has(name)) return;
    this.expanded.delete(name);
    const row = this.tree.block(name);
    if (row !== undefined && this.tree.block(row.name)?.identity === row.identity) this.expanded.delete(row.name);
    this.persist();
  }

  private persist(): void {
    this.storage.setItem(expandedKey(this.projectId), JSON.stringify([...this.expanded]));
  }
}

function storedNames(raw: string | null): string[] {
  try {
    const parsed: unknown = JSON.parse(raw ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
  } catch {
    return [];
  }
}
