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

type Title =
  | { identity: string; shortName: string; rowKey?: number; title: string; projectId: number; branch?: string | null }
  | BlockRefFailure
  | null;

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
  private readonly byRow = new Map<number, Set<string>>();
  private readonly byShort = new Map<string, Set<string>>();
  private readonly stale = new SvelteSet<string>();
  private readonly asking = new Set<string>();
  private readonly pending = new Map<string, symbol>();
  private readonly waiting = new Map<string, (() => void)[]>();
  private scheduled = false;
  private canon = 0;

  constructor(
    private readonly repo: BlocksRepo,
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
          this.byRow.clear();
          this.canon += 1;
          for (const name of this.titles.keys()) this.stale.add(name);
          for (const name of [...inflight, ...this.waiting.keys()]) this.ask(name);
          return;
        }
        const refresh = new Set<string>();
        for (const row of frame.blocks) {
          for (const name of this.byShort.get(row.name) ?? []) {
            const known = this.titles.get(name);
            if (known == null || 'error' in known) {
              refresh.add(name);
              continue;
            }
            const branch = known.branch === undefined ? this.aim.branch : known.branch;
            if (
              (name !== known.identity && known.identity !== row.identity) ||
              (known.identity === row.identity && (known.projectId !== this.aim.projectId || branch !== this.aim.branch))
            )
              refresh.add(name);
          }
          for (const name of new Set([row.name, row.identity, ...(this.byRow.get(row.rowKey) ?? [])])) {
            const known = this.titles.get(name);
            if (known === undefined) {
              if (this.pending.has(name)) refresh.add(name);
              continue;
            }
            if (known !== null && ('error' in known || known.identity !== row.identity)) {
              refresh.add(name);
              continue;
            }
            const branch = known === null || known.branch === undefined ? this.aim.branch : known.branch;
            if (known !== null && (known.projectId !== this.aim.projectId || branch !== this.aim.branch)) continue;
            this.pending.delete(name);
            this.settle(
              name,
              row.deletedAt === null
                ? {
                    identity: row.identity,
                    shortName: row.name,
                    rowKey: row.rowKey,
                    title: row.title,
                    projectId: this.aim.projectId,
                    branch: this.aim.branch,
                  }
                : null,
            );
          }
        }
        for (const name of refresh) void this.refresh(name);
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
    const previous = this.titles.get(name);
    if (
      previous !== undefined &&
      previous !== null &&
      !('error' in previous) &&
      title !== null &&
      !('error' in title) &&
      previous.shortName !== title.shortName
    ) {
      const names = this.byShort.get(previous.shortName);
      names?.delete(name);
      if (names?.size === 0) this.byShort.delete(previous.shortName);
    }
    if (previous !== undefined && previous !== null && !('error' in previous) && previous.rowKey !== undefined) {
      const names = this.byRow.get(previous.rowKey);
      names?.delete(name);
      if (names?.size === 0) this.byRow.delete(previous.rowKey);
    }
    if (title !== null && !('error' in title)) {
      const names = this.byShort.get(title.shortName) ?? new Set<string>();
      names.add(name);
      this.byShort.set(title.shortName, names);
    }
    if (
      title !== null &&
      !('error' in title) &&
      title.rowKey !== undefined &&
      title.projectId === this.aim.projectId &&
      (title.branch === undefined ? this.aim.branch : title.branch) === this.aim.branch
    ) {
      const names = this.byRow.get(title.rowKey) ?? new Set<string>();
      names.add(name);
      this.byRow.set(title.rowKey, names);
    }
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
        rows.map((row) => [
          row.name,
          {
            identity: row.identity,
            shortName: row.shortName,
            rowKey: row.rowKey,
            title: row.title,
            projectId: row.projectId,
            branch: row.branch,
          },
        ]),
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
