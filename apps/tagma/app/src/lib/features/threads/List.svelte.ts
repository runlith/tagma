import type { ThreadListRow, ThreadsFeedEvent } from '@tagma/server/threads/contract/wire/list';
import type { ThreadFolder } from '@tagma/server/thread-record/contract/wire/folder';
import { FolderActs } from './FolderActs.js';
import { TITLE_FAILURES } from '@tagma/server/threads/contract/wire/titles';
import { HARNESS_AGENT_ID } from '@tagma/server/threads/contract/wire/harness/names';
import type { ThreadParent, WireThread } from '@tagma/server/threads/contract/wire/snapshot';
import { Failure } from '@runlith/layer/Failure';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import { Scope } from '@runlith/layer/Scope';
import { Service } from '@runlith/layer/key';
import { ProjectRung, type ProjectAim } from '$lib/features/workspace/ProjectRung.js';
import { ThreadsRepo } from './Repo.js';
import { Live, type LiveConnection } from '$lib/wire/Live.js';
import { untrack } from 'svelte';
import { ThreadOnScreen, type ScreenThreads } from './OnScreen.svelte.js';
import { Births, type ForkSource } from './Births.svelte.js';
import { PendingArchive } from './PendingArchive.svelte.js';
import { ThreadForest, type ThreadTreeNode } from './forest.js';
import { mergeRow } from './mergeRow.js';

type Threads = ReturnType<typeof ThreadsRepo.use>;

const titleOutcome = {
  'no-topic': 'There is nothing to name this thread after yet.',
  superseded: 'The thread was renamed while the name was being written; the rename stands.',
  failed: 'The model did not answer with a usable name.',
  named: '',
} as const;

export type ThreadAct = 'archive' | 'pin' | 'rename' | 'title' | 'delete' | 'detach' | 'fork' | 'restart';

export type ThreadIdentity = {
  readonly id: string;
  readonly title: string;
  readonly parentThreadId: string | null;
  readonly parent?: ThreadParent;
  readonly detachedFrom?: ThreadParent;
  readonly bornAs: string;
};

export class ThreadList extends Service<ThreadList>()('ThreadList', { tier: 'project', eager: true }) {
  static *make() {
    return new ThreadList(
      yield* ProjectRung.Current,
      yield* ThreadsRepo,
      yield* FolderActs,
      yield* Live,
      yield* ThreadOnScreen,
      yield* Scope,
      yield* Failure,
      yield* Notices,
    );
  }

  private readonly byId = new Map<string, ThreadListRow>();
  private readonly forest = new ThreadForest();
  private readonly unborn = new Set<string>();
  private readonly homes = new Map<string, number>();
  private version = $state(0);
  private unheld = $state(0);
  private snapshot: { readonly version: number; readonly rows: readonly ThreadListRow[] } = { version: -1, rows: [] };
  tree = $state.raw<readonly ThreadTreeNode[]>([]);
  folders = $state<readonly ThreadFolder[]>([]);
  roots = $state<number | null>(null);
  refused = $state<string | null>(null);
  private feed: { unsubscribe: () => void } | null = null;
  private olderBefore = $state<string | null>(null);
  readonly births: Births;
  readonly more: number;
  private shelved = $state.raw<readonly ThreadListRow[] | null>(null);
  private shelvedTotal = $state<number | null>(null);
  private shelfReads = 0;
  private readonly pending = new PendingArchive((id) => this.byId.get(id));
  readonly archived: readonly ThreadListRow[] | null;
  readonly archivedTotal: number | null;
  private inFlight = $state<readonly string[]>([]);

  private landing: { readonly frames: Exclude<ThreadsFeedEvent, { type: 'folders' }>[]; asked: boolean } | null = null;
  private era = 0;
  private aimedFolder: string | null = null;
  private readonly seeing = new Set<string>();

