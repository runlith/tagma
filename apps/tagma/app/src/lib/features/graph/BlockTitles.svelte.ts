import { Router } from '@runlith/layer/Router';
import { Scope } from '@runlith/layer/Scope';
import { Service } from '@runlith/layer/key';
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import { type BlockPlace, type BlockRefFailure, type BlockRefPeer, type BlockRefs, blockRefView, placedHref } from './blockRefView.js';
import { refusalOf } from '$lib/wire/refusal.js';
import { BlocksRepo } from './BlocksRepo.js';
import { GraphFeed } from './Feed.js';
import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
import type { BlockLens } from '$lib/features/workspace/address.js';
import { Addresses } from '$lib/features/workspace/Addresses.js';
import { GraphRung, type GraphAim } from '$lib/features/workspace/GraphRung.js';

type Blocks = ReturnType<typeof BlocksRepo.use>;

type Title = { title: string; projectId: number; branch?: string | null } | BlockRefFailure | null;

export class BlockTitles extends Service<BlockTitles>()('BlockTitles', { tier: 'graph' }) implements BlockRefs {
  static *make() {
    return new BlockTitles(
      yield* BlocksRepo,
      yield* GraphFeed,
      yield* Workspace,
      yield* GraphRung.Current,
      yield* Router,
      yield* Addresses,
      yield* Scope,
    );
  }

  private readonly titles = new SvelteMap<string, Title>();
  private readonly stale = new SvelteSet<string>();
  private readonly asking = new Set<string>();
  private readonly pending = new Map<string, symbol>();
  private readonly waiting = new Map<string, (() => void)[]>();
  private scheduled = false;
  private canon = 0;

  constructor(
    private readonly repo: Blocks,
    feed: GraphFeed,
    private readonly workspace: Workspace,
    private readonly aim: GraphAim,
    private readonly router: Router,
    private readonly addresses: Addresses,
    private readonly scope: Scope,
  ) {
    super();
    scope.defer(() => {
      for (const done of this.waiting.values()) for (const wake of done) wake();
      this.waiting.clear();
    });
    scope.defer(
      feed.frames((frame) => {
        if (this.scope.closed) return;
        if (frame.type === 'resync') {
          this.repo.titles.all().reset();
          const inflight = [...this.pending.keys()];
          this.pending.clear();
          this.canon += 1;
          for (const name of this.titles.keys()) this.stale.add(name);
          for (const name of [...inflight, ...this.waiting.keys()]) this.ask(name);
          return;
        }
        for (const row of frame.blocks) {
          const known = this.titles.get(row.name);
          if (known === undefined) {
            if (this.pending.has(row.name)) void this.refresh(row.name);
            continue;
          }
          if (known !== null && 'error' in known) continue;
          const branch = known === null || known.branch === undefined ? this.aim.branch : known.branch;
          if (known !== null && (known.projectId !== this.aim.projectId || branch !== this.aim.branch)) continue;
          this.pending.delete(row.name);
          this.settle(
            row.name,
            row.deletedAt === null ? { title: row.title, projectId: this.aim.projectId, branch: this.aim.branch } : null,
          );
        }
      }),
    );
  }

  readonly peer = (name: string): BlockRefPeer => {
    const known = this.titles.get(name);
    if (known === undefined) {
      this.ask(name);
      return undefined;
    }
    if (this.stale.has(name)) this.ask(name);
    if (known === null || 'error' in known) return known;
    const project = this.workspace.projects.find((row) => row.id === known.projectId);
    const branch = known.branch === undefined ? (known.projectId === this.aim.projectId ? this.aim.branch : null) : known.branch;
    return project === undefined ? undefined : { title: known.title, project: project.name, branch };
  };

  readonly placed = (name: string, place: BlockPlace, diff?: string): string | null | undefined =>
    placedHref(this.addresses, name, place, this.workspace.find(place.projectId), diff);

  readonly open = async (name: string, lens: BlockLens = {}): Promise<void> => {
    const from = this.router.url.href;
    const { href } = blockRefView(this.addresses, name, null, await this.located(name), lens);
    if (href !== null && this.router.url.href === from) await this.router.goto(href);
  };

  readonly copy = async (name: string): Promise<GraphAim | null> => {
    await this.located(name);
    const known = this.titles.get(name);
    if (known == null || 'error' in known) return null;
    return {
      projectId: known.projectId,
      branch: known.branch === undefined ? (known.projectId === this.aim.projectId ? this.aim.branch : null) : known.branch,
    };
  };

  get answered(): number {
    return this.titles.size;
  }

  refresh(name: string): Promise<void> {
    this.asking.delete(name);
    return this.resolve([name], true);
  }

  private located(name: string): Promise<BlockRefPeer> {
    if ((this.titles.has(name) && !this.stale.has(name)) || this.scope.closed) return Promise.resolve(this.peer(name));
    const { promise, resolve } = Promise.withResolvers<void>();
    this.waiting.set(name, [...(this.waiting.get(name) ?? []), resolve]);
    this.ask(name);
    return promise.then(() => this.peer(name));
  }

  private settle(name: string, title: Title): void {
    this.stale.delete(name);
    this.titles.set(name, title);
    const done = this.waiting.get(name);
    if (done === undefined) return;
    this.waiting.delete(name);
    for (const wake of done) wake();
  }

  private ask(name: string): void {
    if (this.scope.closed || this.asking.has(name) || this.pending.has(name)) return;
    this.asking.add(name);
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      const names = [...this.asking];
      this.asking.clear();
      void this.resolve(names);
    });
  }

  private async resolve(names: readonly string[], refresh = false): Promise<void> {
    if (this.scope.closed || names.length === 0) return;
    const canon = this.canon;
    const token = Symbol();
    for (const name of names) this.pending.set(name, token);
    const current = (name: string) => !this.scope.closed && canon === this.canon && this.pending.get(name) === token;
    try {
      const answer = await this.repo.titles.key(names).loadOrThrow(refresh ? { refresh: true } : undefined);
      if (answer === undefined || !names.some(current)) return;
      const rows = answer.titles;
      await this.workspace.projectsOf([...new Set(rows.filter((row) => current(row.name)).map((row) => row.projectId))]);
      const answered = new Map<string, Title>(
        rows.map((row) => [row.name, { title: row.title, projectId: row.projectId, branch: row.branch }]),
      );
      for (const copy of answer.unreadable) {
        const failure = { error: refusalOf(copy.error) };
        for (const name of copy.names) if (!answered.has(name)) answered.set(name, failure);
      }
      for (const name of names) if (current(name)) this.settle(name, answered.get(name) ?? null);
    } catch (cause) {
      const failure = { error: refusalOf(cause) };
      for (const name of names) if (current(name)) this.settle(name, failure);
    } finally {
      for (const name of names) if (this.pending.get(name) === token) this.pending.delete(name);
    }
  }
}
