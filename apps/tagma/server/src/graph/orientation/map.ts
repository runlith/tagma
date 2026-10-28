import { blockName } from '../contract/wire/references.js';
import type { TagTable } from '../contract/wire/tags/table.js';
import { CONTAINER } from '../contract/wire/tags/container.js';

export type MapNode = {
  readonly id: number;
  readonly uuid: string;
  readonly parentId: number | null;
  readonly ord: number;
  readonly title: string;
  readonly kind: string | null;
  readonly places: readonly string[];
};

export type MapRow = {
  readonly id: number;
  readonly uuid: string;
  readonly parentId: number | null;
  readonly ord: number;
  readonly tags: readonly string[];
  readonly title: string;
  readonly superseded: number;
};

export function drawsRegion(table: TagTable, row: MapRow): boolean {
  return row.superseded === 0 && table.supports(row, CONTAINER);
}

export function regionAbove(
  rows: readonly MapRow[],
  nodes: readonly MapNode[],
  rootId: number,
  blockId: number | null,
): number | undefined {
  return nearestRegion(new Map(rows.map((row) => [row.id, row])), new Set(nodes.map((node) => node.id)), rootId, blockId);
}

function nearestRegion(
  byId: ReadonlyMap<number, MapRow>,
  drawn: ReadonlySet<number>,
  rootId: number,
  blockId: number | null,
): number | undefined {
  const climbed = new Set<number>();
  for (let at = blockId; at !== null && at !== rootId;) {
    if (climbed.has(at)) return undefined;
    climbed.add(at);
    if (drawn.has(at)) return at;
    const row = byId.get(at);
    if (row === undefined) return undefined;
    at = row.parentId;
  }
  return undefined;
}

function regions(byId: ReadonlyMap<number, MapRow>, table: TagTable, rootId: number): ReadonlySet<number> {
  const drawn = new Set<number>();
  for (const row of byId.values()) {
    if (!drawsRegion(table, row)) continue;
    drawn.add(row.id);
    const pages: number[] = [];
    const climbed = new Set<number>([row.id]);
    for (let at = row.parentId; at !== null && at !== rootId && !drawn.has(at);) {
      const up = byId.get(at);
      if (up === undefined || climbed.has(at)) {
        pages.length = 0;
        break;
      }
      climbed.add(at);
      if (drawsRegion(table, up)) break;
      if (up.superseded === 0 && up.tags.length === 0) pages.push(at);
      at = up.parentId;
    }
    for (const page of pages) drawn.add(page);
  }
  return drawn;
}

export function mapNodes(
  table: TagTable,
  rows: readonly MapRow[],
  rootId: number,
  places: ReadonlyMap<number, readonly string[]>,
  kinds: ReadonlyMap<number, string> = new Map(),
): MapNode[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const drawn = regions(byId, table, rootId);
  const above = new Map<number, number | null>();
  const parentOf = (row: MapRow): number | null => {
    const known = above.get(row.id);
    if (known !== undefined) return known;
    const found = nearestRegion(byId, drawn, rootId, row.parentId) ?? null;
    above.set(row.id, found);
    return found;
  };
  return rows
    .filter((row) => drawn.has(row.id))
    .map((row) => ({
      id: row.id,
      uuid: row.uuid,
      parentId: parentOf(row),
      ord: row.ord,
      title: row.title,
      kind: kinds.get(row.id) ?? null,
      places: places.get(row.id) ?? [],
    }));
}

export type MapCut = { readonly lines: readonly string[]; readonly left: number };

export const mapHeading = (left: number, focus?: string): string => {
  const drawn =
    focus === undefined
      ? 'every region by name — read_block one for what it is, the directories it draws'
      : `${focus} whole with the directories it draws, and every other region by name`;
  return left === 0
    ? `Map — ${drawn}:`
    : `Map — ${drawn}; ${left} more did not fit this project's map budget, inside the \`(+N)\` cuts and below them:`;
};

const cut = (left: number): string => (left === 0 ? '' : ` (+${left})`);

