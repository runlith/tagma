import type { CleanedWorktree, CleanupCandidate } from '@tagma/server/worktrees/contract/wire/cleanup';
import { CLEANUP_IDLE_DAYS } from '@tagma/server/worktrees/contract/wire/cleanup';
import type { RootId } from '@tagma/server/workspace/contract/wire/ids';
import { Scope } from '@runlith/layer/Scope';
import { Service } from '@runlith/layer/key';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import { ProjectRung, type ProjectAim } from '$lib/features/workspace/ProjectRung.js';
import { Finishing } from './Finishing.svelte.js';
import { WorktreesRepo } from './Repo.js';

export const CLEANUP_THRESHOLDS = [7, CLEANUP_IDLE_DAYS, 30] as const;

const CLEANUP_PAGE = 100;

export class Cleanup extends Service<Cleanup>()('Cleanup', { tier: 'project' }) {
  static *make() {
    return new Cleanup(yield* ProjectRung.Current, yield* WorktreesRepo, yield* Finishing, yield* Notices, yield* Scope);
  }

  open = $state(false);
  idleAfterDays = $state<number>(CLEANUP_IDLE_DAYS);
  candidates = $state.raw<readonly CleanupCandidate[]>([]);
  total = $state(0);
  read = $state(false);
  selected = $state.raw<ReadonlySet<string>>(new Set());
  outcomes = $state.raw<readonly CleanedWorktree[]>([]);
  cleaning = $state(false);
  private asked = 0;
  private next: string | null = null;

  readonly more = $derived(this.read && this.candidates.length < this.total);
  readonly takeable = $derived(this.candidates.filter((one) => one.blockers.length === 0));
  readonly chosen = $derived(this.candidates.filter((one) => this.selected.has(one.rootId)));
  readonly nothing = $derived(this.read && this.candidates.length === 0 && this.outcomes.length === 0);
  readonly listed = $derived(!this.read || this.candidates.length > 0 || this.outcomes.length === 0);

  constructor(
    readonly aim: ProjectAim,
    private readonly repo: WorktreesRepo,
    private readonly finishing: Finishing,
    private readonly notices: Notices,
    private readonly scope: Scope,
  ) {
    super();
  }

  show(): void {
    this.open = true;
    this.outcomes = [];
    void this.reread();
  }

  aimIdle(days: number): void {
    if (days === this.idleAfterDays) return;
    this.idleAfterDays = days;
    void this.reread();
  }

  toggle(rootId: string): void {
    const next = new Set(this.selected);
    if (!next.delete(rootId)) next.add(rootId);
    this.selected = next;
  }

  toggleAll(): void {
    this.selected = this.chosen.length === this.takeable.length ? new Set() : new Set(this.takeable.map((one) => one.rootId));
  }

  async clean(): Promise<void> {
    const rootIds = this.chosen.map((one) => one.rootId as RootId);
    if (rootIds.length === 0 || this.cleaning) return;
    this.cleaning = true;
    try {
      if ((await this.finishing.consented(...rootIds)) === null) return;
      const answer = await this.repo.clean.run(
        { projectId: this.aim.projectId, rootIds, idleAfterDays: this.idleAfterDays },
        { throwOnError: true },
      );
      if (answer === undefined || this.scope.signal.aborted) return;
      this.outcomes = answer.worktrees;
      await this.reread();
    } catch (error) {
      if (!this.scope.signal.aborted) this.notices.refusal(error);
    } finally {
      this.cleaning = false;
    }
  }

  async readMore(): Promise<void> {
    const cursor = this.next;
    if (cursor === null) return;
    const asked = ++this.asked;
    try {
      const page = await this.repo.cleanup.run(
        { projectId: this.aim.projectId, idleAfterDays: this.idleAfterDays, limit: CLEANUP_PAGE, cursor },
        { throwOnError: true },
      );
      if (page === undefined || this.scope.signal.aborted || asked !== this.asked) return;
      this.candidates = [...this.candidates, ...page.candidates];
      this.total = page.total;
      this.next = page.next;
      for (const one of page.candidates) {
        if (one.blockers.length === 0 && one.reason !== 'missing') void this.finishing.readStanding(one.rootId);
      }
    } catch (error) {
      if (!this.scope.signal.aborted) this.notices.refusal(error);
    }
  }

  private async reread(): Promise<void> {
    const asked = ++this.asked;
    try {
      const page = await this.repo.cleanup.run(
        { projectId: this.aim.projectId, idleAfterDays: this.idleAfterDays, limit: CLEANUP_PAGE },
        { throwOnError: true },
      );
      if (page === undefined || this.scope.signal.aborted || asked !== this.asked) return;
      this.candidates = page.candidates;
      this.total = page.total;
      this.next = page.next;
      this.read = true;
      const standing = new Set(page.candidates.filter((one) => one.blockers.length === 0).map((one) => one.rootId as string));
      this.selected = new Set([...this.selected].filter((rootId) => standing.has(rootId)));
      for (const one of page.candidates) {
        if (one.blockers.length === 0 && one.reason !== 'missing') void this.finishing.readStanding(one.rootId);
      }
    } catch (error) {
      if (!this.scope.signal.aborted) this.notices.refusal(error);
    }
  }
}
