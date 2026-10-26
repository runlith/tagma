import type { LineCounts, ThreadHeld } from '@tagma/server/change-record/contract/wire/holdings';
import {
  CHANGE_COMMITS,
  CHANGE_COMMITS_CEILING,
  type ChangeCommit,
  type LineEnd,
  type ThreadChangesFrame,
  type ThreadCheckout,
  type ThreadCheckoutChange,
  type ThreadEntry,
} from '@tagma/server/change-record/contract/wire/threadChanges';
import type { RootId } from '@tagma/server/workspace/contract/wire/ids';
import { Failure } from '@runlith/layer/Failure';
import { Scope } from '@runlith/layer/Scope';
import { Service } from '@runlith/layer/key';
import { SvelteSet } from 'svelte/reactivity';
import type { ChangesLens, OpenedFile } from './opened.js';
import { ThreadRung } from '$lib/features/workspace/ThreadRung.js';
import { ProjectRung, type ProjectAim } from '$lib/features/workspace/ProjectRung.js';
import { Live, type LiveConnection } from '$lib/wire/Live.js';
import { refusalOf } from '$lib/wire/refusal.js';

export type Section = ThreadEntry['section'];

export type EntryIn<S extends Section> = Extract<ThreadEntry, { readonly section: S }>;

export const entriesIn = <S extends Section>(checkout: ThreadCheckout, section: S): readonly EntryIn<S>[] =>
  checkout.entries.filter((entry): entry is EntryIn<S> => entry.section === section);

const standingOf = (change: ThreadCheckoutChange, entries: readonly ThreadEntry[]): ThreadCheckout => ({
  checkout: change.checkout,
  projectId: change.projectId,
  root: change.root,
  branch: change.branch,
  revision: change.revision,
  state: change.state,
  uncommitted: change.uncommitted,
  entries,
});

function applied(checkouts: readonly ThreadCheckout[], frame: Extract<ThreadChangesFrame, { kind: 'change' }>): readonly ThreadCheckout[] {
  const gone = new Set<string>(frame.gone);
  const changed = new Map(frame.checkouts.map((change) => [change.checkout, change]));
  const next: ThreadCheckout[] = [];
  for (const standing of checkouts) {
    if (gone.has(standing.checkout)) continue;
    const change = changed.get(standing.checkout);
    if (change === undefined) {
      next.push(standing);
      continue;
    }
    changed.delete(standing.checkout);
    const entries = new Map(standing.entries.map((entry) => [entry.path, entry]));
    for (const path of change.gone) entries.delete(path);
    for (const entry of change.changed) entries.set(entry.path, entry);
    next.push(standingOf(change, [...entries.values()]));
  }
  for (const change of changed.values()) next.push(standingOf(change, change.changed));
  return next;
}

export class ThreadChanges extends Service<ThreadChanges>()('ThreadChanges', { tier: 'thread' }) {
  static *make() {
    return new ThreadChanges(yield* Live, yield* ProjectRung.Current, yield* ThreadRung.Current, yield* Scope, yield* Failure);
  }

  known = $state(false);

  held = $state.raw<ThreadHeld | null>(null);

  uncommitted = $state.raw<LineCounts>({ added: 0, removed: 0 });

  checkouts = $state.raw<readonly ThreadCheckout[]>([]);

  commits = $state.raw<readonly ChangeCommit[]>([]);

  ends = $state.raw<readonly LineEnd[]>([]);

  moved = $state(0);

  readonly expandedCommits = new SvelteSet<string>();

  private more = $state(false);

  private commitLimit = $state(CHANGE_COMMITS);

  private stream: { unsubscribe: () => void } | null = null;

  open = $state.raw<OpenedFile | null>(null);

  lens = $state<ChangesLens>('now');

  constructor(
    private readonly live: LiveConnection,
    private readonly aim: ProjectAim,
    private readonly thread: { readonly id: string },
    scope: Scope,
    private readonly failure: Failure,
  ) {
    super();
    this.subscribe();
    scope.defer(() => this.stream?.unsubscribe());
  }

  get threadId(): string {
    return this.thread.id;
  }

  get projectId(): number {
    return this.aim.projectId;
  }

  moreCommits = $derived(this.more && this.commitLimit < CHANGE_COMMITS_CEILING);

  empty = $derived(
    this.checkouts.every(
      (checkout) => checkout.entries.length === 0 && (checkout.state.kind === 'current' || checkout.state.kind === 'judging'),
    ) &&
      this.commits.length === 0 &&
      this.ends.every((end) => end.paths === 0),
  );

  checkoutOf(rootId: RootId): ThreadCheckout | null {
    return this.checkouts.find((checkout) => checkout.checkout === rootId) ?? null;
  }

  projectOf(rootId: RootId): number {
    const placed =
      this.checkoutOf(rootId)?.projectId ??
      this.commits.find((commit) => commit.checkout === rootId && commit.projectId !== null)?.projectId;
    return placed ?? this.projectId;
  }

  showMoreCommits(): void {
    if (this.commitLimit >= CHANGE_COMMITS_CEILING) return;
    this.commitLimit = Math.min(CHANGE_COMMITS_CEILING, this.commitLimit + CHANGE_COMMITS);
    this.subscribe();
  }

  retry(): void {
    this.subscribe();
  }

  private apply(frame: ThreadChangesFrame): void {
    this.held = frame.held;
    this.uncommitted = frame.uncommitted;
    if (frame.kind === 'whole') {
      this.checkouts = frame.checkouts;
      this.commits = frame.commits;
      this.more = frame.moreCommits;
      this.ends = frame.ends;
    } else {
      this.checkouts = applied(this.checkouts, frame);
      if (frame.commits !== undefined) {
        this.commits = frame.commits.list;
        this.more = frame.commits.more;
      }
      if (frame.ends !== undefined) this.ends = frame.ends;
    }
    this.known = true;
    this.moved += 1;
  }

  private subscribe(): void {
    this.stream?.unsubscribe();
    const commits = this.commitLimit;
    this.stream = this.live.hold(
      (client) =>
        client['thread.changes']({
          projectId: this.aim.projectId,
          threadId: this.thread.id,
          commits: commits === CHANGE_COMMITS ? undefined : commits,
        }),
      (frame) => this.apply(frame),
      (reason) => {
        if (reason.kind !== 'subscription') return;
        this.failure.report(
          reason.code === undefined
            ? new Error(reason.message)
            : refusalOf({ code: reason.code, reason: reason.message, unblock: reason.unblock ?? [] }),
        );
      },
    );
  }
}
