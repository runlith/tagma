import type { WorktreeMode } from '@tagma/server/worktrees/contract/wire/creation';
import type { WorktreeActivity, WorktreeFeedEvent, WorktreePlace } from '@tagma/server/worktrees/contract/wire/rows';
import { Failure } from '@runlith/layer/Failure';
import { Router } from '@runlith/layer/Router';
import { Scope } from '@runlith/layer/Scope';
import { Service } from '@runlith/layer/key';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import { ProjectFocus } from '$lib/features/workspace/Focus.svelte.js';
import { ProjectRung, type ProjectAim } from '$lib/features/workspace/ProjectRung.js';
import { refusalOf } from '$lib/wire/refusal.js';
import { Live, type LiveConnection } from '$lib/wire/Live.js';
import { WorktreesRepo } from './Repo.js';
import { WorktreeWindow } from './Window.svelte.js';

type Repo = ReturnType<typeof WorktreesRepo.use>;

export type WorktreeCreation = {
  readonly id: string;
  readonly label: string;
  readonly phase: 'preparing' | 'checkout' | 'failed';
  readonly problem: string | null;
  readonly retry: (() => void) | null;
  readonly rootId: string | null;
  readonly threadId: string | null;
  readonly threadName: string | null;
};

export type BornThread = { readonly id: string; readonly name: string | null };

export type RecordedPlace = { readonly rootId: string; readonly branch: string | null };

export type ThreadStanding =
  | { readonly kind: 'row'; readonly row: WorktreePlace }
  | { readonly kind: 'creating'; readonly creation: WorktreeCreation }
  | { readonly kind: 'deleted'; readonly rootId: string; readonly branch: string | null }
  | { readonly kind: 'nowhere' };

export class Worktrees extends Service<Worktrees>()('Worktrees', { tier: 'project' }) {
  static *make() {
    return new Worktrees(
      yield* ProjectRung.Current,
      yield* Live,
      yield* Router,
      yield* ProjectFocus,
      yield* WorktreesRepo,
      yield* Notices,
      yield* Scope,
      yield* Failure,
    );
  }

  rows = $state.raw<readonly WorktreePlace[]>([]);
  elsewhere = $state.raw<ReadonlySet<string>>(new Set());
  private elsewhereRoots = $state.raw<ReadonlyMap<string, string | null>>(new Map());
  known = $state(false);
  unread = $state<string | null>(null);
  creations = $state.raw<readonly WorktreeCreation[]>([]);
  moving = $state.raw<readonly string[]>([]);
  creating = $state(false);
  acts = $state.raw<ReadonlyMap<string, WorktreeActivity>>(new Map());
  readonly settledAt = new Map<string, number>();
  readonly seen = new Map<string, { readonly rootId: string; readonly label: string; readonly hue: number | null }>();

  private readonly byId = $derived<ReadonlyMap<string, WorktreePlace>>(new Map(this.rows.map((row) => [row.rootId, row])));
  readonly main = $derived(this.rows.find((row) => row.kind === 'main') ?? null);
  readonly grouped = $derived(this.rows.filter((row) => row.kind !== 'external' || row.agents.standing > 0));
  readonly several = $derived(this.grouped.length > 1 || this.creations.length > 0);
  readonly aimed = $derived.by<WorktreePlace | null>(() => {
    if (!this.focus.current) return null;
    const branch = this.router.url.searchParams.get('branch');
    if (branch === null) return this.main;
    return this.rows.find((row) => row.branch === branch) ?? null;
  });
  readonly stray = $derived.by<boolean>(() => {
    if (!this.known || !this.focus.current) return false;
    const branch = this.router.url.searchParams.get('branch');
    if (branch === null || this.rows.some((row) => row.branch === branch)) return false;
    return !this.creations.some((creation) => creation.label === branch && creation.phase !== 'failed');
  });

  private readonly standing = $derived.by(() => {
    const places = new Map<string, WorktreePlace>();
    for (const row of this.rows) {
      if (row.kind === 'main') continue;
      for (const threadId of row.threads) places.set(threadId, row);
    }
    return places;
  });