function breadth(children: ReadonlyMap<number | null, readonly MapNode[]>): MapNode[] {
  const order: MapNode[] = [];
  const seen = new Set<number>();
  let level: readonly MapNode[] = children.get(null) ?? [];
  while (level.length > 0) {
    const next: MapNode[] = [];
    for (const node of level) {
      if (seen.has(node.id)) continue;
      seen.add(node.id);
      order.push(node);
      next.push(...(children.get(node.id) ?? []));
    }
    level = next;
  }
  return order;
}

function outline(node: MapNode, children: ReadonlyMap<number | null, readonly MapNode[]>, seen: Set<number> = new Set()): MapNode[] {
  if (seen.has(node.id)) return [];
  seen.add(node.id);
  return [node, ...(children.get(node.id) ?? []).flatMap((kid) => outline(kid, children, seen))];
}

export function mapLines(nodes: readonly MapNode[], budget: number, focus?: number): MapCut {
  const children = new Map<number | null, MapNode[]>();
  for (const node of nodes) {
    const siblings = children.get(node.parentId);
    if (siblings === undefined) children.set(node.parentId, [node]);
    else siblings.push(node);
  }
  for (const list of children.values()) list.sort((a, b) => a.ord - b.ord);
  const byId = new Map(nodes.map((node) => [node.id, node]));

  const order: MapNode[] = [];
  const queued = new Set<number>();
  const offer = (node: MapNode): void => {
    if (queued.has(node.id)) return;
    queued.add(node.id);
    order.push(node);
  };
  const aimed = focus === undefined ? undefined : byId.get(focus);
  if (aimed !== undefined) {
    const above: MapNode[] = [];
    const climbed = new Set<number>([aimed.id]);
    for (let up = aimed.parentId === null ? undefined : byId.get(aimed.parentId); up !== undefined;) {
      if (climbed.has(up.id)) break;
      climbed.add(up.id);
      above.unshift(up);
      up = up.parentId === null ? undefined : byId.get(up.parentId);
    }
    for (const node of above) offer(node);
    for (const node of outline(aimed, children)) offer(node);
  }
  const opened = new Set(queued);
  for (const node of breadth(children)) offer(node);

  const depths = new Map<number, number>();
  const depthOf = (node: MapNode): number => {
    const known = depths.get(node.id);
    if (known !== undefined) return known;
    const parent = node.parentId === null ? undefined : byId.get(node.parentId);
    const depth = parent === undefined ? 0 : depthOf(parent) + 1;
    depths.set(node.id, depth);
    return depth;
  };
  const bodyOf = (node: MapNode): string =>
    `${'  '.repeat(depthOf(node))}- ${blockName(node.uuid)} ${node.title}` +
    `${node.kind === null ? '' : ` · ${node.kind}`}` +
    `${!opened.has(node.id) || node.places.length === 0 ? '' : ` · ${node.places.join(', ')}`}`;

  const shown = new Set<number>();
  const held = new Map<number, number>(nodes.map((node) => [node.id, (children.get(node.id) ?? []).length]));
  let spent = 0;
  for (const node of order) {
    if (node.parentId !== null && !shown.has(node.parentId)) continue;
    const back = node.parentId === null ? 0 : (held.get(node.parentId) as number);
    const price =
      bodyOf(node).length +
      cut(held.get(node.id) as number).length +
      (shown.size === 0 ? 0 : 1) +
      (node.parentId === null ? 0 : cut(back - 1).length - cut(back).length);
    if (spent + price > budget) continue;
    spent += price;
    shown.add(node.id);
    if (node.parentId !== null) held.set(node.parentId, back - 1);
  }

  const lines: string[] = [];
  const draw = (parentId: number | null): void => {
    for (const node of children.get(parentId) ?? []) {
      if (!shown.has(node.id)) continue;
      lines.push(`${bodyOf(node)}${cut(held.get(node.id) as number)}`);
      draw(node.id);
    }
  };
  draw(null);
  return { lines, left: nodes.length - shown.size };
}
