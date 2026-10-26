export type FileCost = {
  readonly wallMs: number;
  readonly worlds: readonly string[];
};

export type WorldCost = {
  readonly builds: number;
  readonly buildMs: number;
};

export type Costs = {
  readonly files: ReadonlyMap<string, FileCost>;
  readonly worlds: ReadonlyMap<string, WorldCost>;
};

export type ChunkPlanInput = {
  readonly files: readonly string[];
  readonly costs: Costs;
  readonly lifeMs: number;
  readonly jobs: number;
  readonly filesPerFallbackChunk: number;
};

export type Chunk = {
  readonly world: string | null;
  readonly files: readonly string[];
};

const HEAVY_WORLD_MS = 500;
const LIFE_SHARE = 0.5;

type ReportRow = {
  readonly type?: unknown;
  readonly file?: unknown;
  readonly kind?: unknown;
  readonly built?: unknown;
  readonly own?: unknown;
  readonly cost?: { readonly cpu?: unknown };
  readonly total?: { readonly wall?: unknown };
};

const number = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

export const costsOf = (rows: Iterable<ReportRow>): Costs => {
  const walls = new Map<string, number>();
  const kinds = new Map<string, Set<string>>();
  const worlds = new Map<string, { builds: number; buildMs: number }>();
  for (const row of rows) {
    if (typeof row.file !== 'string') continue;
    if (row.type === 'file') walls.set(row.file, Math.max(walls.get(row.file) ?? 0, number(row.total?.wall)));
    if (row.type !== 'world' || typeof row.kind !== 'string' || (row.own !== null && row.own !== undefined)) continue;
    kinds.set(row.file, (kinds.get(row.file) ?? new Set()).add(row.kind));
    if (row.built !== true) continue;
    const standing = worlds.get(row.kind) ?? { builds: 0, buildMs: 0 };
    standing.builds += 1;
    standing.buildMs += number(row.cost?.cpu);
    worlds.set(row.kind, standing);
  }
  const files = new Map<string, FileCost>();
  for (const [file, wallMs] of walls) files.set(file, { wallMs, worlds: [...(kinds.get(file) ?? [])].sort() });
  return { files, worlds };
};

const perBuild = (costs: Costs, kind: string): number => {
  const world = costs.worlds.get(kind);
  return world === undefined || world.builds === 0 ? 0 : world.buildMs / world.builds;
};

const heaviestWorld = (costs: Costs, cost: FileCost): string | null => {
  let best: string | null = null;
  let bestMs = HEAVY_WORLD_MS;
  for (const kind of cost.worlds) {
    const ms = perBuild(costs, kind);
    if (ms >= bestMs) {
      best = kind;
      bestMs = ms;
    }
  }
  return best;
};

export const planChunks = (input: ChunkPlanInput): Chunk[] => {
  if (!Number.isInteger(input.jobs) || input.jobs < 1) throw new Error('jobs must be a positive integer');
  if (!Number.isInteger(input.filesPerFallbackChunk) || input.filesPerFallbackChunk < 1)
    throw new Error('filesPerFallbackChunk must be a positive integer');
  const budget = input.lifeMs * LIFE_SHARE * input.jobs;
  const files = [...new Set(input.files)].sort();
  const groups = new Map<string, string[]>();
  const light: string[] = [];
  const unknown: string[] = [];
  for (const file of files) {
    const cost = input.costs.files.get(file);
    if (cost === undefined) {
      unknown.push(file);
      continue;
    }
    const world = heaviestWorld(input.costs, cost);
    if (world === null) light.push(file);
    else groups.set(world, [...(groups.get(world) ?? []), file]);
  }
  const wallOf = (file: string): number => input.costs.files.get(file)?.wallMs ?? 0;
  const byCost = (a: string, b: string): number => wallOf(b) - wallOf(a) || a.localeCompare(b);
  const chunks: { world: string | null; files: string[]; used: number }[] = [];
  for (const world of [...groups.keys()].sort()) {
    const open = { world, files: [] as string[], used: perBuild(input.costs, world) * input.jobs };
    for (const file of groups.get(world)!.sort(byCost)) {
      if (open.files.length > 0 && open.used + wallOf(file) > budget) {
        chunks.push({ ...open });
        open.files = [];
        open.used = perBuild(input.costs, world) * input.jobs;
      }
      open.files.push(file);
      open.used += wallOf(file);
    }
    chunks.push(open);
  }
  for (const file of light.sort(byCost)) {
    const room = chunks.filter((chunk) => chunk.used + wallOf(file) <= budget).sort((a, b) => a.used - b.used)[0];
    if (room !== undefined) {
      room.files.push(file);
      room.used += wallOf(file);
    } else chunks.push({ world: null, files: [file], used: wallOf(file) });
  }
  const fallback = Math.ceil(unknown.length / input.filesPerFallbackChunk);
  for (let at = 0; at < fallback; at++) chunks.push({ world: null, files: unknown.filter((_, index) => index % fallback === at), used: 0 });
  return chunks.map(({ world, files }) => ({ world, files: [...files].sort() }));
};
