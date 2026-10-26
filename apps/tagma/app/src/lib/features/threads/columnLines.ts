import type { ThreadListRow } from '@tagma/server/threads/contract/wire/list';
import type { ThreadTreeNode } from './forest.js';
import type { FoldShape, ThreadFolds } from './threadFolds.svelte.js';
import { type ColumnEntry, type FolderEntry, foldTeam, matchThreads } from './tree.js';
import type { WorktreeCreation } from '$lib/features/worktrees/BoardState.svelte.js';
import type { ServedModels } from '$lib/features/providers/served.js';
import type { WorktreeAway, WorktreeGroup, WorktreeGrouping } from './worktrees/worktreeGroups.js';

export type Decor = 'shelf' | 'group' | 'nowhere' | 'plain';

export type ColumnLine =
  | { readonly kind: 'rule'; readonly key: string }
  | { readonly kind: 'pinned'; readonly key: string; readonly count: number }
  | { readonly kind: 'folder'; readonly key: string; readonly entry: FolderEntry }
  | { readonly kind: 'empty'; readonly key: string; readonly entry: FolderEntry }
  | {
      readonly kind: 'thread';
      readonly key: string;
      readonly node: ThreadTreeNode;
      readonly depth: number;
      readonly parent: ThreadListRow | null;
      readonly top: boolean;
      readonly decor: Decor;
      readonly drop: string | null;
    }
  | {
      readonly kind: 'stub';
      readonly key: string;
      readonly fold: 'more-working' | 'finished';
      readonly parent: ThreadListRow;
      readonly depth: number;
      readonly count: number;
      readonly expanded: boolean;
      readonly through: boolean;
      readonly drop: string | null;
    }
  | {
      readonly kind: 'away';
      readonly key: string;
      readonly away: readonly WorktreeAway[];
      readonly depth: number;
    }
  | { readonly kind: 'group'; readonly key: string; readonly group: WorktreeGroup; readonly open: boolean }
  | { readonly kind: 'nowhere'; readonly key: string; readonly count: number }
  | { readonly kind: 'creating'; readonly key: string; readonly creation: WorktreeCreation };

export type LineKind = ColumnLine['kind'];

export type LineView = {
  readonly folds: ThreadFolds;
  readonly activeId: string | null;
  readonly filtering: boolean;
  readonly unpinning?: string | null;
  readonly cache?: LineCache;
};

type Span = {
  readonly shape: FoldShape;
  readonly activeId: string | null;
  readonly filtering: boolean;
  readonly unpinning: string | null;
  readonly depth: number;
  readonly decor: Decor;
  readonly drop: string | null;
  readonly away: ReadonlyMap<string, readonly WorktreeAway[]> | undefined;
  readonly parent: ThreadListRow | null;
  readonly top: boolean;
  readonly lines: readonly ColumnLine[];
};

export class LineCache {
  readonly spans = new WeakMap<ThreadTreeNode, Span>();
}

export function focusable(line: ColumnLine): boolean {
  return line.kind === 'thread' || line.kind === 'stub' || line.kind === 'folder' || line.kind === 'group';
}

export function threadLines(
  node: ThreadTreeNode,
  view: LineView,
  placing: {
    readonly depth: number;
    readonly decor: Decor;
    readonly drop: string | null;
    readonly away?: ReadonlyMap<string, readonly WorktreeAway[]>;
  },
  into: ColumnLine[] = [],
): ColumnLine[] {
  const shape = view.folds.shape;
  const cache = view.cache;
  const unpinning = view.unpinning ?? null;
  const walk = (at: ThreadTreeNode, depth: number, parent: ThreadListRow | null, top: boolean): readonly ColumnLine[] => {
    const held = cache?.spans.get(at);
    if (
      held !== undefined &&
      held.depth === depth &&
      held.parent === parent &&
      held.top === top &&
      held.decor === placing.decor &&
      held.drop === placing.drop &&
      held.away === placing.away &&
      held.activeId === view.activeId &&
      held.filtering === view.filtering &&
      held.unpinning === unpinning &&
      held.shape.closed === shape.closed &&
      held.shape.stubs === shape.stubs &&
      held.shape.more === shape.more
    ) {
      return held.lines;
    }
    const row = at.row;
    const out: ColumnLine[] = [{ kind: 'thread', key: row.id, node: at, depth, parent, top, decor: placing.decor, drop: placing.drop }];
    const below = (children: readonly ThreadTreeNode[]): void => {
      for (const child of children) for (const line of walk(child, depth + 1, row, false)) out.push(line);
    };
    const hasChildren = at.children.length > 0;
    const open = view.filtering || view.folds.isOpen(row.id);
    if (hasChildren && open) {
      if (view.filtering) below(at.children);
      else {
        const fold = foldTeam(at.children, view.activeId);
        const moreOpen = view.folds.isMoreOpen(row.id);
        below(moreOpen ? fold.live : fold.standing);
        if (fold.moreWorking.length > 0) {
          out.push({
            kind: 'stub',
            key: `stub:more-working:${row.id}`,
            fold: 'more-working',
            parent: row,
            depth,
            count: fold.moreWorking.length,
            expanded: moreOpen,
            through: false,
            drop: placing.drop,
          });
        }
        below(fold.pinned);
        if (fold.finished.length > 0 || unpinning === row.id) {
          const stubOpen = view.folds.isStubOpen(row.id);
          out.push({
            kind: 'stub',
            key: `stub:finished:${row.id}`,
            fold: 'finished',
            parent: row,
            depth,
            count: fold.finished.length,
            expanded: stubOpen,
            through: false,
            drop: placing.drop,
          });
          if (stubOpen) below(fold.finished);
          else if (fold.kept !== null) below([fold.kept]);
        }
      }
    }
    const away = placing.away?.get(row.id);
    if (away !== undefined && (!hasChildren || open)) out.push({ kind: 'away', key: `away:${row.id}`, away, depth });
    const last = out.length - 1;
    out.forEach((line, at) => {
      if (line.kind === 'stub' && at < last) out[at] = { ...line, through: true };
    });
    cache?.spans.set(at, {
      shape,
      activeId: view.activeId,
      filtering: view.filtering,
      unpinning,
      depth,
      decor: placing.decor,
      drop: placing.drop,
      away: placing.away,
      parent,
      top,
      lines: out,
    });
    return out;
  };
  for (const line of walk(node, placing.depth, null, true)) into.push(line);
  return into;
}

