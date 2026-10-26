import { lstat, readdir } from 'node:fs/promises';
import type { SpaceItem } from '../contract/wire/space.js';

export type Walked = {
  readonly entries: number;
  readonly bytes: number;
  readonly reclaimable: number;
  readonly items: readonly SpaceItem[];
  readonly unread: number;
};

export type WalkBounds = {
  readonly readers: number;
  readonly progressEvery: number;
  readonly items: number;
};

type Pending = { readonly path: string; readonly rel: string; readonly top: string; readonly spare: boolean };

type Item = { kind: SpaceItem['kind']; bytes: number; reclaimable: number };

export async function walk(
  root: string,
  ignored: ReadonlySet<string>,
  bounds: WalkBounds,
  signal: AbortSignal,
  progress: (entries: number, bytes: number) => void,
): Promise<Walked> {
  const items = new Map<string, Item>();
  const pending: Pending[] = [];
  const linked = new Set<string>();
  let entries = 0;
  let bytes = 0;
  let reclaimable = 0;
  let unread = 0;

  for (const dirent of await readdir(root, { withFileTypes: true })) {
    const spare = ignored.has(dirent.name);
    pending.push({ path: `${root}/${dirent.name}`, rel: dirent.name, top: dirent.name, spare });
    items.set(dirent.name, {
      kind: dirent.isSymbolicLink() ? 'symlink' : dirent.isDirectory() ? 'directory' : 'file',
      bytes: 0,
      reclaimable: 0,
    });
  }

  let busy = 0;
  let parked: (() => void)[] = [];
  const wake = () => {
    const woken = parked;
    parked = [];
    for (const one of woken) one();
  };

  const reader = async (): Promise<void> => {
    for (;;) {
      if (signal.aborted) throw signal.reason;
      const next = pending.pop();
      if (next === undefined) {
        if (busy === 0) {
          wake();
          return;
        }
        await new Promise<void>((resolve) => parked.push(resolve));
        continue;
      }
      busy += 1;
      try {
        await visit(next);
      } finally {
        busy -= 1;
        wake();
      }
    }
  };

  const visit = async (next: Pending): Promise<void> => {
    let stats;
    try {
      stats = await lstat(next.path);
    } catch {
      unread += 1;
      return;
    }
    entries += 1;
    if (!stats.isDirectory() && stats.nlink > 1) {
      const identity = `${stats.dev}:${stats.ino}`;
      if (linked.has(identity)) return;
      linked.add(identity);
    }
    const size = stats.blocks > 0 ? stats.blocks * 512 : stats.size;
    bytes += size;
    const item = items.get(next.top) as Item;
    item.bytes += size;
    if (next.spare) {
      reclaimable += size;
      item.reclaimable += size;
    }
    if (entries % bounds.progressEvery === 0) progress(entries, bytes);
    if (!stats.isDirectory()) return;
    let children;
    try {
      children = await readdir(next.path, { withFileTypes: true });
    } catch {
      unread += 1;
      return;
    }
    for (const child of children) {
      const rel = `${next.rel}/${child.name}`;
      pending.push({ path: `${next.path}/${child.name}`, rel, top: next.top, spare: next.spare || ignored.has(rel) });
    }
  };

  await Promise.all(Array.from({ length: bounds.readers }, reader));
  const top = [...items]
    .map(([name, item]) => ({ name, ...item }))
    .sort((left, right) => right.bytes - left.bytes)
    .slice(0, bounds.items);
  return { entries, bytes, reclaimable, items: top, unread };
}
