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

type Blocks = ReturnType<typeof BlocksRepo.use>;
type Journal = ReturnType<typeof JournalRepo.use>;
type Sessions = ReturnType<typeof SessionsRepo.use>;

type Pair = { readonly fromName: string; readonly toName: string };

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
    private readonly blocks: Blocks,
    private readonly journal: Journal,
    private readonly sessions: Sessions,
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
      void this.tags.retry();
      void Cache.invalidate(this.cache, this.scope);
    } else this.apply(frame);
    this.emitter.emit(frame);
  }

  private apply(change: GraphChange): void {
    const names = new Set(change.blocks.map((row) => row.name));
    const near = new Set(names);
    for (const row of change.blocks) if (row.parentName !== null) near.add(row.parentName);
    for (const pair of [...change.edges, ...change.refs]) near.add(pair.fromName).add(pair.toName);
    patch(this.blocks.edges, names, change.edges, near);
    patch(this.blocks.refs, names, change.refs, near);
    void this.blocks.tree.invalidate();
    void this.blocks.block.where((key) => key.depth > 0 || near.has(key.name)).invalidate();
    void this.blocks.titles.where((key) => key.some((name) => names.has(name))).invalidate();
    void this.blocks.diff.where((key) => key.to === undefined && names.has(key.name)).invalidate();
    void this.journal.batches.where((key) => key.before === undefined).invalidate();
    void this.journal.vocabulary.all().invalidate();
    if (change.sessions.length > 0) void this.sessions.list.invalidate();
  }
}

function patch<T extends Pair>(query: SingleQuery<readonly T[]>, names: ReadonlySet<string>, fresh: readonly T[], near: Set<string>): void {
  if (query.watchFetching()) {
    void query.invalidate();
    return;
  }
  query.setCache((held) => {
    if (held === undefined) return undefined;
    const kept = held.filter((pair) => {
      const touched = names.has(pair.fromName) || names.has(pair.toName);
      if (touched) near.add(pair.fromName).add(pair.toName);
      return !touched;
    });
    return kept.length === held.length && fresh.length === 0 ? held : [...kept, ...fresh];
  });
}