  constructor(
    readonly aim: ProjectAim,
    private readonly repo: Threads,
    private readonly folderActs: FolderActs,
    private readonly live: LiveConnection,
    private readonly onScreen: ScreenThreads,
    readonly life: Scope,
    private readonly failure: Failure,
    private readonly notices: Notices,
  ) {
    super();
    this.births = new Births(
      aim.projectId,
      (threadId) => this.byId.get(threadId),
      (threadId) => {
        const folderId = this.aimedFolder;
        this.aimedFolder = null;
        if (folderId !== null) void this.folderActs.file([threadId], folderId);
      },
      (threadIds) => {
        for (const threadId of threadIds) this.draw(threadId);
        this.publish();
      },
    );
    this.more = $derived(this.olderBefore === null || this.roots === null ? 0 : Math.max(0, this.roots - (this.tree.length - this.unheld)));
    this.archived = $derived(this.pending.shelved(this.shelved));
    this.archivedTotal = $derived(this.pending.shelvedTotal(this.shelvedTotal, this.shelved, this.archived));
    this.subscribe();
    life.defer(() => {
      this.era += 1;
      this.seeing.clear();
      this.feed?.unsubscribe();
      this.feed = null;
    });
    $effect(() => {
      for (const host of this.onScreen.shown) void host.activeId;
      untrack(() => this.seeOpenOutcome());
    });
  }

  private subscribe(): void {
    this.feed = this.live.hold(
      (client) => client['threads.subscribe']({ projectId: this.aim.projectId }),
      (frame) => this.take(frame),
      (reason) => {
        if (reason.kind !== 'subscription') return;
        this.refused = reason.message;
        this.failure.report(new Error(reason.message));
      },
    );
  }

  retry(): void {
    this.feed?.unsubscribe();
    this.refused = null;
    this.subscribe();
  }

  private take(frame: ThreadsFeedEvent): void {
    if (frame.type === 'folders') {
      this.folders = frame.folders;
      return;
    }
    if (frame.type === 'list') {
      this.refused = null;
      if (frame.folders !== undefined) this.folders = frame.folders;
    }
    this.landing?.frames.push(frame);
    const moved = this.apply(frame);
    this.publish();
    if (moved) this.refreshWindow();
    this.births.land(frame.type === 'list');
    if (frame.type !== 'removed') this.seeOpenOutcome(frame.type === 'row' ? frame.row : undefined);
  }

  private held(root: ThreadListRow): boolean {
    if (root.archivedAt !== null) return false;
    if (root.activeRunId !== null || root.pinnedAt !== null || root.folderId != null) return true;
    if ((this.forest.node(root.id)?.team.pinned ?? 0) > 0) return true;
    return this.olderBefore === null || root.readerOrderAt >= this.olderBefore;
  }

  private admits(row: ThreadListRow): boolean {
    return row.parentThreadId === null && this.held(row);
  }

  private rootOf(row: ThreadListRow): ThreadListRow {
    let at = row;
    for (let hops = 0; at.parentThreadId !== null && hops <= this.byId.size; hops++) {
      const parent = this.byId.get(at.parentThreadId);
      if (parent === undefined) break;
      at = parent;
    }
    return at;
  }

  private leaves(before: ThreadListRow, row: ThreadListRow): boolean {
    if (before.parentThreadId !== row.parentThreadId) {
      return (
        before.parentThreadId === null ||
        row.parentThreadId === null ||
        !this.byId.has(before.parentThreadId) ||
        !this.byId.has(row.parentThreadId)
      );
    }
    const loosened =
      (before.activeRunId != null && row.activeRunId === null) ||
      (before.pinnedAt != null && row.pinnedAt === null) ||
      (before.folderId != null && row.folderId == null);
    return loosened && !this.held(this.rootOf(row));
  }

  private apply(frame: Exclude<ThreadsFeedEvent, { type: 'folders' }>): boolean {
    if (frame.type === 'list') {
      const listed = new Set<string>();
      for (const row of frame.rows) {
        listed.add(row.id);
        const held = this.byId.get(row.id);
        this.byId.set(row.id, held === undefined ? row : mergeRow(held, row));
        this.draw(row.id);
      }
      for (const id of [...this.byId.keys()]) {
        if (listed.has(id)) continue;
        this.byId.delete(id);
        this.draw(id);
        this.pending.gone(id);
      }
      this.roots = frame.roots;
      this.olderBefore = frame.windowBefore;
      return false;
    }
    if (frame.type === 'removed') {
      this.byId.delete(frame.threadId);
      this.draw(frame.threadId);
      this.births.forget(frame.threadId);
      this.pending.gone(frame.threadId);
      return true;
    }
    const before = this.byId.get(frame.row.id);
    if (before === undefined) {
      const parent = frame.row.parentThreadId;
      const family = parent !== null && this.byId.has(parent);
      if (family || this.admits(frame.row)) {
        this.byId.set(frame.row.id, frame.row);
        this.draw(frame.row.id);
      }
      return !family;
    }
    this.upsert(frame.row);
    return this.leaves(before, frame.row);
  }

