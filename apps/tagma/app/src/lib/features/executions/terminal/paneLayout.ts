export type SplitDirection = 'row' | 'column';

export type DropZone = 'left' | 'right' | 'top' | 'bottom';

export type PaneNode =
  | { readonly kind: 'pane'; readonly id: string }
  | {
      readonly kind: 'split';
      readonly direction: SplitDirection;
      readonly children: readonly [PaneNode, PaneNode];
      readonly ratio: number;
    };

export type SplitPath = readonly number[];

export const paneNode = (id: string): PaneNode => ({ kind: 'pane', id });

export const splitNode = (direction: SplitDirection, first: PaneNode, second: PaneNode, ratio = 0.5): PaneNode => ({
  kind: 'split',
  direction,
  children: [first, second],
  ratio,
});

export function zoneDirection(zone: DropZone): SplitDirection {
  return zone === 'left' || zone === 'right' ? 'row' : 'column';
}

export function paneIds(node: PaneNode): string[] {
  if (node.kind === 'pane') return [node.id];
  return [...paneIds(node.children[0]), ...paneIds(node.children[1])];
}

export function paneCount(node: PaneNode): number {
  return node.kind === 'pane' ? 1 : paneCount(node.children[0]) + paneCount(node.children[1]);
}

export function hasPane(node: PaneNode, id: string): boolean {
  if (node.kind === 'pane') return node.id === id;
  return hasPane(node.children[0], id) || hasPane(node.children[1], id);
}

export function nodeAt(node: PaneNode, path: SplitPath): PaneNode | null {
  let current: PaneNode = node;
  for (const step of path) {
    if (current.kind !== 'split' || (step !== 0 && step !== 1)) return null;
    current = current.children[step];
  }
  return current;
}

export function insertBeside(root: PaneNode, targetId: string, newId: string, zone: DropZone, ratio = 0.5): PaneNode {
  const direction = zoneDirection(zone);
  const first = zone === 'left' || zone === 'top';
  return replacePane(root, targetId, (target) =>
    first ? splitNode(direction, paneNode(newId), target, ratio) : splitNode(direction, target, paneNode(newId), ratio),
  );
}

export function splitPane(root: PaneNode, targetId: string, newId: string, direction: SplitDirection, ratio = 0.5): PaneNode {
  return insertBeside(root, targetId, newId, direction === 'row' ? 'right' : 'bottom', ratio);
}

export function removePane(root: PaneNode, id: string): PaneNode | null {
  if (root.kind === 'pane') return root.id === id ? null : root;
  const first = removePane(root.children[0], id);
  const second = removePane(root.children[1], id);
  if (first === null) return second;
  if (second === null) return first;
  if (first === root.children[0] && second === root.children[1]) return root;
  return { ...root, children: [first, second] };
}

export function isMoveNoOp(root: PaneNode, sourceId: string, targetId: string, zone: DropZone): boolean {
  if (sourceId === targetId) return true;
  const parent = parentOf(root, targetId);
  if (parent === null) return false;
  const at = parent.children.findIndex((child) => child.kind === 'pane' && child.id === targetId);
  const other = parent.children[at === 0 ? 1 : 0];
  if (other === undefined || other.kind !== 'pane' || other.id !== sourceId) return false;
  if (zoneDirection(zone) !== parent.direction) return false;
  return zone === 'right' || zone === 'bottom' ? at === 0 : at === 1;
}

export function movePane(root: PaneNode, sourceId: string, targetId: string, zone: DropZone): PaneNode {
  if (isMoveNoOp(root, sourceId, targetId, zone)) return root;
  const detached = removePane(root, sourceId);
  if (detached === null || !hasPane(detached, targetId)) return root;
  return insertBeside(detached, targetId, sourceId, zone);
}

