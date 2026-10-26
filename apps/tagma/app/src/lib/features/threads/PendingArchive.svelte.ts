import type { ThreadListRow } from '@tagma/server/threads/contract/wire/list';

type Leaving = { readonly ids: readonly string[]; readonly left: Set<string> };

export class PendingArchive {
  private readonly leaving = new Map<string, Leaving>();
  private waking = $state.raw<readonly string[]>([]);

  constructor(private readonly held: (id: string) => ThreadListRow | undefined) {}

  hides(id: string, row: ThreadListRow | undefined): boolean {
    if (this.leaving.size === 0) return false;
    if (this.leaving.has(id)) return true;
    const seen = new Set<string>();
    let at = row;
    while (at !== undefined && !seen.has(at.id)) {
      seen.add(at.id);
      const parentId: string | null = at.parentThreadId;
      if (parentId === null) return false;
      if (this.leaving.has(parentId)) return true;
      at = this.held(parentId);
    }
    return false;
  }

  leave(id: string, ids: readonly string[]): void {
    this.leaving.set(id, { ids, left: new Set(ids) });
  }

  cancel(id: string): void {
    this.leaving.delete(id);
  }

  gone(id: string): void {
    for (const [root, entry] of this.leaving) {
      if (entry.left.delete(id) && entry.left.size === 0) this.leaving.delete(root);
    }
  }

  confirm(): void {
    for (const [root, entry] of this.leaving) {
      for (const id of entry.left) if (this.held(id) === undefined) entry.left.delete(id);
      if (entry.left.size === 0) this.leaving.delete(root);
    }
  }

  wake(id: string): void {
    if (!this.waking.includes(id)) this.waking = [...this.waking, id];
  }

  woke(id: string): void {
    if (this.waking.includes(id)) this.waking = this.waking.filter((one) => one !== id);
  }

  shelved(rows: readonly ThreadListRow[] | null): readonly ThreadListRow[] | null {
    if (rows === null || this.waking.length === 0) return rows;
    const asleep = unwoken(rows, new Set(this.waking));
    return rows.filter((row) => !asleep.has(row.id));
  }

  shelvedTotal(total: number | null, rows: readonly ThreadListRow[] | null, kept: readonly ThreadListRow[] | null): number | null {
    if (total === null || rows === null || kept === null) return total;
    return Math.max(0, total - (rows.length - kept.length));
  }

  settled(
    id: string,
    rows: readonly ThreadListRow[] | null,
    total: number | null,
  ): { rows: readonly ThreadListRow[] | null; total: number | null } {
    if (rows === null) return { rows, total };
    const asleep = unwoken(rows, new Set([id]));
    return { rows: rows.filter((row) => !asleep.has(row.id)), total: total === null ? null : Math.max(0, total - asleep.size) };
  }
}

function unwoken(rows: readonly ThreadListRow[], waking: ReadonlySet<string>): ReadonlySet<string> {
  const byId = new Map(rows.map((row) => [row.id, row] as const));
  const woken = new Set<string>();
  for (const row of rows) {
    const seen = new Set<string>();
    for (let at: ThreadListRow | undefined = row; at !== undefined && !seen.has(at.id);) {
      seen.add(at.id);
      if (waking.has(at.id) && at.archivedAt === row.archivedAt) {
        woken.add(row.id);
        break;
      }
      at = at.parentThreadId === null ? undefined : byId.get(at.parentThreadId);
    }
  }
  return woken;
}