  private upsert(row: ThreadListRow): void {
    const held = this.byId.get(row.id);
    if (held === undefined) return;
    const merged = mergeRow(held, row);
    if (merged === held) return;
    this.byId.set(merged.id, merged);
    this.draw(merged.id);
    this.publish();
  }

  private draw(id: string): void {
    const base = this.byId.get(id);
    if (base !== undefined && base.projectId !== this.aim.projectId) this.homes.set(id, base.projectId);
    const row = this.pending.hides(id, base) ? undefined : this.births.draw(id, base);
    if (row === undefined) {
      this.forest.remove(id);
      this.unborn.delete(id);
      return;
    }
    this.forest.put(row);
    if (base === undefined) this.unborn.add(id);
    else this.unborn.delete(id);
  }

  private publish(): void {
    this.tree = this.forest.roots;
    this.version = this.forest.revision;
    this.unheld = this.unborn.size;
  }

  get threads(): readonly ThreadListRow[] {
    void this.version;
    if (this.snapshot.version !== this.forest.revision) {
      this.snapshot = { version: this.forest.revision, rows: this.forest.rows().filter((row) => !this.unborn.has(row.id)) };
    }
    return this.snapshot.rows;
  }

  get size(): number {
    void this.version;
    return this.forest.size;
  }

  row(id: string): ThreadListRow | undefined {
    void this.version;
    return this.forest.row(id);
  }

  harnessRow(id: string | null): ThreadListRow | null {
    const row = id === null ? undefined : this.row(id);
    return row?.agentId === HARNESS_AGENT_ID ? row : null;
  }

  identityOf(id: string | null, shown: WireThread | null): ThreadIdentity | null {
    const recorded = shown?.parent;
    const parent = recorded === undefined ? undefined : { ...recorded, title: this.row(recorded.id)?.title ?? recorded.title };
    const former = shown?.detachedFrom;
    const detachedFrom = former === undefined ? undefined : { ...former, title: this.row(former.id)?.title ?? former.title };
    const row = this.harnessRow(id);
    if (row !== null) {
      return {
        id: row.id,
        title: row.title,
        parentThreadId: row.parentThreadId,
        ...(parent === undefined ? {} : { parent }),
        ...(detachedFrom === undefined ? {} : { detachedFrom }),
        bornAs: row.profileId ?? row.agentId,
      };
    }
    if (shown === null) return null;
    return {
      id: shown.id,
      title: shown.title,
      parentThreadId: shown.parentThreadId,
      ...(parent === undefined ? {} : { parent }),
      ...(detachedFrom === undefined ? {} : { detachedFrom }),
      bornAs: shown.profile?.id ?? shown.agentId,
    };
  }

  node(id: string): ThreadTreeNode | undefined {
    void this.version;
    return this.forest.node(id);
  }

  homeOf(id: string): number {
    return (
      this.byId.get(id)?.projectId ?? this.homes.get(id) ?? this.shelved?.find((row) => row.id === id)?.projectId ?? this.aim.projectId
    );
  }

  private refreshWindow(): void {
    if (this.landing !== null) {
      this.landing.asked = true;
      return;
    }
    const era = this.era;
    const landing = { frames: [] as Exclude<ThreadsFeedEvent, { type: 'folders' }>[], asked: false };
    this.landing = landing;
    void this.repo.roots
      .key({ projectId: this.aim.projectId })
      .refresh({ throwOnError: true })
      .then(
        (window) => {
          if (era !== this.era) return;
          this.landing = null;
          if (window === undefined) {
            if (landing.asked) this.refreshWindow();
            return;
          }
          this.apply({ type: 'list', ...window });
          let moved = false;
          for (const frame of landing.frames) moved = this.apply(frame) || moved;
          this.publish();
          this.births.land(true);
          this.seeOpenOutcome();
          if (moved) this.refreshWindow();
        },
        (error: unknown) => {
          if (era !== this.era) return;
          this.landing = null;
          this.failure.report(error);
          if (landing.asked) this.refreshWindow();
        },
      );
  }

