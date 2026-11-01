import type { ThreadListRow, ThreadsFeedEvent } from '@tagma/server/threads/contract/wire/list';

type RowFrame = Extract<ThreadsFeedEvent, { type: 'row' | 'removed' }>;

export type ShownFamily = { readonly live: readonly ThreadListRow[]; readonly caught: readonly RowFrame[] };

type Reading = { again: boolean; readonly caught: RowFrame[] };

export class ShownFamilies {
  ids: readonly string[] = [];
  private shelf = $state.raw<ReadonlyMap<string, readonly ThreadListRow[]>>(new Map());
  private readonly reading = new Map<string, Reading>();
  private readonly absent = new Set<string>();

  constructor(
    private readonly read: (id: string) => Promise<readonly ThreadListRow[] | undefined>,
    private readonly present: (id: string) => boolean,
    private readonly place: (family: ShownFamily) => void,
    private readonly failed: (error: unknown) => void,
  ) {}

  show(ids: readonly string[]): readonly string[] {
    const was = this.ids;
    if (was.length === ids.length && was.every((id) => ids.includes(id))) return [];
    this.ids = ids;
    this.absent.clear();
    const left = was.filter((id) => !ids.includes(id));
    this.unshelve(left);
    return left;
  }

  caught(frame: RowFrame): void {
    for (const reading of this.reading.values()) reading.caught.push(frame);
    if (frame.type === 'row' && frame.row.archivedAt === null) this.unshelve([frame.row.id]);
  }

  fill(force: boolean): void {
    if (force) this.absent.clear();
    for (const id of this.ids) {
      const known = this.present(id) || this.shelf.has(id) || this.absent.has(id) || this.reading.has(id);
      if (!force && known) continue;
      this.fetch(id);
    }
  }

  over(page: readonly ThreadListRow[] | null): readonly ThreadListRow[] | null {
    if (this.shelf.size === 0) return page;
    const rows = [...(page ?? [])];
    const seen = new Set(rows.map((row) => row.id));
    for (const family of this.shelf.values()) {
      for (const row of family) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        rows.push(row);
      }
    }
    return rows;
  }

  private unshelve(ids: readonly string[]): void {
    if (!ids.some((id) => this.shelf.has(id))) return;
    const shelf = new Map(this.shelf);
    for (const id of ids) shelf.delete(id);
    this.shelf = shelf;
  }

  private fetch(id: string): void {
    const standing = this.reading.get(id);
    if (standing !== undefined) {
      standing.again = true;
      return;
    }
    const reading: Reading = { again: false, caught: [] };
    this.reading.set(id, reading);
    void this.answer(id, reading);
  }

  private async answer(id: string, reading: Reading): Promise<void> {
    try {
      for (;;) {
        const rows = await this.read(id);
        if (reading.again) {
          reading.again = false;
          reading.caught.length = 0;
          continue;
        }
        if (rows !== undefined && this.ids.includes(id)) this.settle(id, rows, reading.caught);
        return;
      }
    } catch (error) {
      this.failed(error);
    } finally {
      this.reading.delete(id);
    }
  }

  private settle(id: string, rows: readonly ThreadListRow[], caught: readonly RowFrame[]): void {
    const own = rows.find((row) => row.id === id);
    if (own === undefined) {
      this.absent.add(id);
      return;
    }
    if (own.archivedAt !== null) {
      this.shelf = new Map(this.shelf).set(
        id,
        familyOf(
          rows.filter((row) => row.archivedAt !== null),
          id,
        ),
      );
      return;
    }
    this.place({
      live: familyOf(
        rows.filter((row) => row.archivedAt === null),
        id,
      ),
      caught,
    });
  }
}

function familyOf(rows: readonly ThreadListRow[], id: string): readonly ThreadListRow[] {
  const byId = new Map(rows.map((row) => [row.id, row] as const));
  let top = byId.get(id);
  for (let hops = 0; top?.parentThreadId != null && byId.has(top.parentThreadId) && hops <= rows.length; hops += 1) {
    top = byId.get(top.parentThreadId);
  }
  if (top === undefined) return [];
  const below = new Map<string, ThreadListRow[]>();
  for (const row of rows) {
    if (row.parentThreadId === null) continue;
    const siblings = below.get(row.parentThreadId);
    if (siblings === undefined) below.set(row.parentThreadId, [row]);
    else siblings.push(row);
  }
  const family: ThreadListRow[] = [];
  const seen = new Set<string>();
  const stack = [top];
  for (let at = stack.pop(); at !== undefined; at = stack.pop()) {
    if (seen.has(at.id)) continue;
    seen.add(at.id);
    family.push(at);
    stack.push(...(below.get(at.id) ?? []));
  }
  return family;
}
