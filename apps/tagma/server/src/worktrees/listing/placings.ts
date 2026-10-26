import type { RootId } from '../../workspace/contract/wire/ids.js';
import type { WorktreeElsewhere } from '../contract/wire/rows.js';
import type { ThreadPlacing } from '../contract/service/finishingGate.js';

export const placeOf = (placing: ThreadPlacing, canonical: RootId | undefined): string | undefined =>
  placing.cleared ? undefined : (placing.rootId ?? canonical);

export const strayOf = (placing: ThreadPlacing, shown: (rootId: string) => boolean): WorktreeElsewhere | null =>
  placing.cleared
    ? { threadId: placing.threadId, rootId: null }
    : placing.rootId !== null && !shown(placing.rootId)
      ? { threadId: placing.threadId, rootId: placing.rootId as RootId }
      : null;

export const byThread = (left: WorktreeElsewhere, right: WorktreeElsewhere): number =>
  left.threadId < right.threadId ? -1 : left.threadId > right.threadId ? 1 : 0;

export const placingsByRoot = (
  placings: readonly ThreadPlacing[],
  canonical: RootId | undefined,
): ReadonlyMap<string, readonly ThreadPlacing[]> => {
  const standing = new Map<string, ThreadPlacing[]>();
  for (const placing of placings) {
    const rootId = placeOf(placing, canonical);
    if (rootId === undefined) continue;
    const there = standing.get(rootId);
    if (there === undefined) standing.set(rootId, [placing]);
    else there.push(placing);
  }
  return standing;
};
