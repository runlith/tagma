import type { RootId } from '@tagma/server/workspace/contract/wire/ids';
import type { HistoryCommit } from '@tagma/server/workspace/contract/wire/history';
import { CheckoutRepo } from './Repo.js';
import { SHORT_SHA } from './reading.js';

type Repo = ReturnType<typeof CheckoutRepo.use>;

export type HistoryAim = { readonly projectId: number; readonly rootId: RootId; readonly path?: string };

export type CommitLine = {
  readonly full: string;
  readonly sha: string;
  readonly date: string;
  readonly subject: string;
  readonly author: string;
  readonly graph: boolean;
};

const sameAim = (one: HistoryAim, two: HistoryAim): boolean =>
  one.projectId === two.projectId && one.rootId === two.rootId && one.path === two.path;

export class PathCommits {
  private size = $state<number | null>(null);
  private held = $state<{ at: HistoryAim; commits: readonly HistoryCommit[]; cursor: string } | null>(null);

  constructor(
    private readonly repo: Repo,
    private readonly at: () => HistoryAim | null,
  ) {}

  measured(rows: number): void {
    if (this.size === null) this.size = rows;
  }

  private active = $derived.by(() => {
    const at = this.at();
    const held = this.held;
    return at !== null && held !== null && sameAim(held.at, at) ? held : null;
  });

  private query = $derived.by(() => {
    const at = this.at();
    const limit = this.size;
    return at === null || limit === null
      ? null
      : this.repo.history.key({
          projectId: at.projectId,
          rootId: at.rootId,
          path: at.path,
          limit,
          cursor: this.active === null ? undefined : this.active.cursor,
        });
  });

  private reading = $derived(this.query?.data ?? null);

  askMore(): void {
    const at = this.at();
    const next = this.reading?.next;
    if (at === null || next === null || next === undefined) return;
    this.held = {
      at,
      commits: [...(this.active?.commits ?? []), ...(this.reading?.commits ?? [])],
      cursor: next,
    };
  }

  reset(): void {
    this.held = null;
    void this.query?.refresh().catch(() => undefined);
  }

  lines = $derived<readonly CommitLine[] | null>(
    this.reading === null && this.active === null
      ? null
      : [...(this.active?.commits ?? []), ...(this.reading?.commits ?? [])].map((commit) => ({
          full: commit.sha,
          sha: commit.sha.slice(0, SHORT_SHA),
          date: commit.date,
          subject: commit.subject,
          author: commit.author,
          graph: commit.graph,
        })),
  );

  more = $derived(this.reading?.next !== null && this.reading?.next !== undefined);

  failed = $derived(this.query?.error);
}
