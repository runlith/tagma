import { match, terms } from '@runlith/search-text/match';
import type { ThreadListRow } from '@tagma/server/threads/contract/wire/list';
import type { ThreadFolder } from '@tagma/server/thread-record/contract/wire/folder';
import { isQuiet, TEAM_NAMED, type Team, type ThreadTreeNode, unseenFailure, unseenOutcome } from './forest.js';
import type { ServedModels } from '$lib/features/providers/served.js';
import { modelIdentity } from './native/modelWords.js';

export type RootBand = 'pinned' | 'live' | 'quiet';

export function rootBand(node: ThreadTreeNode): RootBand {
  if (node.row.pinnedAt !== null) return 'pinned';
  return isQuiet(node) ? 'quiet' : 'live';
}

export type Shelf = {
  readonly folders: readonly ThreadFolder[];
  readonly isOpen: (folderId: string) => boolean;
  readonly keepId: string | null;
  readonly filtering: boolean;
};

export function filedIn(node: ThreadTreeNode, folders: readonly ThreadFolder[]): string | null {
  const folderId = node.row.folderId ?? null;
  if (folderId === null || node.row.pinnedAt !== null) return null;
  return folders.some((folder) => folder.id === folderId) ? folderId : null;
}

type Grown = { readonly entry: FolderEntry; readonly trees: readonly ThreadTreeNode[] };

function shelved(roots: readonly ThreadTreeNode[], shelf: Shelf): readonly FolderEntry[] {
  const known = new Set(shelf.folders.map((folder) => folder.id));
  const below = new Map<string | null, ThreadFolder[]>();
  for (const folder of shelf.folders) {
    const parent = folder.parentId !== null && known.has(folder.parentId) ? folder.parentId : null;
    const siblings = below.get(parent);
    if (siblings === undefined) below.set(parent, [folder]);
    else siblings.push(folder);
  }
  const filed = new Map<string, ThreadTreeNode[]>();
  for (const node of roots) {
    const id = filedIn(node, shelf.folders);
    if (id === null) continue;
    const held = filed.get(id);
    if (held === undefined) filed.set(id, [node]);
    else held.push(node);
  }
  const keep = shelf.keepId;
  const kept = (node: ThreadTreeNode): boolean => keep !== null && holds(node, keep);
  const grow = (folder: ThreadFolder, depth: number, shown: boolean): Grown | null => {
    const members = filed.get(folder.id) ?? [];
    const open = shelf.filtering || shelf.isOpen(folder.id);
    const lit = shown && open;
    const subs = (below.get(folder.id) ?? []).flatMap((child) => grow(child, depth + 1, lit) ?? []);
    const trees = [...members, ...subs.flatMap((sub) => sub.trees)];
    if (shelf.filtering && trees.length === 0) return null;
    const folders = (lit ? subs : subs.filter((sub) => sub.trees.some(kept))).map((sub) => sub.entry);
    const entry: FolderEntry = {
      kind: 'folder',
      key: `folder:${folder.id}`,
      folder,
      depth,
      members,
      trees,
      folders,
      drawn: lit ? members : members.filter(kept),
      open,
      team: teamOver(trees),
    };
    return { entry, trees };
  };
  return (below.get(null) ?? []).flatMap((folder) => grow(folder, 0, true)?.entry ?? []);
}

export function columnEntries(roots: readonly ThreadTreeNode[], pinnedOpen: boolean, shelf?: Shelf): readonly ColumnEntry[] {
  const folders = shelf === undefined ? [] : shelved(roots, shelf);
  const loose = shelf === undefined ? roots : roots.filter((node) => filedIn(node, shelf.folders) === null);
  let held = 0;
  for (const node of loose) if (rootBand(node) === 'pinned') held += 1;
  const entries: ColumnEntry[] = [];
  let above: RootBand | 'folders' | null = null;
  let placed = folders.length === 0;
  const shelve = (): void => {
    if (placed) return;
    placed = true;
    if (above !== null) entries.push({ kind: 'line', key: 'line:folders' });
    entries.push(...folders);
    above = 'folders';
  };
  for (const node of loose) {
    const band = rootBand(node);
    if (band === 'quiet') shelve();
    if (band !== above) {
      if (band === 'pinned') entries.push({ kind: 'pinned', key: 'band:pinned', count: held });
      else if (above !== null) entries.push({ kind: 'line', key: `line:${band}` });
      above = band;
    }
    if (band === 'pinned' && !pinnedOpen && isQuiet(node)) continue;
    entries.push({ kind: 'root', key: node.row.id, node, band });
  }
  shelve();
  return entries;
}