  constructor(
    readonly aim: ProjectAim,
    private readonly live: LiveConnection,
    private readonly router: Router,
    private readonly focus: ProjectFocus,
    private readonly repo: Repo,
    private readonly notices: Notices,
    private readonly scope: Scope,
    private readonly failure: Failure,
  ) {
    super();
    const held = live.hold(
      (client) => client['worktrees.subscribe']({ projectId: aim.projectId, start: 0, limit: 0, places: true }),
      (frame) => this.take(frame),
      (reason) => {
        if (reason.kind !== 'subscription') return;
        if (reason.code === undefined) failure.report(new Error(reason.message));
        this.unread =
          reason.code === undefined
            ? reason.message
            : refusalOf({ code: reason.code, reason: reason.message, unblock: reason.unblock ?? [] }).reason;
      },
    );
    scope.defer(() => held.unsubscribe());
  }

  placeOf(threadId: string): WorktreePlace | null {
    const row = this.standing.get(threadId);
    if (row !== undefined) return row;
    if (this.creatingOf(threadId) !== null) return null;
    return this.elsewhere.has(threadId) ? null : this.main;
  }

  standingOf(threadId: string, recorded: RecordedPlace | null = null): ThreadStanding | null {
    if (!this.known) return null;
    const row = this.standing.get(threadId);
    if (row !== undefined) return { kind: 'row', row };
    const creation = this.creatingOf(threadId);
    if (creation !== null) return { kind: 'creating', creation };
    const branchOf = (rootId: string): string | null => (recorded?.rootId === rootId ? recorded.branch : null);
    if (this.elsewhere.has(threadId)) {
      const rootId = this.elsewhereRoots.get(threadId) ?? null;
      return rootId === null ? { kind: 'nowhere' } : { kind: 'deleted', rootId, branch: branchOf(rootId) };
    }
    if (recorded !== null && this.byRoot(recorded.rootId) === null) {
      return { kind: 'deleted', rootId: recorded.rootId, branch: recorded.branch };
    }
    return this.main === null ? { kind: 'nowhere' } : { kind: 'row', row: this.main };
  }

  creatingOf(thread: string | BornThread): WorktreeCreation | null {
    const id = typeof thread === 'string' ? thread : thread.id;
    const name = typeof thread === 'string' ? null : thread.name;
    if (this.standing.has(id)) return null;
    return (
      this.creations.find(
        (creation) => creation.threadId === id || (creation.threadId === null && name !== null && creation.threadName === name),
      ) ?? null
    );
  }

  window(): WorktreeWindow {
    return new WorktreeWindow(this, this.live, this.failure);
  }

  folderOf(row: WorktreePlace | null): string | null {
    return row === null || row.missing ? null : row.folder;
  }

  byRoot(rootId: string): WorktreePlace | null {
    return this.byId.get(rootId) ?? null;
  }

  holding(path: string): WorktreePlace | null {
    let found: WorktreePlace | null = null;
    for (const row of this.rows) {
      const inside = path === row.folder || path.startsWith(`${row.folder}/`);
      if (inside && (found === null || row.folder.length > found.folder.length)) found = row;
    }
    return found;
  }

  async move(threadId: string, rootId: string) {
    if (this.moving.includes(threadId)) return null;
    this.moving = [...this.moving, threadId];
    try {
      const answer = await this.repo.move.run({ projectId: this.aim.projectId, threadId, worktree: rootId }, { throwOnError: true });
      if (answer === undefined || this.scope.signal.aborted) return null;
      if (answer.status === 'failed') this.notices.error('Move', answer.detail);
      return answer;
    } catch (error) {
      if (!this.scope.signal.aborted) this.notices.refusal(error);
      return null;
    } finally {
      this.moving = this.moving.filter((id) => id !== threadId);
    }
  }

  async create(branch: string, start: string): Promise<string | null> {
    return await this.made(branch, { kind: 'new-branch', branch, start });
  }

  async checkout(branch: string): Promise<string | null> {
    return await this.made(branch, { kind: 'existing-branch', branch });
  }

  async placing<T>(
    label: string,
    work: () => Promise<T>,
    threadOf: (answer: T) => string,
    retry: () => void,
    threadName: string | null = null,
  ): Promise<T> {
    const id = crypto.randomUUID();
    this.track({ id, label, phase: 'checkout', problem: null, retry: null, rootId: null, threadId: null, threadName });
    try {
      const answer = await work();
      this.settle(id, { threadId: threadOf(answer) });
      return answer;
    } catch (error) {
      this.settle(id, {
        phase: 'failed',
        problem: refusalOf(error).reason,
        retry: () => {
          this.dismiss(id);
          retry();
        },
      });
      throw error;
    }
  }

