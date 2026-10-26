import type { ThreadListRow } from '@tagma/server/threads/contract/wire/list';
import type { WorktreePlace } from '@tagma/server/worktrees/contract/wire/rows';
import { bandedRoots, composeNode, feedRoots, type ThreadTreeNode } from '../forest.js';

export type WorktreeGroup = {
  readonly row: WorktreePlace;
  readonly trees: readonly ThreadTreeNode[];
};

export type WorktreeAway = { readonly row: WorktreePlace; readonly threads: readonly string[] };

export type WorktreeCrumb = { readonly parent: ThreadListRow; readonly row: WorktreePlace };

export type WorktreeGrouping = {
  readonly groups: readonly WorktreeGroup[];
  readonly nowhere: readonly ThreadTreeNode[];
  readonly creating: ReadonlyMap<string, readonly ThreadTreeNode[]>;
  readonly away: ReadonlyMap<string, readonly WorktreeAway[]>;
  readonly crumbs: ReadonlyMap<string, WorktreeCrumb>;
  readonly groupOf: ReadonlyMap<string, string>;
};

const NOWHERE = ':nowhere';

type Member = { readonly node: ThreadTreeNode; readonly group: string };

export function worktreeGroups(
  trees: readonly ThreadTreeNode[],
  rows: readonly WorktreePlace[],
  placeOf: (threadId: string) => WorktreePlace | null,
  creatingOf: (thread: ThreadListRow) => string | null = () => null,
): WorktreeGrouping {
  const fallback = rows.find((row) => row.kind === 'main') ?? rows[0];
  const drawn = new Set(rows.map((row) => row.rootId));
  const byId = new Map<string, ThreadListRow>();
  const place = new Map<string, WorktreePlace>();
  const homes = new Map<string, string>();
  const walkRows = (node: ThreadTreeNode): void => {
    const row = node.row;
    byId.set(row.id, row);
    const creation = creatingOf(row);
    if (creation !== null) homes.set(row.id, `creating:${creation}`);
    else {
      const standing = placeOf(row.id);
      if (standing === null) homes.set(row.id, NOWHERE);
      else {
        const home = drawn.has(standing.rootId) ? standing : fallback;
        if (home !== undefined) {
          place.set(row.id, home);
          homes.set(row.id, home.rootId);
        }
      }
    }
    for (const child of node.children) walkRows(child);
  };
  for (const tree of trees) walkRows(tree);
  const sunk = new Map<string, ThreadTreeNode[]>();
  const project = (node: ThreadTreeNode): Member | null => {
    const group = homes.get(node.row.id);
    if (group === undefined) return null;
    const kept: ThreadTreeNode[] = [];
    let changed = false;
    for (const child of node.children) {
      const member = project(child);
      if (member === null) {
        changed = true;
        continue;
      }
      if (member.group === group) {
        kept.push(member.node);
        changed = changed || member.node !== child;
      } else {
        changed = true;
        const held = sunk.get(member.group);
        if (held === undefined) sunk.set(member.group, [member.node]);
        else held.push(member.node);
      }
    }
    return { node: changed ? { ...node, children: kept, team: composeNode(node.row, kept).team } : node, group };
  };
  for (const tree of trees) {
    const member = project(tree);
    if (member === null) continue;
    const held = sunk.get(member.group);
    if (held === undefined) sunk.set(member.group, [member.node]);
    else held.push(member.node);
  }
  const away = new Map<string, WorktreeAway[]>();
  const crumbs = new Map<string, WorktreeCrumb>();
  for (const thread of byId.values()) {
    const parentId = thread.parentThreadId;
    if (parentId === null || parentId === thread.id) continue;
    const parent = byId.get(parentId);
    const here = place.get(thread.id);
    const there = place.get(parentId);
    if (parent === undefined || here === undefined || there === undefined || here.rootId === there.rootId) continue;
    crumbs.set(thread.id, { parent, row: there });
    const listed = away.get(parentId) ?? [];
    const same = listed.find((entry) => entry.row.rootId === here.rootId);
    if (same === undefined) away.set(parentId, [...listed, { row: here, threads: [thread.id] }]);
    else
      away.set(
        parentId,
        listed.map((entry) => (entry === same ? { row: here, threads: [...entry.threads, thread.id] } : entry)),
      );
  }
  const creating = new Map<string, readonly ThreadTreeNode[]>();
  for (const [group, members] of sunk) if (group.startsWith('creating:')) creating.set(group.slice('creating:'.length), feedRoots(members));
  const groupOf = new Map<string, string>();
  for (const [threadId, row] of place) groupOf.set(threadId, row.rootId);
  return {
    groups: rows.map((row) => ({ row, trees: bandedRoots(sunk.get(row.rootId) ?? []) })),
    nowhere: feedRoots(sunk.get(NOWHERE) ?? []),
    creating,
    away,
    crumbs,
    groupOf,
  };
}