function folderLines(entry: FolderEntry, view: LineView, into: ColumnLine[]): void {
  into.push({ kind: 'folder', key: entry.key, entry });
  for (const sub of entry.folders) folderLines(sub, view, into);
  for (const node of entry.drawn) {
    threadLines(node, view, { depth: entry.depth + 1, decor: 'shelf', drop: `folder:${entry.folder.id}` }, into);
  }
  if (entry.open && entry.members.length === 0 && entry.folders.length === 0)
    into.push({ kind: 'empty', key: `empty:${entry.key}`, entry });
}

export function shelfLines(entries: readonly ColumnEntry[], view: LineView): readonly ColumnLine[] {
  const lines: ColumnLine[] = [];
  for (const entry of entries) {
    if (entry.kind === 'line') lines.push({ kind: 'rule', key: entry.key });
    else if (entry.kind === 'pinned') lines.push({ kind: 'pinned', key: entry.key, count: entry.count });
    else if (entry.kind === 'folder') folderLines(entry, view, lines);
    else threadLines(entry.node, view, { depth: 0, decor: 'shelf', drop: entry.band === 'pinned' ? 'pinned' : 'loose' }, lines);
  }
  return lines;
}

export function groupLines(
  grouping: WorktreeGrouping,
  view: LineView,
  filter: string,
  models: ServedModels,
  open: (rootId: string) => boolean,
  creations: readonly WorktreeCreation[],
): readonly ColumnLine[] {
  const lines: ColumnLine[] = [];
  for (const group of grouping.groups) {
    const trees = view.filtering ? matchThreads(models, group.trees, filter) : group.trees;
    if (view.filtering && trees.length === 0) continue;
    const opened = open(group.row.rootId);
    lines.push({ kind: 'group', key: `group:${group.row.rootId}`, group, open: opened });
    if (opened) for (const node of trees) threadLines(node, view, { depth: 0, decor: 'group', drop: null, away: grouping.away }, lines);
  }
  const nowhere = view.filtering ? matchThreads(models, grouping.nowhere, filter) : grouping.nowhere;
  if (nowhere.length > 0) {
    lines.push({ kind: 'nowhere', key: 'nowhere', count: nowhere.length });
    for (const node of nowhere) threadLines(node, view, { depth: 0, decor: 'nowhere', drop: null }, lines);
  }
  for (const creation of creations) {
    lines.push({ kind: 'creating', key: `creating:${creation.id}`, creation });
    for (const node of grouping.creating.get(creation.id) ?? []) {
      threadLines(node, view, { depth: 0, decor: 'plain', drop: null }, lines);
    }
  }
  return lines;
}

const ESTIMATE: Readonly<Record<LineKind, number>> = {
  rule: 9,
  pinned: 28,
  folder: 26,
  empty: 24,
  thread: 26,
  stub: 24,
  away: 24,
  group: 32,
  nowhere: 30,
  creating: 40,
};

export function estimateOf(line: ColumnLine): number {
  if (line.kind !== 'thread') return ESTIMATE[line.kind];
  const state = line.node.life;
  return state === 'idle' && line.node.row.outcome === null ? ESTIMATE.thread : ESTIMATE.thread + 15;
}
