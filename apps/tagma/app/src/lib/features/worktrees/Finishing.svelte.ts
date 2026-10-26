import type { WorktreeMerged, WorktreePullRequest } from '@tagma/server/landing/contract/wire/merge';
import type { WorktreeDeleted, WorktreeUpdateHanded } from '@tagma/server/worktrees/contract/wire/retirement';
import type { RootId } from '@tagma/server/workspace/contract/wire/ids';
import type { RenameRemote, WorktreeRenamed } from '@tagma/server/worktrees/contract/wire/creation';
import type { WorktreeActKind, WorktreeActPhase, WorktreePlace } from '@tagma/server/worktrees/contract/wire/rows';
import type { PendingMerge, MergeAfter, MergeMode } from '@tagma/server/worktrees/contract/wire/mergeTypes';
import { Scope } from '@runlith/layer/Scope';
import { Service } from '@runlith/layer/key';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import { ProjectRung, type ProjectAim } from '$lib/features/workspace/ProjectRung.js';
import { type Refusal, refusalOf } from '$lib/wire/refusal.js';
import { deletedWords, mergedAfterWords } from './finishWords.js';
import { NOTHING_STANDS, PlaceStanding, stands, unseen, type StandingInPlace } from './PlaceStanding.js';
import { Worktrees } from './BoardState.svelte.js';
import { WorktreesRepo } from './Repo.js';

type Repo = ReturnType<typeof WorktreesRepo.use>;

export type MergeAsk = {
  readonly mode: MergeMode;
  readonly message?: string;
  readonly after: MergeAfter;
  readonly whenBaseFree: boolean;
};

export type FinishView =
  | { readonly kind: 'merge'; readonly row: WorktreePlace }
  | { readonly kind: 'merged'; readonly row: WorktreePlace; readonly merged: WorktreeMerged }
  | { readonly kind: 'deleted'; readonly row: WorktreePlace; readonly answer: WorktreeDeleted }
  | { readonly kind: 'pull-request'; readonly row: WorktreePlace; readonly answer: WorktreePullRequest }
  | { readonly kind: 'updated'; readonly row: WorktreePlace; readonly answer: WorktreeUpdateHanded }
  | { readonly kind: 'rename'; readonly row: WorktreePlace }
  | { readonly kind: 'renamed'; readonly row: WorktreePlace; readonly answer: WorktreeRenamed };

export type FinishAct = WorktreeActKind | 'cancel';

export const LEAVING_ACTS: ReadonlySet<FinishAct> = new Set(['delete', 'merge', 'clean']);

export type InFlight = { readonly act: FinishAct; readonly phase: WorktreeActPhase | null; readonly since: number };

export type Outcome = {
  readonly id: number;
  readonly rootId: string;
  readonly label: string;
  readonly hue: number | null;
  readonly words: string;
  readonly refusal: Refusal | null;
  readonly detail: FinishView | null;
  readonly link: string | null;
};

type Place = { readonly rootId: string; readonly label: string; readonly hue: number | null };

export const IDLE_HINT_DAYS = 5;

const DAY = 86_400_000;

const LEAVING_MS = 2_000;

const MAIN_BUSY: ReadonlySet<string> = new Set(['base-held', 'base-staged', 'base-mid-operation']);

const REFUSED: Record<FinishAct, string> = {
  delete: 'not deleted',
  merge: 'not merged',
  rename: 'not renamed',
  update: 'update not handed',
  'pull-request': 'no pull request',
  clean: 'not cleaned up',
  cancel: 'the merge still waits',
};

export const waitsForBase = (refusal: Refusal | null): boolean => refusal !== null && MAIN_BUSY.has(refusal.code);

export function idleDays(row: WorktreePlace, now: number): number | null {
  if (row.kind !== 'tagma' || row.missing || row.agents.working + row.agents.waiting > 0) return null;
  if (row.movedAt === null) return null;
  const days = Math.floor((now - Date.parse(row.movedAt)) / DAY);
  return days >= IDLE_HINT_DAYS ? days : null;
}

const placeOf = (row: WorktreePlace): Place => ({ rootId: row.rootId, label: row.branch ?? row.name, hue: row.hue });

export class Finishing extends Service<Finishing>()('Finishing', { tier: 'project' }) {
  static *make() {
    return new Finishing(
      yield* ProjectRung.Current,
      yield* WorktreesRepo,
      yield* Worktrees,
      yield* Notices,
      yield* PlaceStanding,
      yield* Scope,
    );
  }

  view = $state.raw<FinishView | null>(null);
  refusals = $state.raw<ReadonlyMap<string, Refusal>>(new Map());
  acting = $state.raw<ReadonlyMap<string, InFlight>>(new Map());
  outcomes = $state.raw<readonly Outcome[]>([]);
  pullRequests = $state.raw<ReadonlyMap<string, string>>(new Map());
  standing = $state.raw<ReadonlyMap<string, StandingInPlace>>(new Map());

  private queued: FinishView[] = [];
  private minted = 0;

