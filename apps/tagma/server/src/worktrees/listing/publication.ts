import { Effect, Queue } from 'effect';
import type { WorktreeRow } from '../contract/wire/rows.js';
import type { Entry } from './rowShapes.js';
import type { ThreadPlacing } from '../contract/service/finishingGate.js';
import { byKey } from './rowOrder.js';
import { byThread } from './placings.js';
import { externalEntry, mainEntry, recordedEntry } from './rowEntries.js';
import type { FeedMembership, Frames, Tree } from './membership.js';

const sameOrder = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((rootId, at) => rootId === right[at]);

const entryOf = (tree: Tree, placed: readonly ThreadPlacing[]): Entry =>
  tree.kind === 'main'
    ? mainEntry(tree.root, tree.sight, tree.headTime, placed)
    : tree.kind === 'external'
      ? externalEntry(tree.root, tree.sight, placed)
      : recordedEntry(tree.record, tree.pending, tree.sight, tree.distance, placed);

export type Publish = (frames: Frames, before: ReadonlySet<string>) => Effect.Effect<void>;

export const makePublish = (input: { readonly membership: FeedMembership; readonly acting: () => ReadonlySet<string> }): Publish => {
  const { membership, acting } = input;
  const { state } = membership;
  const unread = new Set<string>();
  return Effect.fnUntraced(function* (frames: Frames, before: ReadonlySet<string>) {
    const moved = new Set(state.rowsMoved);
    state.rowsMoved.clear();
    let resort = state.sentOrder === null;
    for (const rootId of moved) {
      const tree = state.trees.get(rootId);
      const standing = state.entries.get(rootId);
      if (tree === undefined) {
        if (standing !== undefined) resort = true;
        state.entries.delete(rootId);
        continue;
      }
      const read = entryOf(tree, [...(state.standing.get(rootId)?.values() ?? [])]);
      const entry = { ...read, row: { ...read.row, index: standing?.row.index ?? 0 } };
      if (standing === undefined || standing.rank !== entry.rank || standing.movedAt !== entry.movedAt) resort = true;
      state.entries.set(rootId, entry);
    }
    if (resort) {
      state.order = [...state.entries.values()].sort(byKey).map((entry) => entry.row.rootId);
      for (const [index, rootId] of state.order.entries()) {
        const entry = state.entries.get(rootId);
        if (entry === undefined || entry.row.index === index) continue;
        state.entries.set(rootId, { ...entry, row: { ...entry.row, index } });
        moved.add(rootId);
      }
    }
    let strayed = false;
    if (state.strayed) {
      state.elsewhere = [...state.strays.values()].sort(byThread);
      const printed = JSON.stringify(state.elsewhere);
      strayed = printed !== state.sentElsewhere;
      state.sentElsewhere = printed;
      state.strayed = false;
    }
    const midAct = new Set([...before, ...acting()]);
    const shownRow = (rootId: string): WorktreeRow | undefined => {
      const row = state.entries.get(rootId)?.row;
      const frozen = midAct.has(rootId) && !unread.has(rootId) ? state.shown.get(rootId) : undefined;
      return frozen !== undefined && row !== undefined ? { ...frozen, index: row.index } : row;
    };
    const show = (row: WorktreeRow): void => {
      state.shown.set(row.rootId, row);
      if (row.reading === 'pending') unread.add(row.rootId);
      else unread.delete(row.rootId);
    };
    const previous = state.sentOrder;
    if (previous === null || !sameOrder(previous, state.order) || strayed) {
      const rows = state.order.flatMap((rootId) => {
        const row = shownRow(rootId);
        return row === undefined ? [] : [row];
      });
      yield* Queue.offer(frames, { kind: 'list', rows, elsewhere: state.elsewhere, start: 0, total: state.order.length });
      state.shown.clear();
      unread.clear();
      for (const row of rows) show(row);
    } else {
      for (const rootId of state.order) {
        if (!moved.has(rootId)) continue;
        const row = shownRow(rootId);
        if (row === undefined || JSON.stringify(row) === JSON.stringify(state.shown.get(rootId))) continue;
        yield* Queue.offer(frames, { kind: 'row', row });
        show(row);
      }
    }
    state.sentOrder = state.order;
  });
};
