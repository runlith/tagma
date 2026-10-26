import { and, eq, inArray, like, or, sql } from 'drizzle-orm';
import { Effect } from 'effect';
import { GraphStore } from '../../platform/contract/service/store.js';
import { writes } from '../../platform/contract/service/writes.js';
import { SPOKEN_LENGTH } from '../../platform/contract/wire/ids.js';
import { block, edge } from '../store/tables.js';
import type { ScannedBlock } from '../tree/layout.js';
import { projectDelta } from '../tree/projection.js';
import { scanTree } from '../tree/scan.js';

const adopting = writes('Graph.adoptIdentities', [block]);

const MARKS_PER_READ = 200;

type Fields = Readonly<Record<string, unknown>>;

const NAME = /\[\[([0-9a-f]{8,32})((?:\|[^\]]*)?\]\])/g;

const compact = (id: string): string => id.replaceAll('-', '');

const placeOf = (one: ScannedBlock, parent: string | null): string =>
  `${parent ?? ''}\0${one.frontmatter.title}\0${(one.frontmatter.tags ?? []).join(',')}`;

function adoptions(levelled: readonly ScannedBlock[], target: readonly ScannedBlock[], known: ReadonlySet<string>): Map<string, string> {
  const held = new Set(levelled.map((one) => one.frontmatter.id));
  const places = new Map<string, string[]>();
  for (const one of target) {
    if (held.has(one.frontmatter.id)) continue;
    const key = placeOf(one, one.parentId);
    const shelf = places.get(key);
    if (shelf === undefined) places.set(key, [one.frontmatter.id]);
    else shelf.push(one.frontmatter.id);
  }
  const parents = new Map(levelled.map((one) => [one.frontmatter.id, one.parentId]));
  const depths = new Map<string, number>();
  const depth = (id: string): number => {
    const cached = depths.get(id);
    if (cached !== undefined) return cached;
    const parent = parents.get(id) ?? null;
    const measured = parent === null ? 0 : depth(parent) + 1;
    depths.set(id, measured);
    return measured;
  };
  const minted = levelled
    .filter((one) => !known.has(one.frontmatter.id))
    .map((one) => ({ one, depth: depth(one.frontmatter.id) }))
    .toSorted((a, b) => a.depth - b.depth)
    .map(({ one }) => one);
  const adopted = new Map<string, string>();
  const taken = new Set<string>();
  for (const one of minted) {
    const parent = one.parentId === null ? null : (adopted.get(one.parentId) ?? one.parentId);
    const free = (places.get(placeOf(one, parent)) ?? []).filter((id) => !taken.has(id));
    if (free.length !== 1) continue;
    adopted.set(one.frontmatter.id, free[0]!);
    taken.add(free[0]!);
  }
  return adopted;
}

function renamed(adopted: ReadonlyMap<string, string>): (value: unknown) => unknown {
  const names = [...adopted].map(([from, to]) => [compact(from), compact(to)] as const);
  const name = (spoken: string): string | null => {
    const hit = names.find(([from]) => from.endsWith(spoken));
    return hit === undefined ? null : hit[1].slice(-spoken.length);
  };
  const text = (value: string): string => {
    const whole = adopted.get(value);
    if (whole !== undefined) return whole;
    const spoken = /^[0-9a-f]{8,32}$/.test(value) ? name(value) : null;
    if (spoken !== null) return spoken;
    let out = value;
    for (const [from, to] of adopted) out = out.replaceAll(from, to);
    return out.replace(NAME, (match, spokenName: string, rest: string) => {
      const swapped = name(spokenName);
      return swapped === null ? match : `[[${swapped}${rest}`;
    });
  };
  const walk = (value: unknown): unknown => {
    if (typeof value === 'string') return text(value);
    if (Array.isArray(value)) return value.map(walk);
    if (value !== null && typeof value === 'object')
      return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, walk(inner)]));
    return value;
  };
  return walk;
}

export const adoptIdentities = Effect.fn('Graph.adoptIdentities')(function* (input: {
  readonly projectId: number;
  readonly treeRoot: string;
  readonly target: string;
  readonly known: ReadonlySet<string>;
}) {
  const levelled = (yield* scanTree(input.treeRoot)).blocks;
  if (levelled.every((one) => input.known.has(one.frontmatter.id))) return 0;
  const adopted = adoptions(levelled, (yield* scanTree(input.target)).blocks, input.known);
  if (adopted.size === 0) return 0;
  const store = yield* GraphStore;
  const rows = new Map<number, { readonly id: number; readonly uuid: string; readonly body: string; readonly fields: Fields }>();
  const from = [...adopted.keys()];
  for (let at = 0; at < from.length; at += MARKS_PER_READ) {
    const slice = from.slice(at, at + MARKS_PER_READ);
    const mentioned = slice.flatMap((id) => {
      const mark = `%${id.slice(-SPOKEN_LENGTH)}%`;
      return [like(block.body, mark), sql`${block.fields} like ${mark}`];
    });
    const read = yield* store.db
      .select({ id: block.id, uuid: block.uuid, body: block.body, fields: block.fields })
      .from(block)
      .where(and(eq(block.projectId, input.projectId), or(inArray(block.uuid, slice), ...mentioned)));
    for (const row of read) rows.set(row.id, row);
  }
  const walk = renamed(adopted);
  const changed = [...rows.values()].flatMap((row) => {
    const uuid = adopted.get(row.uuid) ?? row.uuid;
    const body = walk(row.body) as string;
    const fields = walk(row.fields) as Fields;
    if (uuid === row.uuid && body === row.body && JSON.stringify(fields) === JSON.stringify(row.fields)) return [];
    return [{ id: row.id, uuid, body, fields, renamed: uuid !== row.uuid }];
  });
  const renamedIds = changed.filter((row) => row.renamed).map((row) => row.id);
  const pointing =
    renamedIds.length === 0
      ? []
      : (yield* store.db.selectDistinct({ id: edge.fromId }).from(edge).where(inArray(edge.toId, renamedIds))).map((row) => row.id);
  yield* store.transaction(adopting, () =>
    Effect.gen(function* () {
      for (const row of changed) {
        yield* store.db.update(block).set({ uuid: row.uuid, body: row.body, fields: row.fields }).where(eq(block.id, row.id));
      }
      yield* projectDelta({
        projectId: input.projectId,
        treeRoot: input.treeRoot,
        blockIds: [...changed.map((row) => row.id), ...pointing],
      });
    }),
  );
  return adopted.size;
});