export type FolderEntry = {
  readonly kind: 'folder';
  readonly key: string;
  readonly folder: ThreadFolder;
  readonly depth: number;
  readonly members: readonly ThreadTreeNode[];
  readonly trees: readonly ThreadTreeNode[];
  readonly folders: readonly FolderEntry[];
  readonly drawn: readonly ThreadTreeNode[];
  readonly open: boolean;
  readonly team: Team;
};

export type ColumnEntry =
  | { readonly kind: 'pinned'; readonly key: string; readonly count: number }
  | { readonly kind: 'line'; readonly key: string }
  | { readonly kind: 'root'; readonly key: string; readonly node: ThreadTreeNode; readonly band: RootBand }
  | FolderEntry;

export function nextWaiting(
  nodes: readonly ThreadTreeNode[],
  fromId: string | null,
  keepId: string | null = null,
): readonly ThreadTreeNode[] | null {
  let passed = fromId === null;
  let first: readonly ThreadTreeNode[] | null = null;
  let next: readonly ThreadTreeNode[] | null = null;
  const walk = (node: ThreadTreeNode, above: readonly ThreadTreeNode[]): void => {
    if (next !== null) return;
    const path = [...above, node];
    if (node.life === 'awaiting') {
      first ??= path;
      if (passed) next = path;
    }
    if (node.row.id === fromId) passed = true;
    const fold = foldTeam(node.children, keepId);
    for (const child of [...fold.live, ...fold.pinned, ...fold.finished]) walk(child, path);
  };
  for (const node of nodes) walk(node, []);
  return next ?? first;
}

export function matchThreads(models: ServedModels, nodes: readonly ThreadTreeNode[], query: string): readonly ThreadTreeNode[] {
  if (terms(query).length === 0) return nodes;
  const project = (siblings: readonly ThreadTreeNode[]): ThreadTreeNode[] => {
    const result: ThreadTreeNode[] = [];
    for (const node of siblings) {
      const children = project(node.children);
      const row = node.row;
      const target = { name: row.title, prose: true, names: [row.name, row.agentId, row.profileId, modelIdentity(models, row)] };
      if (children.length > 0 || match(query, target) !== null) result.push({ ...node, children });
    }
    return result;
  };
  return project(nodes);
}

export function folderSubtrees(folders: readonly ThreadFolder[], roots: readonly string[]): ReadonlySet<string> {
  const below = new Map<string, string[]>();
  for (const folder of folders) {
    if (folder.parentId === null) continue;
    const siblings = below.get(folder.parentId);
    if (siblings === undefined) below.set(folder.parentId, [folder.id]);
    else siblings.push(folder.id);
  }
  const reached = new Set<string>();
  const queue = [...roots];
  for (let id = queue.pop(); id !== undefined; id = queue.pop()) {
    if (reached.has(id)) continue;
    reached.add(id);
    queue.push(...(below.get(id) ?? []));
  }
  return reached;
}

export function folderChain(folders: readonly ThreadFolder[], id: string): readonly string[] {
  const chain: string[] = [];
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  for (let at = byId.get(id); at !== undefined && !chain.includes(at.id); at = at.parentId === null ? undefined : byId.get(at.parentId)) {
    chain.unshift(at.id);
  }
  return chain;
}

export type FolderLine = { readonly folder: ThreadFolder; readonly depth: number; readonly path: string };

export function folderOutline(folders: readonly ThreadFolder[]): readonly FolderLine[] {
  const known = new Set(folders.map((folder) => folder.id));
  const below = new Map<string | null, ThreadFolder[]>();
  for (const folder of folders) {
    const parent = folder.parentId !== null && known.has(folder.parentId) ? folder.parentId : null;
    const siblings = below.get(parent);
    if (siblings === undefined) below.set(parent, [folder]);
    else siblings.push(folder);
  }
  const lines: FolderLine[] = [];
  const walk = (parent: string | null, depth: number, above: string): void => {
    for (const folder of below.get(parent) ?? []) {
      const path = above === '' ? folder.name : `${above} / ${folder.name}`;
      lines.push({ folder, depth, path });
      walk(folder.id, depth + 1, path);
    }
  };
  walk(null, 0, '');
  return lines;
}

