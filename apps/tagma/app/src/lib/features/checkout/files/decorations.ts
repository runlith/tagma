import type { CheckoutEntry, CheckoutEntryStatus } from '@tagma/server/workspace/contract/wire/checkout';
import { SvelteMap } from 'svelte/reactivity';

const WEIGHT: Record<CheckoutEntryStatus, number> = {
  unmerged: 6,
  deleted: 5,
  modified: 4,
  added: 3,
  untracked: 3,
  renamed: 2,
  copied: 1,
};

const STATUSES = Object.keys(WEIGHT) as readonly CheckoutEntryStatus[];

const parentsOf = (path: string): string[] => {
  const out: string[] = [];
  for (let cut = path.lastIndexOf('/'); cut > 0; cut = path.lastIndexOf('/', cut - 1)) out.push(path.slice(0, cut));
  return out;
};

export class TreeDecorations {
  private readonly files = new SvelteMap<string, CheckoutEntryStatus>();
  private readonly directories = new SvelteMap<string, CheckoutEntryStatus>();
  private readonly counts = new Map<string, Map<CheckoutEntryStatus, number>>();

  statusOf(path: string, directory: boolean): CheckoutEntryStatus | undefined {
    return (directory ? this.directories : this.files).get(path);
  }

  apply(entries: readonly CheckoutEntry[]): void {
    const next = new Map<string, CheckoutEntryStatus>();
    for (const entry of entries) {
      const held = next.get(entry.path);
      if (held === undefined || WEIGHT[entry.status] > WEIGHT[held]) next.set(entry.path, entry.status);
    }
    for (const [path, status] of [...this.files]) {
      if (next.get(path) === status) continue;
      this.files.delete(path);
      this.shift(path, status, -1);
    }
    for (const [path, status] of next) {
      if (this.files.get(path) === status) continue;
      this.files.set(path, status);
      this.shift(path, status, 1);
    }
  }

  private shift(path: string, status: CheckoutEntryStatus, by: 1 | -1): void {
    if (status === 'deleted') return;
    for (const directory of parentsOf(path)) {
      const held = this.counts.get(directory) ?? new Map<CheckoutEntryStatus, number>();
      const now = (held.get(status) ?? 0) + by;
      if (now > 0) held.set(status, now);
      else held.delete(status);
      if (held.size === 0) this.counts.delete(directory);
      else this.counts.set(directory, held);
      const strongest = STATUSES.filter((one) => held.has(one)).reduce<CheckoutEntryStatus | undefined>(
        (best, one) => (best === undefined || WEIGHT[one] > WEIGHT[best] ? one : best),
        undefined,
      );
      if (strongest === undefined) this.directories.delete(directory);
      else if (this.directories.get(directory) !== strongest) this.directories.set(directory, strongest);
    }
  }
}