  async readMore(): Promise<void> {
    const before = this.olderBefore;
    if (before === null || this.more === 0) return;
    const era = this.era;
    try {
      const page = await this.repo.roots.key({ projectId: this.aim.projectId, readerBefore: before }).refresh({ throwOnError: true });
      if (era !== this.era || page === undefined) return;
      const fresh = page.rows.filter((row) => !this.byId.has(row.id) && !this.pending.hides(row.id, row));
      for (const row of fresh) {
        this.byId.set(row.id, row);
        this.draw(row.id);
      }
      this.publish();
      this.roots = page.roots;
      this.olderBefore = page.windowBefore;
    } catch (error) {
      if (era === this.era) this.failure.report(error);
    }
  }

  async readArchived(): Promise<void> {
    const era = this.era;
    const asked = ++this.shelfReads;
    try {
      const answer = await this.repo.archived.key(this.aim.projectId).refresh({ throwOnError: true });
      if (era !== this.era || asked !== this.shelfReads || answer === undefined) return;
      if (answer.status !== 'rows') throw new Error('archived threads answered without rows');
      this.shelved = answer.rows;
      this.shelvedTotal = answer.total;
    } catch (error) {
      if (era === this.era) this.failure.report(error);
    }
  }

  busy(id: string, act: ThreadAct): boolean {
    return this.inFlight.includes(`${act}:${id}`);
  }

  private hold(id: string, act: ThreadAct): boolean {
    const key = `${act}:${id}`;
    if (this.inFlight.includes(key)) return false;
    this.inFlight = [...this.inFlight, key];
    return true;
  }

  private free(id: string, act: ThreadAct): void {
    const key = `${act}:${id}`;
    this.inFlight = this.inFlight.filter((held) => held !== key);
  }

  async rename(id: string, title: string): Promise<boolean> {
    const trimmed = title.replace(/\s+/g, ' ').trim();
    if (!trimmed || !this.hold(id, 'rename')) return false;
    const era = this.era;
    try {
      await this.repo.setTitle.run({ id, projectId: this.homeOf(id), title: trimmed }, { throwOnError: true });
      return true;
    } catch (error) {
      if (era === this.era) this.notices.refusal(error);
      return false;
    } finally {
      this.free(id, 'rename');
    }
  }

  async generateTitle(id: string): Promise<void> {
    if (!this.hold(id, 'title')) return;
    const era = this.era;
    try {
      const result = await this.repo.generateTitle.run({ id, projectId: this.homeOf(id) }, { throwOnError: true });
      if (era !== this.era || result === undefined || result.outcome === 'named') return;
      this.notices.error('Couldn’t generate a title', result.reason ? TITLE_FAILURES[result.reason] : titleOutcome[result.outcome]);
    } catch (error) {
      if (era === this.era) this.notices.refusal(error);
    } finally {
      this.free(id, 'title');
    }
  }

  async setArchived(id: string, archived: boolean): Promise<boolean> {
    if (!this.hold(id, 'archive')) return false;
    const era = this.era;
    const projectId = this.homeOf(id);
    if (archived) this.leave(id);
    else this.pending.wake(id);
    try {
      await this.repo.setArchived.run({ id, projectId, archived }, { throwOnError: true });
      if (era !== this.era) return true;
      this.settle(id, archived);
      return true;
    } catch (error) {
      if (era === this.era) {
        if (archived) this.restore(id);
        else this.pending.woke(id);
        this.notices.refusal(error);
      }
      return false;
    } finally {
      this.free(id, 'archive');
    }
  }

  private leave(id: string): void {
    const ids = this.subtreeIds(id);
    const open = this.onScreen.shown.filter((host) => host.activeId !== null && this.holdsUnder(host.activeId, id));
    this.pending.leave(id, ids);
    for (let at = ids.length - 1; at >= 0; at--) this.draw(ids[at] as string);
    this.publish();
    for (const host of open) host.startDraft();
  }

  private restore(id: string): void {
    this.pending.cancel(id);
    for (const held of this.byId.keys()) if (!this.forest.has(held)) this.draw(held);
    this.publish();
  }

  private settle(id: string, archived: boolean): void {
    if (archived) this.pending.confirm();
    else {
      this.restore(id);
      const rest = this.pending.settled(id, this.shelved, this.shelvedTotal);
      this.shelved = rest.rows;
      this.shelvedTotal = rest.total;
      this.pending.woke(id);
    }
    if (this.shelved !== null) void this.readArchived();
  }

