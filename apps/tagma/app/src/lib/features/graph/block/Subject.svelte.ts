import type { GraphEventOp } from '@tagma/server/graph/contract/wire/journal';
import type { BlockRead, TreeBlock } from '@tagma/server/graph/contract/wire/rows';
import { LEAF } from '@tagma/server/graph/contract/wire/tags/leaf';
import { untrack } from 'svelte';
import type { BlocksRepo } from '$lib/features/graph/BlocksRepo.js';
import type { GraphFeed } from '$lib/features/graph/Feed.js';
import type { TagCatalog } from '$lib/features/graph/TagCatalog.svelte.js';
import type { TreeScreen } from '$lib/features/graph/TreeScreen.svelte.js';
import type { Notices } from '$lib/features/notices/Service.svelte.js';
import { Refusal } from '$lib/wire/refusal.js';

export type Unavailable =
  | { readonly kind: 'trashed' | 'absent'; readonly name: string }
  | { readonly kind: 'failed'; readonly name: string; readonly error: unknown };

type Asked = { readonly name: string; readonly stamp: string | undefined; readonly stale: number };

const CONNECTIVITY_OPS: ReadonlySet<GraphEventOp> = new Set<GraphEventOp>(['anchor', 'unanchor', 'link', 'unlink']);

export class Subject {
  read = $state<BlockRead | null>(null);
  unavailable = $state<Unavailable | null>(null);
  readonly root: TreeBlock | undefined;
  private inFlight = $state(false);
  private stale = $state(0);
  private settled: Asked | null = null;

  constructor(
    private readonly store: TreeScreen,
    private readonly blocks: ReturnType<typeof BlocksRepo.use>,
    private readonly feed: GraphFeed,
    private readonly tags: TagCatalog,
    private readonly notices: Notices,
  ) {
    this.root = $derived(store.root);
    this.read = untrack(() => this.kept(store.rootName));

    $effect(() => {
      const name = store.rootName;
      const stamp = this.root?.updatedAt;
      const stale = this.stale;
      const shown = this.read;
      if (name === null || this.inFlight) return;
      const last = this.settled;
      if (last !== null && last.name === name && last.stale === stale) {
        if (last.stamp === stamp) return;
        if (shown?.name === name && shown.updatedAt === stamp) return;
      }
      untrack(() => void this.ask({ name, stamp, stale }));
    });

    $effect(() => {
      const name = store.rootName;
      if (name === null) return;
      return this.feed.frames((frame) => {
        if (frame.type !== 'change') return;
        const mine = frame.blocks.find((row) => row.name === name);
        if (mine === undefined) return;
        if (mine.deletedAt !== null) {
          this.read = null;
          this.unavailable = { kind: 'trashed', name };
          this.settled = { name, stamp: undefined, stale: this.stale };
          return;
        }
        if (this.tags.supports(mine, LEAF) || frame.events.some((entry) => CONNECTIVITY_OPS.has(entry.op))) this.stale += 1;
      });
    });
  }

  retry(): void {
    if (this.inFlight) return;
    this.unavailable = null;
    this.stale += 1;
  }

  private kept(name: string | null): BlockRead | null {
    if (name === null) return null;
    const kept = this.blocks.block.key({ name, depth: 0 }).watch();
    return kept !== undefined && kept.updatedAt === this.store.root?.updatedAt ? kept : null;
  }

  private async ask(asked: Asked): Promise<void> {
    this.inFlight = true;
    try {
      const loaded = await this.blocks.block.key({ name: asked.name, depth: 0 }).refresh({ throwOnError: true });
      if (loaded === undefined) return;
      this.unavailable = null;
      this.read = loaded;
    } catch (error) {
      if (error instanceof Refusal && (error.code === 'deleted' || error.code === 'not-found')) {
        this.read = null;
        this.unavailable = { kind: error.code === 'deleted' ? 'trashed' : 'absent', name: asked.name };
      } else if (this.read !== null) this.notices.background(error);
      else this.unavailable = { kind: 'failed', name: asked.name, error };
    } finally {
      this.settled = asked;
      this.inFlight = false;
    }
  }
}
