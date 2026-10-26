import type { CheckoutArea, CheckoutEntry, CheckoutState } from '@tagma/server/workspace/contract/wire/checkout';
import { CHECKOUT_DIRECTORY } from '@tagma/server/graph/contract/wire/storage';
import { Failure } from '@runlith/layer/Failure';
import { Scope } from '@runlith/layer/Scope';
import { Service } from '@runlith/layer/key';
import { ReaderMarks } from '$lib/shared/reading/ReaderMarks.svelte.js';
import { GraphRung, type GraphAim } from '$lib/features/workspace/GraphRung.js';
import { ProjectsRepo } from '$lib/features/workspace/ProjectsRepo.js';
import type { CheckoutTarget } from '$lib/features/worktrees/HoldingsReading.svelte.js';
import { Live, type LiveConnection } from '$lib/wire/Live.js';
import { refusalOf } from '$lib/wire/refusal.js';
import { sumLines } from './lineCount.js';

type Projects = ReturnType<typeof ProjectsRepo.use>;

export type CheckoutAbsence = 'no-working-copy' | 'unread';

export type CheckoutSectionName = 'conflicts' | 'staged' | 'changes' | 'graph';

export type CheckoutSection = {
  readonly name: CheckoutSectionName;
  readonly entries: readonly CheckoutEntry[];
};

export const inGraphTree = (entry: { readonly path: string }): boolean =>
  entry.path === CHECKOUT_DIRECTORY || entry.path.startsWith(`${CHECKOUT_DIRECTORY}/`);

export function sectionsOf(row: CheckoutState): readonly CheckoutSection[] {
  const entries = [row.entries.staged, row.entries.unstaged, row.entries.untracked, row.entries.unmerged].flatMap((area) => area.entries);
  const code = (listed: readonly CheckoutEntry[]) => listed.filter((entry) => !inGraphTree(entry));
  const graph = new Map(entries.filter(inGraphTree).map((entry) => [entry.path, entry]));
  return [
    { name: 'conflicts', entries: code(row.entries.unmerged.entries) },
    { name: 'staged', entries: code(row.entries.staged.entries) },
    {
      name: 'changes',
      entries: code([...row.entries.unstaged.entries, ...row.entries.untracked.entries]).sort((one, two) =>
        one.path.localeCompare(two.path),
      ),
    },
    { name: 'graph', entries: [...graph.values()] },
  ];
}

export class Checkout extends Service<Checkout>()('Checkout', { tier: 'graph', eager: true }) {
  static *make() {
    return new Checkout(yield* Live, yield* GraphRung.Current, yield* ProjectsRepo, yield* ReaderMarks, yield* Scope, yield* Failure);
  }

  row = $state.raw<CheckoutState | null>(null);

  absent = $state<CheckoutAbsence | null>(null);

  unreadReason = $state<string | null>(null);

  reading = $state.raw<CheckoutTarget | null>(null);

  private held: { unsubscribe: () => void } | null = null;
  private closed = false;

  constructor(
    private readonly live: LiveConnection,
    private readonly aim: GraphAim,
    private readonly projects: Projects,
    private readonly marks: ReaderMarks,
    scope: Scope,
    private readonly failure: Failure,
  ) {
    super();
    scope.defer(() => {
      this.closed = true;
      this.held?.unsubscribe();
    });
    if (aim.branch === null) this.open({});
    else void this.follow(aim.branch);
  }

  private areas = $derived.by<readonly CheckoutArea[]>(() => {
    const row = this.row;
    return row === null ? [] : [row.entries.staged, row.entries.unstaged, row.entries.untracked, row.entries.unmerged];
  });

  private entries = $derived<readonly CheckoutEntry[]>(this.areas.flatMap((area) => area.entries));

  private code = $derived(this.entries.filter((entry) => !inGraphTree(entry)));

  paths = $derived(new Set(this.code.map((entry) => entry.path)).size);

  lines = $derived(sumLines(this.code.map((entry) => entry.lines)));

  sections = $derived.by<readonly CheckoutSection[]>(() => (this.row === null ? [] : sectionsOf(this.row)));

  branches = $derived.by(() => this.projects.branches.key(this.aim.projectId).data ?? []);

  private async follow(branch: string): Promise<void> {
    try {
      const rows = await this.projects.branches.key(this.aim.projectId).loadOrThrow();
      const worktree = rows?.find((row) => row.branch === branch)?.worktree ?? null;
      if (this.closed) return;
      if (worktree === null) this.absent = 'no-working-copy';
      else this.open({ root: worktree });
    } catch (error) {
      if (!this.closed) this.absent = 'unread';
      this.failure.report(error);
    }
  }

  get projectId(): number {
    return this.aim.projectId;
  }

  private get markedAt(): string {
    return `${this.aim.projectId}:${this.aim.branch ?? ''}`;
  }

  get base(): string | null {
    return this.marks.bases.get(this.markedAt) || null;
  }

  set base(ref: string | null) {
    if (ref === this.base) return;
    this.marks.bases.set(this.markedAt, ref ?? '');
    if (this.reading === null) return;
    this.row = null;
    this.open(this.reading);
  }

  retry(): void {
    if (this.reading !== null) this.open(this.reading);
  }

  private open(named: CheckoutTarget): void {
    this.reading = named;
    this.held?.unsubscribe();
    this.absent = null;
    this.unreadReason = null;
    const base = this.base;
    this.held = this.live.hold(
      (client) =>
        client['checkout.subscribe']({
          projectId: this.aim.projectId,
          ...named,
          base: base ?? undefined,
        }),
      (frame) => {
        this.row = frame;
      },
      (reason) => {
        if (reason.kind !== 'subscription' || this.closed) return;
        if (reason.code === undefined) {
          this.failure.report(new Error(reason.message));
          return;
        }
        this.absent = 'unread';
        this.unreadReason = refusalOf({ code: reason.code, reason: reason.message, unblock: reason.unblock ?? [] }).reason;
      },
    );
  }
}