export function equalise(node: PaneNode): PaneNode {
  if (node.kind === 'pane') return node;
  const first = equalise(node.children[0]);
  const second = equalise(node.children[1]);
  const left = axisWeight(first, node.direction);
  const right = axisWeight(second, node.direction);
  return { kind: 'split', direction: node.direction, children: [first, second], ratio: left / (left + right) };
}

export function setRatio(root: PaneNode, path: SplitPath, ratio: number): PaneNode {
  const [step, ...rest] = path;
  if (step === undefined) {
    if (root.kind !== 'split' || root.ratio === ratio) return root;
    return { ...root, ratio };
  }
  if (root.kind !== 'split' || (step !== 0 && step !== 1)) return root;
  const child = setRatio(root.children[step], rest, ratio);
  if (child === root.children[step]) return root;
  const children: [PaneNode, PaneNode] = step === 0 ? [child, root.children[1]] : [root.children[0], child];
  return { ...root, children };
}

export function neighbourPane(node: PaneNode, id: string, step: 1 | -1): string | null {
  const ids = paneIds(node);
  const at = ids.indexOf(id);
  if (at === -1) return ids[0] ?? null;
  return ids[(at + step + ids.length) % ids.length] ?? null;
}

export function sideFlex(node: Extract<PaneNode, { kind: 'split' }>, side: 0 | 1, expanded: string | null): string {
  if (expanded !== null && hasPane(node, expanded) && hasPane(node.children[side], expanded)) return '1 1 auto';
  return `${side === 0 ? node.ratio : 1 - node.ratio} 1 0%`;
}

export function sideHidden(node: Extract<PaneNode, { kind: 'split' }>, side: 0 | 1, expanded: string | null): boolean {
  return expanded !== null && hasPane(node, expanded) && !hasPane(node.children[side], expanded);
}

export function nearestZone(
  point: { readonly x: number; readonly y: number },
  rect: { readonly left: number; readonly top: number; readonly width: number; readonly height: number },
): DropZone {
  if (rect.width <= 0 || rect.height <= 0) return 'right';
  const across = (point.x - rect.left) / rect.width;
  const down = (point.y - rect.top) / rect.height;
  const distances: readonly (readonly [DropZone, number])[] = [
    ['top', down],
    ['bottom', 1 - down],
    ['left', across],
    ['right', 1 - across],
  ];
  return distances.reduce((nearest, entry) => (entry[1] < nearest[1] ? entry : nearest))[0];
}

export function zoneRect(
  rect: { readonly left: number; readonly top: number; readonly width: number; readonly height: number },
  zone: DropZone,
): { left: number; top: number; width: number; height: number } {
  const halfWidth = rect.width / 2;
  const halfHeight = rect.height / 2;
  return {
    left: rect.left + (zone === 'right' ? halfWidth : 0),
    top: rect.top + (zone === 'bottom' ? halfHeight : 0),
    width: zone === 'left' || zone === 'right' ? halfWidth : rect.width,
    height: zone === 'top' || zone === 'bottom' ? halfHeight : rect.height,
  };
}

function parentOf(node: PaneNode, id: string): Extract<PaneNode, { kind: 'split' }> | null {
  if (node.kind === 'pane') return null;
  for (const child of node.children) {
    if (child.kind === 'pane' && child.id === id) return node;
    const deeper = parentOf(child, id);
    if (deeper !== null) return deeper;
  }
  return null;
}

function axisWeight(node: PaneNode, direction: SplitDirection): number {
  if (node.kind === 'pane' || node.direction !== direction) return 1;
  return axisWeight(node.children[0], direction) + axisWeight(node.children[1], direction);
}

function replacePane(node: PaneNode, id: string, build: (target: PaneNode) => PaneNode): PaneNode {
  if (node.kind === 'pane') return node.id === id ? build(node) : node;
  const first = replacePane(node.children[0], id, build);
  const second = replacePane(node.children[1], id, build);
  if (first === node.children[0] && second === node.children[1]) return node;
  return { ...node, children: [first, second] };
}