  readonly departed = $derived(this.outcomes.filter((outcome) => this.worktrees.byRoot(outcome.rootId) === null));

  constructor(
    readonly aim: ProjectAim,
    private readonly repo: Repo,
    private readonly worktrees: Worktrees,
    private readonly notices: Notices,
    private readonly places: PlaceStanding,
    private readonly scope: Scope,
  ) {
    super();
  }

  baseRowOf(row: WorktreePlace): WorktreePlace | null {
    const wanted = row.base?.branch ?? null;
    if (wanted === null) return null;
    const rows = this.worktrees.rows;
    return rows.find((one) => one.kind === 'main' && one.branch === wanted) ?? rows.find((one) => one.branch === wanted) ?? null;
  }

  inFlight(rootId: string): InFlight | null {
    const served = this.worktrees.acts.get(rootId);
    if (served !== undefined) return { act: served.act, phase: served.phase, since: Date.parse(served.since) };
    return this.acting.get(rootId) ?? null;
  }

  actingOn(rootId: string): FinishAct | null {
    return this.inFlight(rootId)?.act ?? null;
  }

  leaving(rootId: string): boolean {
    if (this.worktrees.byRoot(rootId) !== null) return false;
    return this.inFlight(rootId) !== null || Date.now() - (this.worktrees.settledAt.get(rootId) ?? 0) < LEAVING_MS;
  }

  outcomeOf(rootId: string): Outcome | null {
    return this.outcomes.findLast((outcome) => outcome.rootId === rootId) ?? null;
  }

  dismiss(id: number): void {
    this.outcomes = this.outcomes.filter((outcome) => outcome.id !== id);
  }

  detail(outcome: Outcome): void {
    if (outcome.detail === null) return;
    this.dismiss(outcome.id);
    this.show(outcome.detail);
  }

  askMerge(row: WorktreePlace): void {
    this.forgetRefusal(row.rootId);
    this.view = { kind: 'merge', row };
    void this.readStanding(row.rootId);
  }

  askRename(row: WorktreePlace): void {
    this.forgetRefusal(row.rootId);
    this.view = { kind: 'rename', row };
  }

  standingIn(rootId: string): StandingInPlace | null {
    return this.standing.get(rootId) ?? null;
  }

  close(): void {
    this.view = this.queued.shift() ?? null;
  }

  private show(view: FinishView): void {
    if (this.view === null || this.view.row.rootId === view.row.rootId) this.view = view;
    else this.queued.push(view);
  }

  async check(rootId: RootId) {
    try {
      return (await this.repo.check.run({ projectId: this.aim.projectId, rootId }, { throwOnError: true })) ?? null;
    } catch (error) {
      if (!this.scope.signal.aborted) this.notices.refusal(error);
      return null;
    }
  }

  pendingOf(rootId: string): PendingMerge | null {
    return this.worktrees.byRoot(rootId)?.pending ?? null;
  }

  async merge(row: WorktreePlace, ask: MergeAsk): Promise<void> {
    if (this.inFlight(row.rootId) !== null) return;
    this.forgetRefusal(row.rootId);
    if (ask.after !== 'keep' && (await this.consented(row.rootId)) === null) return;
    const merged = await this.run(row.rootId, 'merge', () =>
      this.repo.merge.run(
        {
          projectId: this.aim.projectId,
          rootId: row.rootId,
          mode: ask.mode,
          after: ask.after,
          whenBaseFree: ask.whenBaseFree,
          message: ask.message,
        },
        { throwOnError: true },
      ),
    );
    if (merged === undefined) return;
    if ('refusal' in merged) {
      this.refusedIn(placeOf(row), 'merge', merged.refusal);
      return;
    }
    if ('queued' in merged.answer) {
      if (this.view?.kind === 'merge' && this.view.row.rootId === row.rootId) this.close();
      return;
    }
    const answer = merged.answer;
    this.told(placeOf(row), [`merged into ${answer.base.branch}`, ...mergedAfterWords(answer.after)], {
      kind: 'merged',
      row,
      merged: answer,
    });
  }

  async cancelMerge(row: WorktreePlace): Promise<void> {
    await this.acted(placeOf(row), 'cancel', () =>
      this.repo.cancelMerge.run({ projectId: this.aim.projectId, rootId: row.rootId }, { throwOnError: true }),
    );
  }

  async pullRequest(row: WorktreePlace): Promise<void> {
    const opened = await this.acted(placeOf(row), 'pull-request', () =>
      this.repo.pullRequest.run({ projectId: this.aim.projectId, rootId: row.rootId }, { throwOnError: true }),
    );
    if (opened === null) return;
    this.pullRequests = new Map(this.pullRequests).set(row.rootId, opened.url);
    this.told(
      placeOf(row),
      [opened.opened ? 'pull request opened' : 'pull request already open'],
      { kind: 'pull-request', row, answer: opened },
      opened.url,
    );
  }

