import { Failure } from '@runlith/layer/Failure';
import { Scope } from '@runlith/layer/Scope';
import { Service } from '@runlith/layer/key';
import { Cache } from '@runlith/query/repo';
import type { SingleQuery } from '@runlith/query/types';
import type { QueryClient } from '@tanstack/query-core';
import { createEventEmitter, type EventEmitter } from '@runlith/utils/event';
import { GraphRung } from '$lib/features/workspace/GraphRung.js';
import { Live, type GraphChange, type GraphFrame, type LiveConnection } from '$lib/wire/Live.js';
import { BlocksRepo } from './BlocksRepo.js';
import { JournalRepo } from './JournalRepo.js';
import { SessionsRepo } from './SessionsRepo.js';
import { TagCatalog } from './TagCatalog.svelte.js';

type Pair = {
  readonly fromName: string;
  readonly toName: string;
  readonly fromIdentity: string | null;
  readonly toIdentity: string | null;
  readonly fromRowKey: number | null;
  readonly toRowKey: number | null;
};

export class GraphFeed extends Service<GraphFeed>()('GraphFeed', { tier: 'graph', eager: true }) {
  static *make() {
    const scope = yield* Scope;
    return new GraphFeed(
      yield* Live,
      yield* GraphRung.Current,
      yield* TagCatalog,
      yield* BlocksRepo,
      yield* JournalRepo,
      yield* SessionsRepo,
      yield* Cache,
      scope,
      yield* Failure,
    );
  }

  private readonly emitter: EventEmitter<[GraphFrame]>;
  constructor(
    live: LiveConnection,
    private readonly aim: { readonly projectId: number; readonly branch: string | null },
    private readonly tags: TagCatalog,
    private readonly blocks: BlocksRepo,
    private readonly journal: JournalRepo,
    private readonly sessions: SessionsRepo,
    private readonly cache: QueryClient,
    private readonly scope: Scope,
    failure: Failure,
  ) {
    super();
    this.emitter = createEventEmitter<[GraphFrame]>((error) => failure.report(error));
    const held = live.hold(
      (client) =>
        client['graph.subscribe']({
          projectId: aim.projectId,
          branch: aim.branch ?? undefined,
        }),
      (frame) => this.take(frame),
      (reason) => {
        if (reason.kind === 'subscription') failure.report(new Error(reason.message));
      },
    );
    scope.defer(() => held.unsubscribe());
  }

  frames(listener: (frame: GraphFrame) => void): () => void {
    return this.emitter.subscribe(listener);
  }

  private take(frame: GraphFrame): void {
    if (frame.type === 'resync') {
      this.blocks.edges.reset();
      this.blocks.refs.reset();
      void this.tags.retry();
      void Cache.invalidate(this.cache, this.scope);
    } else this.apply(frame);
    this.emitter.emit(frame);
  }

  private apply(change: GraphChange): void {
    const names = new Set(change.blocks.map((row) => row.name));
    const identities = new Set(change.blocks.map((row) => row.identity));
    const rowKeys = new Set(change.blocks.map((row) => row.rowKey));
    const near = new Set([...names, ...identities]);
    for (const row of change.blocks) {
      if (row.parentName !== null) near.add(row.parentName);
      if (row.parentIdentity !== null) near.add(row.parentIdentity);
    }
    for (const pair of [...change.edges, ...change.refs]) {
      near.add(pair.fromName).add(pair.toName);
      if (pair.fromIdentity !== null) near.add(pair.fromIdentity);
      if (pair.toIdentity !== null) near.add(pair.toIdentity);
    }
    patch(this.blocks.edges, rowKeys, change.edges, near);
    patch(this.blocks.refs, rowKeys, change.refs, near);
    void this.blocks.tree.invalidate();
    void this.blocks.block.where((key) => key.depth > 0 || near.has(key.name)).invalidate();
    void this.blocks.titles.where((key) => key.some((name) => names.has(name) || identities.has(name))).invalidate();
    void this.blocks.diff.where((key) => key.to === undefined && (names.has(key.name) || identities.has(key.name))).invalidate();
    void this.journal.batches.where((key) => key.before === undefined).invalidate();
    void this.journal.vocabulary.all().invalidate();
    if (change.sessions.length > 0) void this.sessions.list.invalidate();
  }
}

function patch<T extends Pair>(
  query: SingleQuery<readonly T[]>,
  rowKeys: ReadonlySet<number>,
  fresh: readonly T[],
  near: Set<string>,
): void {
  if (query.watchFetching()) {
    void query.invalidate();
    return;
  }
  query.setCache((held) => {
    if (held === undefined) return undefined;
    const kept = held.filter((pair) => {
      const touched = (pair.fromRowKey !== null && rowKeys.has(pair.fromRowKey)) || (pair.toRowKey !== null && rowKeys.has(pair.toRowKey));
      if (touched) {
        near.add(pair.fromName).add(pair.toName);
        if (pair.fromIdentity !== null) near.add(pair.fromIdentity);
        if (pair.toIdentity !== null) near.add(pair.toIdentity);
      }
      return !touched;
    });
    return kept.length === held.length && fresh.length === 0 ? held : [...kept, ...fresh];
  });
}
