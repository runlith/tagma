import { paneIds, paneNode, removePane, type PaneNode } from '../terminal/paneLayout.js';

export type StoredTab = {
  readonly title: string | null;
  readonly tree: PaneNode;
  readonly labels: Readonly<Record<string, string>>;
  readonly active: string | null;
  readonly holder: string | null;
};

export type StoredLayout = {
  readonly order: readonly string[];
  readonly tabs: Readonly<Record<string, StoredTab>>;
  readonly closed: readonly StoredTab[];
  readonly shown: boolean;
  readonly active: string | null;
};

export type StoredWorktrees = {
  readonly places: Readonly<Record<string, StoredLayout>>;
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

function isStoredTree(node: unknown): node is PaneNode {
  if (!isRecord(node)) return false;
  if (node.kind === 'pane') return typeof node.id === 'string';
  if (node.kind !== 'split') return false;
  if (node.direction !== 'row' && node.direction !== 'column') return false;
  if (typeof node.ratio !== 'number' || !(node.ratio > 0) || !(node.ratio < 1)) return false;
  return Array.isArray(node.children) && node.children.length === 2 && isStoredTree(node.children[0]) && isStoredTree(node.children[1]);
}

function parseStoredTab(tab: unknown): StoredTab | null {
  if (!isRecord(tab)) return null;
  if (!isStoredTree(tab.tree)) return null;
  const labels: Record<string, string> = {};
  if (isRecord(tab.labels)) {
    for (const [leaf, label] of Object.entries(tab.labels)) {
      if (typeof label === 'string' && label !== '') labels[leaf] = label;
    }
  }
  const active = typeof tab.active === 'string' && paneIds(tab.tree).includes(tab.active) ? tab.active : null;
  return {
    title: typeof tab.title === 'string' && tab.title !== '' ? tab.title : null,
    tree: tab.tree,
    labels,
    active,
    holder: typeof tab.holder === 'string' && tab.holder !== '' ? tab.holder : null,
  };
}

export function parseStoredLayout(value: unknown): StoredLayout | null {
  if (!isRecord(value)) return null;
  if (!Array.isArray(value.order) || !value.order.every((key) => typeof key === 'string')) return null;
  if (!isRecord(value.tabs)) return null;
  const tabs: Record<string, StoredTab> = {};
  for (const [key, tab] of Object.entries(value.tabs)) {
    const parsed = parseStoredTab(tab);
    if (parsed !== null) tabs[key] = parsed;
  }
  const closed: StoredTab[] = [];
  if (Array.isArray(value.closed)) {
    for (const tab of value.closed) {
      const parsed = parseStoredTab(tab);
      if (parsed !== null) closed.push(parsed);
    }
  }
  return {
    order: value.order,
    tabs,
    closed,
    shown: value.shown === true,
    active: typeof value.active === 'string' ? value.active : null,
  };
}

export function parseStoredWorktrees(value: unknown): Map<string, StoredLayout> {
  const worktrees = new Map<string, StoredLayout>();
  if (!isRecord(value) || !isRecord(value.places)) return worktrees;
  for (const [rootId, layout] of Object.entries(value.places)) {
    const parsed = parseStoredLayout(layout);
    if (parsed !== null) worktrees.set(rootId, parsed);
  }
  return worktrees;
}

export function storedLeafTabs(stored: StoredLayout): Map<string, string> {
  const owners = new Map<string, string>();
  for (const [key, tab] of Object.entries(stored.tabs)) {
    for (const leaf of paneIds(tab.tree)) {
      if (!owners.has(leaf)) owners.set(leaf, key);
    }
  }
  return owners;
}

export function planAdopt(execKeys: readonly string[], stored: StoredLayout | null): { key: string; leaves: string[] }[] {
  if (stored === null) return execKeys.map((key) => ({ key, leaves: [key] }));
  const owners = storedLeafTabs(stored);
  const groups = new Map<string, string[]>();
  const seen: string[] = [];
  for (const exec of execKeys) {
    const key = owners.get(exec) ?? exec;
    const leaves = groups.get(key);
    if (leaves === undefined) {
      groups.set(key, [exec]);
      seen.push(key);
    } else if (!leaves.includes(exec)) {
      leaves.push(exec);
    }
  }
  const known = stored.order.filter((key) => groups.has(key));
  for (const key of seen) {
    if (!known.includes(key)) known.push(key);
  }
  return known.map((key) => ({ key, leaves: groups.get(key) ?? [] }));
}

export function pruneStoredTree(tree: PaneNode, live: ReadonlySet<string>): PaneNode | null {
  let pruned: PaneNode | null = tree;
  for (const leaf of paneIds(tree)) {
    if (pruned !== null && !live.has(leaf)) pruned = removePane(pruned, leaf);
  }
  return pruned;
}

export function serializeTab(
  layout: PaneNode,
  execOf: (paneId: string) => string | null,
  labelOf: (paneId: string) => string | null,
  title: string | null,
  active: string | null,
  holder: string | null,
): StoredTab | null {
  const convert = (node: PaneNode): PaneNode | null => {
    if (node.kind === 'pane') {
      const exec = execOf(node.id);
      return exec === null ? null : paneNode(exec);
    }
    const first = convert(node.children[0]);
    const second = convert(node.children[1]);
    if (first === null) return second;
    if (second === null) return first;
    return { ...node, children: [first, second] };
  };
  const tree = convert(layout);
  if (tree === null) return null;
  const labels: Record<string, string> = {};
  for (const leaf of paneIds(layout)) {
    const exec = execOf(leaf);
    const label = labelOf(leaf);
    if (exec !== null && label !== null && label !== '') labels[exec] = label;
  }
  return { title, tree, labels, active: active === null ? null : execOf(active), holder };
}