  dismiss(id: string): void {
    this.creations = this.creations.filter((creation) => creation.id !== id);
  }

  private async made(label: string, mode: WorktreeMode, operationId?: string): Promise<string | null> {
    const id = operationId ?? `worktree-${crypto.randomUUID()}`;
    const projectId = this.aim.projectId;
    if (this.creations.some((creation) => creation.id === id)) this.settle(id, { phase: 'preparing', problem: null, retry: null });
    else this.track({ id, label, phase: 'preparing', problem: null, retry: null, rootId: null, threadId: null, threadName: null });
    const failed = (problem: string, again: 'same' | 'fresh' | 'none'): null => {
      this.settle(id, {
        phase: 'failed',
        problem,
        retry:
          again === 'none'
            ? null
            : () => {
                if (again === 'fresh') this.dismiss(id);
                void this.made(label, mode, again === 'same' ? id : undefined);
              },
      });
      return null;
    };
    try {
      const listing = await this.repo.stores.run(
        { projectId, path: this.main === null ? undefined : this.main.folder },
        { throwOnError: true },
      );
      const store = listing?.repositories[0];
      if (store === undefined) return failed('This project covers no repository a worktree can be cut from.', 'fresh');
      await this.repo.prepare.run({ projectId, operationId: id, repository: store.binding, mode }, { throwOnError: true });
      this.settle(id, { phase: 'checkout' });
      const operation = await this.repo.create.run({ projectId, operationId: id }, { throwOnError: true });
      if (operation === undefined) return null;
      const said = operation.evidence === null ? '' : `: ${operation.evidence.message}`;
      if (operation.status === 'failed') return failed(`git refused${said}`, 'fresh');
      if (operation.status === 'uncertain') {
        return failed(
          `git's outcome is uncertain${said}. The folder and the branch stay held until operation ${id} is recovered (prepare_worktree_recovery, then adopt_worktree) or released (abandon_worktree).`,
          'none',
        );
      }
      if (operation.rootId === null) return failed(`The creation stands ${operation.status}.`, 'same');
      this.settle(id, { rootId: operation.rootId });
      return operation.rootId;
    } catch (error) {
      return this.scope.signal.aborted ? null : failed(refusalOf(error).reason, 'same');
    }
  }

  private track(creation: WorktreeCreation): void {
    this.creations = [...this.creations, creation];
  }

  private settle(id: string, change: Partial<WorktreeCreation>): void {
    this.creations = this.landed(this.creations.map((creation) => (creation.id === id ? { ...creation, ...change } : creation)));
  }

  private landed(creations: readonly WorktreeCreation[]): readonly WorktreeCreation[] {
    return creations.filter((creation) => {
      if (creation.rootId !== null) return !this.rows.some((row) => row.rootId === creation.rootId);
      if (creation.threadId !== null) return !this.standing.has(creation.threadId);
      return true;
    });
  }

  private take(frame: WorktreeFeedEvent): void {
    if (frame.kind === 'acts') {
      const next = new Map(frame.acts.map((act) => [act.rootId as string, act]));
      for (const rootId of this.acts.keys()) if (!next.has(rootId)) this.settledAt.set(rootId, Date.now());
      this.acts = next;
      return;
    }
    if (frame.kind === 'row') return;
    if (frame.kind === 'list') {
      if (frame.places !== undefined) this.rows = frame.places;
      this.elsewhere = new Set(frame.elsewhere.map((place) => place.threadId));
      this.elsewhereRoots = new Map(frame.elsewhere.map((place) => [place.threadId, place.rootId]));
    } else {
      const next = new Map(this.rows.map((place) => [place.rootId, place]));
      for (const rootId of frame.removed) next.delete(rootId);
      for (const place of frame.upsert) next.set(place.rootId, place);
      const ordered: WorktreePlace[] = [];
      for (const place of next.values()) ordered[place.index] = place;
      this.rows = ordered;
    }
    for (const row of frame.kind === 'list' ? (frame.places ?? []) : frame.upsert) {
      this.seen.set(row.rootId, { rootId: row.rootId, label: row.branch ?? row.name, hue: row.hue });
    }
    this.known = true;
    this.unread = null;
    if (this.creations.length > 0) this.creations = this.landed(this.creations);
  }
}
