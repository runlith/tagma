export type SimNode = {
  name: string;
  depth: number;
  r: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  fx: number | null;
  fy: number | null;
};

export type SimLinkKind = 'tree' | 'edge' | 'ref';
export type SimLink = { from: SimNode; to: SimNode; kind: SimLinkKind; rest: number };

const RADII = [22, 14, 8, 4.5, 3.5] as const;

const LABEL_CLEARANCE = 32;

const NODE_PADDING = 2;

const LINK_STRENGTH: Record<SimLinkKind, number> = { tree: 0.4, edge: 0.006, ref: 0.002 };
const REPULSION = 13;
const CENTER_PULL = 0.0035;
const DAMPING = 0.75;
const MIN_DISTANCE2 = 100;
const THETA2 = 0.81;
const SEPARATION_CEILING = 600;

export function radiusOf(depth: number): number {
  return RADII[Math.min(depth, RADII.length - 1)] ?? 3.5;
}

export function branchRadii(
  rootName: string | null,
  childrenNames: (name: string) => readonly string[],
  radiusOfName: (name: string) => number,
): Map<string, number> {
  const radii = new Map<string, number>();
  const walk = (name: string): number => {
    const r = radiusOfName(name);
    let extent = r;
    for (const child of childrenNames(name)) {
      const branch = walk(child);
      extent = Math.max(extent, restFor({ r }, branch) + branch);
    }
    radii.set(name, extent);
    return extent;
  };
  if (rootName !== null) walk(rootName);
  return radii;
}

export function restFor(parent: { r: number }, childBranch: number): number {
  return parent.r + childBranch + LABEL_CLEARANCE;
}

const GOLDEN = Math.PI * (3 - Math.sqrt(5));

export function seedAround(parent: { x: number; y: number } | undefined, index: number, orbit: number): { x: number; y: number } {
  const angle = GOLDEN * (index + 1);
  const cx = parent?.x ?? 0;
  const cy = parent?.y ?? 0;
  return { x: cx + Math.cos(angle) * orbit, y: cy + Math.sin(angle) * orbit };
}

type Quad = {
  x: number;
  y: number;
  half: number;
  mass: number;
  cx: number;
  cy: number;
  body: SimNode | null;
  kids: (Quad | null)[] | null;
};

function quadOf(x: number, y: number, half: number): Quad {
  return { x, y, half, mass: 0, cx: 0, cy: 0, body: null, kids: null };
}

function insert(quad: Quad, node: SimNode, depth: number): void {
  if (quad.body === null && quad.kids === null && quad.mass === 0) {
    quad.body = node;
    quad.mass = node.r;
    quad.cx = node.x;
    quad.cy = node.y;
    return;
  }
  const mass = quad.mass + node.r;
  quad.cx = (quad.cx * quad.mass + node.x * node.r) / mass;
  quad.cy = (quad.cy * quad.mass + node.y * node.r) / mass;
  quad.mass = mass;
  if (depth > 24) return;
  if (quad.kids === null) {
    quad.kids = [null, null, null, null];
    const resident = quad.body;
    quad.body = null;
    if (resident) place(quad, resident, depth);
  }
  place(quad, node, depth);
}

function place(quad: Quad, node: SimNode, depth: number): void {
  const east = node.x >= quad.x;
  const south = node.y >= quad.y;
  const index = (south ? 2 : 0) + (east ? 1 : 0);
  const half = quad.half / 2;
  let kid = quad.kids?.[index] ?? null;
  if (!kid) {
    kid = quadOf(quad.x + (east ? half : -half), quad.y + (south ? half : -half), half);
    if (quad.kids) quad.kids[index] = kid;
  }
  insert(kid, node, depth + 1);
}

function repel(quad: Quad, node: SimNode, alpha: number): void {
  if (quad.mass === 0 || quad.body === node) return;
  const dx = quad.cx - node.x;
  const dy = quad.cy - node.y;
  const d2 = Math.max(dx * dx + dy * dy, MIN_DISTANCE2);
  const size = quad.half * 2;
  if (quad.kids !== null && (size * size) / d2 >= THETA2) {
    for (const kid of quad.kids) if (kid) repel(kid, node, alpha);
    return;
  }
  const d = Math.sqrt(d2);
  const force = (REPULSION * node.r * quad.mass * alpha) / d2;
  node.vx -= (dx / d) * force;
  node.vy -= (dy / d) * force;
}

export function tick(nodes: SimNode[], links: SimLink[], alpha: number): void {
  if (nodes.length > 1) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const node of nodes) {
      minX = Math.min(minX, node.x);
      minY = Math.min(minY, node.y);
      maxX = Math.max(maxX, node.x);
      maxY = Math.max(maxY, node.y);
    }
    const half = Math.max(maxX - minX, maxY - minY, 1) / 2 + 1;
    const root = quadOf((minX + maxX) / 2, (minY + maxY) / 2, half);
    for (const node of nodes) insert(root, node, 0);
    for (const node of nodes) repel(root, node, alpha);
  }

  const degree = new Map<string, number>();
  for (const link of links) {
    degree.set(link.from.name, (degree.get(link.from.name) ?? 0) + 1);
    degree.set(link.to.name, (degree.get(link.to.name) ?? 0) + 1);
  }
  for (const link of links) {
    const dx = link.to.x - link.from.x;
    const dy = link.to.y - link.from.y;
    const d = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
    const degFrom = degree.get(link.from.name) ?? 1;
    const degTo = degree.get(link.to.name) ?? 1;
    const strength = LINK_STRENGTH[link.kind] / Math.min(degFrom, degTo);
    const stretch = ((d - link.rest) / d) * strength * alpha;
    const bias = degFrom / (degFrom + degTo);
    link.from.vx += dx * stretch * (1 - bias);
    link.from.vy += dy * stretch * (1 - bias);
    link.to.vx -= dx * stretch * bias;
    link.to.vy -= dy * stretch * bias;
  }

  for (const node of nodes) {
    node.vx -= node.x * CENTER_PULL * alpha;
    node.vy -= node.y * CENTER_PULL * alpha;
    if (node.fx !== null && node.fy !== null) {
      node.x = node.fx;
      node.y = node.fy;
      node.vx = 0;
      node.vy = 0;
      continue;
    }
    node.vx *= DAMPING;
    node.vy *= DAMPING;
    node.x += node.vx;
    node.y += node.vy;
  }

  if (nodes.length <= SEPARATION_CEILING) separate(nodes);
}

function separate(nodes: SimNode[]): void {
  for (let pass = 0; pass < 2; pass += 1) {
    for (let i = 0; i < nodes.length; i += 1) {
      const a = nodes[i];
      if (!a) continue;
      for (let j = i + 1; j < nodes.length; j += 1) {
        const b = nodes[j];
        if (!b) continue;
        const need = a.r + b.r + NODE_PADDING;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= need * need || d2 === 0) continue;
        const d = Math.sqrt(d2);
        const push = (need - d) / d / 2;
        const px = dx * push;
        const py = dy * push;
        if (a.fx === null) {
          a.x -= px;
          a.y -= py;
        }
        if (b.fx === null) {
          b.x += px;
          b.y += py;
        }
      }
    }
  }
}