  async rename(row: WorktreePlace, name: string, remote: RenameRemote): Promise<void> {
    if (this.inFlight(row.rootId) !== null) return;
    this.forgetRefusal(row.rootId);
    const renamed = await this.run(row.rootId, 'rename', () =>
      this.repo.rename.run({ projectId: this.aim.projectId, rootId: row.rootId, name, remote }, { throwOnError: true }),
    );
    if (renamed === undefined) return;
    if ('refusal' in renamed) {
      this.refusedIn(placeOf(row), 'rename', renamed.refusal);
      return;
    }
    const answer = renamed.answer;
    if (answer.remote.status === 'moved' && answer.remote.pullRequest !== null) {
      this.pullRequests = new Map(this.pullRequests).set(row.rootId, answer.remote.pullRequest.opened.url);
    }
    this.told({ ...placeOf(row), label: answer.to }, [`renamed to ${answer.to}`], { kind: 'renamed', row, answer });
  }

  async remove(row: WorktreePlace): Promise<void> {
    if (this.inFlight(row.rootId) !== null) return;
    const answer = await this.acted(placeOf(row), 'delete', () =>
      this.repo.remove.run({ projectId: this.aim.projectId, rootId: row.rootId }, { throwOnError: true }),
    );
    if (answer === null) return;
    const telling =
      answer.branch.status === 'kept' || answer.ended.length > 0 || answer.committed !== null || answer.threads.kept.length > 0;
    this.told(placeOf(row), deletedWords(answer), telling ? { kind: 'deleted', row, answer } : null);
  }

  async update(row: WorktreePlace): Promise<void> {
    const answer = await this.acted(placeOf(row), 'update', () =>
      this.repo.update.run({ projectId: this.aim.projectId, rootId: row.rootId }, { throwOnError: true }),
    );
    if (answer !== null) this.told(placeOf(row), [`update handed to ${answer.threadId.slice(0, 8)}`], { kind: 'updated', row, answer });
  }

  async readStanding(rootId: string): Promise<StandingInPlace> {
    const read = await this.places.read(rootId).catch(() => NOTHING_STANDS);
    if (!this.scope.signal.aborted) this.standing = new Map(this.standing).set(rootId, read);
    return read;
  }

  async consented(...rootIds: readonly string[]): Promise<boolean | null> {
    const seen = rootIds.map((rootId) => this.standing.get(rootId) ?? NOTHING_STANDS);
    const now = await Promise.all(rootIds.map((rootId) => this.readStanding(rootId)));
    if (this.scope.signal.aborted) return null;
    if (!now.some((one, index) => unseen(seen[index] ?? NOTHING_STANDS, one))) return now.some(stands);
    this.notices.error(
      'Worktree',
      'Something started running in this worktree after the dialog read it. Read what it lists now, then confirm again.',
    );
    return null;
  }

  private forgetRefusal(rootId: string): void {
    if (!this.refusals.has(rootId)) return;
    const next = new Map(this.refusals);
    next.delete(rootId);
    this.refusals = next;
  }

  private told(place: Place, words: readonly string[], detail: FinishView | null, link: string | null = null): void {
    if (detail !== null && this.view !== null && this.view.row.rootId === detail.row.rootId) {
      this.view = detail;
      return;
    }
    this.settle(place, words.join(' · '), null, detail, link);
  }

  private refusedIn(place: Place, act: 'merge' | 'rename', refusal: Refusal): void {
    if (this.view?.row.rootId === place.rootId) this.refusals = new Map(this.refusals).set(place.rootId, refusal);
    else this.settle(place, REFUSED[act], refusal, null, null);
  }

  private settle(place: Place, words: string, refusal: Refusal | null, detail: FinishView | null, link: string | null): Outcome {
    const outcome: Outcome = { id: ++this.minted, ...place, words, refusal, detail, link };
    this.outcomes = [...this.outcomes.filter((one) => one.rootId !== place.rootId), outcome];
    return outcome;
  }

  private async acted<T>(place: Place, act: FinishAct, work: () => Promise<T | undefined>): Promise<T | null> {
    const done = await this.run(place.rootId, act, work);
    if (done === undefined) return null;
    if ('refusal' in done) {
      this.settle(place, REFUSED[act], done.refusal, null, null);
      return null;
    }
    return done.answer;
  }

  private async run<T>(
    rootId: string,
    act: FinishAct,
    work: () => Promise<T | undefined>,
  ): Promise<{ readonly answer: T } | { readonly refusal: Refusal } | undefined> {
    this.acting = new Map(this.acting).set(rootId, { act, phase: null, since: Date.now() });
    this.outcomes = this.outcomes.filter((outcome) => outcome.rootId !== rootId);
    try {
      const answer = await work();
      if (answer === undefined || this.scope.signal.aborted) return undefined;
      return { answer };
    } catch (error) {
      return this.scope.signal.aborted ? undefined : { refusal: refusalOf(error) };
    } finally {
      const next = new Map(this.acting);
      next.delete(rootId);
      this.acting = next;
      this.worktrees.settledAt.set(rootId, Date.now());
    }
  }
}
