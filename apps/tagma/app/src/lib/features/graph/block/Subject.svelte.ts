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
  private loaded = $state<BlockRead | null>(null);
  private loadedFor = $state<string | null>(null);
  private failed = $state<Unavailable | null>(null);

  get unavailable(): Unavailable | null {
    return this.failed?.name === this.store.requestedName ? this.failed : null;
  }

  get read(): BlockRead | null {
    return this.loadedFor === this.store.requestedName ? this.loaded : null;
  }
  readonly root: TreeBlock | undefined;
  private inFlight = $state(false);
  private stale = $state(0);
  private settled: Asked | null = null;

  constructor(
    private readonly store: TreeScreen,
    private readonly blocks: BlocksRepo,
    private readonly feed: GraphFeed,
    private readonly tags: TagCatalog,
    private readonly notices: Notices,
  ) {
    this.root = $derived(store.root);
    const asked = untrack(() => store.requestedName);
    const kept = untrack(() => this.kept(asked));
    if (asked !== null && kept !== null) {
      this.loadedFor = asked;
      this.loaded = kept;
      store.resolveRoot(asked, kept.identity);
    }

    $effect(() => {
      const name = store.requestedName;
      const stamp = this.root?.updatedAt;
      const stale = this.stale;
      const shown = this.read;
      if (name === null || this.inFlight) return;
      const last = this.settled;
      if (last !== null && last.name === name && last.stale === stale) {
        if (last.stamp === stamp) return;
        if (shown !== null && shown.identity === this.root?.identity && shown.updatedAt === stamp) return;
      }
      untrack(() => void this.ask({ name, stamp, stale }));
    });

    $effect(() => {
      const name = store.requestedName;
      if (name === null) return;
      return this.feed.frames((frame) => {
        if (frame.type === 'resync') {
          this.loaded = null;
          this.loadedFor = null;
          this.failed = null;
          this.stale += 1;
          return;
        }
        const shown = this.read;
        if (shown === null) return;
        const mine = frame.blocks.find((row) => row.rowKey === shown.rowKey);
        if (mine === undefined) return;
        if (mine.identity !== shown.identity) {
          this.stale += 1;
          return;
        }
        if (mine.deletedAt !== null) {
          this.loaded = null;
          this.failed = { kind: 'trashed', name };
          this.settled = { name, stamp: undefined, stale: this.stale };
          return;
        }
        if (
          this.tags.supports(mine, LEAF) ||
          frame.events.some((entry) => entry.identity === shown.identity && CONNECTIVITY_OPS.has(entry.op))
        )
          this.stale += 1;
      });
    });
  }

  retry(): void {
    if (this.inFlight) return;
    this.failed = null;
    this.stale += 1;
  }

  private kept(name: string | null): BlockRead | null {
    if (name === null) return null;
    const kept = this.blocks.block.key({ name, depth: 0 }).watch();
    return kept !== undefined && kept.updatedAt === this.store.liveBlock(kept.identity)?.updatedAt ? kept : null;
  }

  private async ask(asked: Asked): Promise<void> {
    this.inFlight = true;
    try {
      const loaded = await this.blocks.block.key({ name: asked.name, depth: 0 }).refresh({ throwOnError: true });
      if (loaded === undefined || this.store.requestedName !== asked.name || this.stale !== asked.stale) return;
      this.failed = null;
      this.loadedFor = asked.name;
      this.loaded = loaded;
      this.store.resolveRoot(asked.name, loaded.identity);
    } catch (error) {
      if (this.store.requestedName !== asked.name || this.stale !== asked.stale) return;
      if (error instanceof Refusal && (error.code === 'deleted' || error.code === 'not-found')) {
        this.loaded = null;
        this.loadedFor = asked.name;
        this.failed = { kind: error.code === 'deleted' ? 'trashed' : 'absent', name: asked.name };
      } else if (this.read !== null) this.notices.background(error);
      else this.failed = { kind: 'failed', name: asked.name, error };
    } finally {
      this.settled = asked;
      this.inFlight = false;
    }
  }
}
