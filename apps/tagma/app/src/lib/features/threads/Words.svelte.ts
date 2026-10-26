import type { ThreadListRow } from '@tagma/server/threads/contract/wire/list';
import { SvelteMap } from 'svelte/reactivity';
import type { OwnerWords } from '$lib/shared/threads/Names.svelte.js';
import type { Workspace } from '$lib/features/workspace/Selection.svelte.js';
import { isThreadId } from './activityIdentity.js';
import type { ThreadList } from './List.svelte.js';
import type { ThreadsRepo } from './Repo.js';

type Threads = ReturnType<typeof ThreadsRepo.use>;

const IN_FLIGHT = -1;
const REREAD_MS = 60_000;

type Ask = { readonly project: string | null; readonly thread: string };

const keyOf = (project: string | null, thread: string): string => `${project ?? ''}\n${thread}`;

const wordsOf = (row: Pick<ThreadListRow, 'name' | 'title' | 'archivedAt' | 'harness'>): OwnerWords => ({
  label: row.name?.trim() ? row.name : row.title,
  archived: row.archivedAt != null,
  harness: row.harness !== null,
});

export class ThreadWords {
  private readonly read = new SvelteMap<string, OwnerWords | null>();
  private readonly asked = new Map<string, number>();
  private readonly own: string;
  private pending: Ask[] = [];

  constructor(
    private readonly threads: ThreadList,
    private readonly repo: Threads,
    private readonly workspace: Workspace,
    private readonly projectId: number,
  ) {
    this.own = String(projectId);
  }

  of(thread: string, project?: string): OwnerWords | null | undefined {
    const listed = project === undefined || project === this.own;
    if (listed) {
      const live = this.threads.row(thread);
      if (live !== undefined) return { ...wordsOf(live), ...this.homeOf(live.projectId), projectId: live.projectId, archived: false };
      const archived = this.threads.archived?.find((row) => row.id === thread);
      if (archived !== undefined)
        return { ...wordsOf(archived), ...this.homeOf(archived.projectId), projectId: archived.projectId, archived: true };
    }
    if (!isThreadId(thread)) return null;
    if (listed && this.threads.roots === null) return undefined;
    const at = project ?? null;
    const key = keyOf(at, thread);
    const readAt = this.asked.get(key);
    if (readAt === undefined || (readAt !== IN_FLIGHT && Date.now() - readAt >= REREAD_MS)) this.ask({ project: at, thread });
    if (!this.read.has(key)) return undefined;
    const words = this.read.get(key) ?? null;
    return words === null || words.projectId === undefined ? words : { ...words, ...this.homeOf(words.projectId) };
  }

  private ask(ask: Ask): void {
    this.asked.set(keyOf(ask.project, ask.thread), IN_FLIGHT);
    this.pending.push(ask);
    if (this.pending.length === 1) queueMicrotask(() => void this.fetch());
  }

  private async fetch(): Promise<void> {
    const asks = this.pending;
    this.pending = [];
    const projects = [...new Set(asks.flatMap((ask) => (ask.project === null ? [] : [ask.project])))];
    await Promise.all([
      ...projects.map((project) =>
        this.fetchAt(
          project,
          asks.filter((ask) => ask.project === project).map((ask) => ask.thread),
        ),
      ),
      ...asks.filter((ask) => ask.project === null).map((ask) => this.fetchAt(null, [ask.thread])),
    ]);
  }

  private async fetchAt(project: string | null, ids: readonly string[]): Promise<void> {
    try {
      const answer = await this.repo.list
        .key({ project, selection: { ids: ids.join(','), set: 'all', limit: String(ids.length) } })
        .refresh({ throwOnError: true });
      if (answer === undefined || answer.status !== 'rows') return this.unread(project, ids);
      for (const id of ids) {
        const row = answer.rows.find((candidate) => candidate.id === id);
        this.settle(project, id, row === undefined ? null : { ...wordsOf(row), projectId: row.projectId });
      }
    } catch {
      this.unread(project, ids);
    }
  }

  private unread(project: string | null, ids: readonly string[]): void {
    const now = Date.now();
    for (const id of ids) this.asked.set(keyOf(project, id), now);
  }

  private homeOf(projectId: number): { readonly home?: string | null } {
    return projectId === this.projectId ? {} : { home: this.workspace.find(projectId)?.name ?? null };
  }

  private settle(project: string | null, id: string, words: OwnerWords | null): void {
    const key = keyOf(project, id);
    const standing = this.read.get(key);
    if (
      standing === undefined ||
      standing?.label !== words?.label ||
      standing?.archived !== words?.archived ||
      standing?.harness !== words?.harness ||
      standing?.projectId !== words?.projectId
    ) {
      this.read.set(key, words);
    }
    this.asked.set(key, Date.now());
  }
}