export function matchShelf(
  models: ServedModels,
  nodes: readonly ThreadTreeNode[],
  folders: readonly ThreadFolder[],
  query: string,
): readonly ThreadTreeNode[] {
  const matched = matchThreads(models, nodes, query);
  const named = folderSubtrees(
    folders,
    terms(query).length === 0 ? [] : folders.filter((folder) => match(query, { name: folder.name }) !== null).map((folder) => folder.id),
  );
  if (named.size === 0) return matched;
  const hits = new Map(matched.map((node) => [node.row.id, node]));
  return nodes.flatMap((node) => {
    const hit = hits.get(node.row.id);
    if (hit !== undefined) return [hit];
    const folderId = filedIn(node, folders);
    return folderId !== null && named.has(folderId) ? [node] : [];
  });
}

export type TeamFold = {
  readonly standing: readonly ThreadTreeNode[];
  readonly live: readonly ThreadTreeNode[];
  readonly moreWorking: readonly ThreadTreeNode[];
  readonly pinned: readonly ThreadTreeNode[];
  readonly finished: readonly ThreadTreeNode[];
  readonly kept: ThreadTreeNode | null;
};

export const WORKING_SHOWN = 5;

export function foldTeam(children: readonly ThreadTreeNode[], keepId: string | null = null): TeamFold {
  const standing: ThreadTreeNode[] = [];
  const live: ThreadTreeNode[] = [];
  const moreWorking: ThreadTreeNode[] = [];
  const finished: ThreadTreeNode[] = [];
  const pinned: ThreadTreeNode[] = [];
  let kept: ThreadTreeNode | null = null;
  let working = 0;
  for (const child of children) {
    if (!stands(child)) {
      if (child.row.pinnedAt !== null || child.team.pinned > 0) {
        pinned.push(child);
        continue;
      }
      finished.push(child);
      if (keepId !== null && holds(child, keepId)) kept = child;
      continue;
    }
    live.push(child);
    if (plainWorking(child)) {
      if (working >= WORKING_SHOWN) {
        moreWorking.push(child);
        continue;
      }
      working += 1;
    }
    standing.push(child);
  }
  return { standing, live, moreWorking, pinned, finished, kept };
}

function holds(node: ThreadTreeNode, id: string): boolean {
  return node.row.id === id || node.children.some((child) => holds(child, id));
}

export function stands(node: ThreadTreeNode): boolean {
  return !isQuiet(node) || unseenFailure(node.row, node.life) !== null || node.team.failed + node.team.cut > 0;
}

function plainWorking(node: ThreadTreeNode): boolean {
  return node.life === 'working' && node.team.asking === 0 && node.team.failed === 0 && node.team.cut === 0;
}

function teamOver(trees: readonly ThreadTreeNode[]): Team {
  let working = 0;
  let asking = 0;
  let failed = 0;
  let cut = 0;
  let unseen = 0;
  let pinned = 0;
  let size = 0;
  const workers: string[] = [];
  for (const tree of trees) {
    const failure = unseenFailure(tree.row, tree.life);
    if (unseenOutcome(tree.row, tree.life)) unseen += 1;
    if (tree.life === 'working') {
      working += 1;
      workers.push(tree.row.name ?? tree.row.agentId);
    } else if (tree.life === 'awaiting') asking += 1;
    else if (failure === 'failed') failed += 1;
    else if (failure === 'cut') cut += 1;
    working += tree.team.working;
    asking += tree.team.asking;
    failed += tree.team.failed;
    cut += tree.team.cut;
    unseen += tree.team.unseen;
    pinned += (tree.row.pinnedAt !== null ? 1 : 0) + tree.team.pinned;
    size += 1 + tree.team.size;
    workers.push(...tree.team.workers);
  }
  return { working, asking, failed, cut, unseen, pinned, size, workers: workers.slice(0, TEAM_NAMED) };
}

export function nodeIndex(...forests: readonly (readonly ThreadTreeNode[])[]): ReadonlyMap<string, ThreadTreeNode> {
  const byId = new Map<string, ThreadTreeNode>();
  const walk = (node: ThreadTreeNode): void => {
    byId.set(node.row.id, node);
    for (const child of node.children) walk(child);
  };
  for (const forest of forests) for (const node of forest) walk(node);
  return byId;
}

export function rootIn(byId: ReadonlyMap<string, ThreadTreeNode>, id: string): ThreadTreeNode | undefined {
  let node = byId.get(id);
  for (let hops = 0; node?.row.parentThreadId && hops < byId.size; hops += 1) {
    const parent = byId.get(node.row.parentThreadId);
    if (parent === undefined) break;
    node = parent;
  }
  return node;
}
