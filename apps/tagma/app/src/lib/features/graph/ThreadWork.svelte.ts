import { untrack } from 'svelte';
import { Scope } from '@runlith/layer/Scope';
import { Service } from '@runlith/layer/key';
import { type ThreadWork as Work, type WorkCopy, workStart } from '@tagma/server/graph/contract/wire/threadWork';
import type { TreeBlock } from '@tagma/server/graph/contract/wire/rows';
import type { TagCatalog } from './TagCatalog.svelte.js';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import { ShellOps, shellActs, type ShellActs, type ShellPort } from '$lib/features/workspace/ShellOps.js';
import type { GraphAim } from '$lib/features/workspace/GraphRung.js';
import type { threadWorkFrameSchema } from '@tagma/server/graph/contract/wire/feed';
import { Live, type LiveConnection } from '$lib/wire/Live.js';
import { ThreadWorkRepo, type WorkStart } from './ThreadWorkRepo.js';

export const START_WORDS = 'Start agent on this';

export const startable = (tags: TagCatalog, row: TreeBlock): boolean => workStart(tags.table, row) !== null;

type Shown = () => Work | undefined;

type Watch = { readonly current: Shown };

type Feed = { readonly watches: Set<Watch>; readonly held: { readonly unsubscribe: () => void } };

type WorkFrame = typeof threadWorkFrameSchema.Type;

const copyKey = (copy: WorkCopy): string => `${copy.projectId}:${copy.branch ?? ''}`;

export const aimOf = (work: Work, copy: number): GraphAim | undefined => {
  const found = work.copies[copy];
  return found === undefined ? undefined : { projectId: found.projectId, branch: found.branch };
};

function touches(frame: WorkFrame, watches: ReadonlySet<Watch>): boolean {
  if (frame.type === 'resync' || frame.own) return true;
  const names = new Set<string>();
  for (const watch of watches) {
    const shown = watch.current();
    if (shown === undefined) continue;
    for (const row of shown.works) {
      names.add(row.name);
      if (row.spec !== null) names.add(row.spec.name);
    }
    for (const row of shown.did) names.add(row.name);
  }
  return frame.names.some((name) => names.has(name));
}

export class ThreadWork extends Service<ThreadWork>()('ThreadWork', { tier: 'app' }) {
  static *make() {
    const scope = yield* Scope;
    return new ThreadWork(yield* ThreadWorkRepo, yield* Live, yield* Notices, yield* ShellOps, scope);
  }

  private readonly feeds = new Map<string, Feed>();
  private readonly runs = new Map<string, string | null>();
  private readonly shell: ShellActs;

  constructor(
    private readonly repo: ThreadWorkRepo,
    private readonly live: LiveConnection,
    private readonly notices: Notices,
    ops: ShellPort,
    scope: Scope,
  ) {
    super();
    this.shell = shellActs(ops, notices);
    scope.defer(() => {
      for (const feed of this.feeds.values()) feed.held.unsubscribe();
      this.feeds.clear();
    });
  }

  of(projectId: number, threadId: string, cursor: string | null = null) {
    return this.repo.work.key({ projectId, threadId, cursor });
  }

  keep(project: () => number, thread: () => string, read: Shown, run: () => string | null): void {
    const followed = $derived(read()?.copies.map(copyKey).join('|'));
    $effect(() => {
      const projectId = project();
      const threadId = thread();
      if (followed === undefined) return;
      return untrack(() => this.follow(projectId, threadId, read()?.copies ?? [], read));
    });
    $effect(() => {
      const projectId = project();
      const threadId = thread();
      const now = run();
      untrack(() => this.ran(projectId, threadId, now));
    });
  }

  follow(projectId: number, threadId: string, copies: readonly WorkCopy[], current: Shown): () => void {
    const key = `${projectId}|${threadId}|${copies.map(copyKey).join('|')}`;
    const feed = this.feeds.get(key) ?? this.open(key, projectId, threadId);
    const watch: Watch = { current };
    feed.watches.add(watch);
    return () => {
      feed.watches.delete(watch);
      if (feed.watches.size > 0 || this.feeds.get(key) !== feed) return;
      feed.held.unsubscribe();
      this.feeds.delete(key);
    };
  }

  async start(work: WorkStart): Promise<void> {
    try {
      const threadId = await this.repo.start.run(work, { throwOnError: true });
      if (threadId !== undefined) await this.shell.openThread({ projectId: work.copy.projectId, threadId }, 'beside');
    } catch (error) {
      this.notices.refusal(error);
    }
  }

  private ran(projectId: number, threadId: string, run: string | null): void {
    const key = `${projectId}|${threadId}`;
    const seen = this.runs.get(key);
    this.runs.set(key, run);
    if (seen !== undefined && seen !== run) this.reread(projectId, threadId);
  }

  private reread(projectId: number, threadId: string): void {
    void this.repo.work.where((asked) => asked.projectId === projectId && asked.threadId === threadId).invalidate();
  }

  private open(key: string, projectId: number, threadId: string): Feed {
    const watches = new Set<Watch>();
    const held = this.live.hold(
      (client) => client['graph.work']({ projectId, threadId }),
      (frame) => {
        if (touches(frame, watches)) this.reread(projectId, threadId);
      },
      (failure) => {
        if (failure.kind !== 'subscription') return;
        this.notices.background(new Error(failure.message));
        this.reread(projectId, threadId);
      },
    );
    const feed = { watches, held };
    this.feeds.set(key, feed);
    return feed;
  }
}