  private subtreeIds(id: string): readonly string[] {
    const ids: string[] = [];
    const stack = [id];
    for (let at = stack.pop(); at !== undefined; at = stack.pop()) {
      ids.push(at);
      for (const child of this.forest.node(at)?.children ?? []) stack.push(child.row.id);
    }
    return ids;
  }

  async fork(source: ForkSource): Promise<string | null> {
    if (!this.hold(source.id, 'fork')) return null;
    const era = this.era;
    try {
      const answer = await this.births.fork(
        source,
        async () =>
          (await this.repo.branch.run({ id: source.id, projectId: source.projectId, key: crypto.randomUUID() }, { throwOnError: true })) ??
          null,
      );
      return era === this.era ? (answer?.threadId ?? null) : null;
    } catch (error) {
      if (era === this.era) this.notices.refusal(error);
      return null;
    } finally {
      this.free(source.id, 'fork');
    }
  }

  async restart(id: string): Promise<void> {
    if (!this.hold(id, 'restart')) return;
    const era = this.era;
    try {
      await this.repo.restart.run({ id, projectId: this.homeOf(id) }, { throwOnError: true });
    } catch (error) {
      if (era === this.era) this.notices.refusal(error);
    } finally {
      this.free(id, 'restart');
    }
  }

  async setPinned(id: string, pinned: boolean): Promise<void> {
    if (!this.hold(id, 'pin')) return;
    const era = this.era;
    try {
      await this.repo.setPinned.run({ id, projectId: this.homeOf(id), pinned }, { throwOnError: true });
    } catch (error) {
      if (era === this.era) this.notices.refusal(error);
    } finally {
      this.free(id, 'pin');
    }
  }

  async detach(id: string, detached: boolean): Promise<{ readonly members: number } | null> {
    if (!this.hold(id, 'detach')) return null;
    const era = this.era;
    try {
      const answer = await this.repo.detach.run({ id, projectId: this.homeOf(id), detached }, { throwOnError: true });
      if (era !== this.era || answer === undefined) return null;
      return { members: answer.status === 'detached' ? answer.members : 0 };
    } catch (error) {
      if (era === this.era) this.notices.refusal(error);
      return null;
    } finally {
      this.free(id, 'detach');
    }
  }

  aimBirth(folderId: string | null): void {
    this.aimedFolder = folderId;
  }

  labelOf(id: string): string | null {
    const row = this.row(id);
    if (row === undefined) return null;
    return row.parentThreadId === null ? row.title.trim() || 'Untitled' : (row.name ?? row.agentId);
  }

  async remove(id: string): Promise<boolean> {
    if (!this.hold(id, 'delete')) return false;
    const era = this.era;
    try {
      const removed = await this.repo.remove.run({ id, projectId: this.homeOf(id) }, { throwOnError: true });
      return removed?.status === 'deleted';
    } catch (error) {
      if (era === this.era) this.notices.refusal(error);
      return false;
    } finally {
      this.free(id, 'delete');
    }
  }

  holdsUnder(threadId: string, rootId: string): boolean {
    let cursor: string | null = threadId;
    for (let hops = 0; cursor !== null && hops <= this.forest.size; hops++) {
      if (cursor === rootId) return true;
      cursor = this.forest.row(cursor)?.parentThreadId ?? null;
    }
    return false;
  }

  private seeOpenOutcome(candidate?: ThreadListRow): void {
    for (const host of this.onScreen.shown) {
      if (host.activeId !== null) this.seeOutcome(host.activeId, candidate);
    }
  }

  private seeOutcome(openId: string, candidate?: ThreadListRow): void {
    const row = candidate?.id === openId ? candidate : this.byId.get(openId);
    const outcome = row?.outcome;
    if (row === undefined || outcome == null || outcome.isSeen) return;
    const key = `${row.id}:${outcome.runId}`;
    if (this.seeing.has(key)) return;
    const era = this.era;
    this.seeing.add(key);
    void this.repo.see
      .run({ id: row.id, projectId: row.projectId, runId: outcome.runId }, { throwOnError: true })
      .then((seen) => {
        if (era !== this.era || seen === undefined) return;
        this.upsert(seen);
        this.seeOpenOutcome(seen);
      })
      .catch((error: unknown) => {
        if (era === this.era) console.error('[tagma] thread outcome receipt failed', { threadId: row.id }, error);
      })
      .finally(() => this.seeing.delete(key));
  }
}
