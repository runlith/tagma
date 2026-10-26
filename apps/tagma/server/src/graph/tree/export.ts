import { Data, Effect } from 'effect';
import { type BlockEdge, type BlockFrontmatter, type BlockSourceRow, blockFrontmatterOf, encodeBlockFile } from './blockFile.js';
import type { TreeBlock } from './layout.js';
import type { SessionSpelling } from './sessions.js';

export class ExportFailed extends Data.TaggedError('ExportFailed')<{
  readonly message: string;
}> {}

export type MirrorRow = {
  readonly id: number;
  readonly uuid: string;
  readonly ord: number;
  readonly tags: readonly string[];
  readonly fields: Readonly<Record<string, unknown>>;
  readonly title: string;
};

export type ExportBlockRow = MirrorRow & {
  readonly parentId: number | null;
  readonly body: string;
  readonly deletedAt: Date | null;
};

export type BlockConnections = {
  readonly edges: ReadonlyMap<number, readonly BlockEdge[]>;
  readonly sources: ReadonlyMap<number, readonly BlockSourceRow[]>;
  readonly sessions: ReadonlyMap<number, readonly SessionSpelling[]>;
};

export type ConnectionRows = {
  readonly edges: readonly { readonly fromId: number; readonly kind: BlockEdge['kind']; readonly to: string | null }[];
  readonly sources: readonly (BlockSourceRow & { readonly blockId: number })[];
  readonly sessions: readonly SessionSpelling[];
};

export const groupConnections = (rows: ConnectionRows): BlockConnections => {
  const edges = new Map<number, BlockEdge[]>();
  for (const row of rows.edges) {
    if (row.to === null) continue;
    const held = edges.get(row.fromId);
    if (held === undefined) edges.set(row.fromId, [{ kind: row.kind, to: row.to }]);
    else held.push({ kind: row.kind, to: row.to });
  }
  const sources = new Map<number, BlockSourceRow[]>();
  for (const row of rows.sources) {
    const measured = { kind: row.kind, ref: row.ref, symbol: row.symbol };
    const held = sources.get(row.blockId);
    if (held === undefined) sources.set(row.blockId, [measured]);
    else held.push(measured);
  }
  const sessions = new Map<number, SessionSpelling[]>();
  for (const row of rows.sessions) {
    const held = sessions.get(row.blockId);
    if (held === undefined) sessions.set(row.blockId, [row]);
    else held.push(row);
  }
  return { edges, sources, sessions };
};

function portableFields(row: MirrorRow, spellings: readonly SessionSpelling[] | undefined): Readonly<Record<string, unknown>> {
  if (spellings === undefined) return row.fields;
  const fields: Record<string, unknown> = { ...row.fields };
  for (const { field, spelling } of spellings) {
    if (spelling === null) delete fields[field];
    else fields[field] = spelling;
  }
  return fields;
}

export const rowFrontmatter = (row: MirrorRow, connections: BlockConnections): BlockFrontmatter =>
  blockFrontmatterOf({
    ...row,
    id: row.uuid,
    fields: portableFields(row, connections.sessions.get(row.id)),
    edges: connections.edges.get(row.id) ?? [],
    sources: connections.sources.get(row.id) ?? [],
  });

export const rowText = (row: MirrorRow & { readonly body: string }, connections: BlockConnections): string =>
  encodeBlockFile({ frontmatter: rowFrontmatter(row, connections), body: row.body });

export const exportGraphRows = Effect.fnUntraced(function* (blocks: readonly ExportBlockRow[], connections: BlockConnections) {
  const alive = blocks.filter((row) => row.deletedAt === null);
  const uuids = new Map(alive.map((row) => [row.id, row.uuid]));
  const tree: TreeBlock[] = [];
  for (const row of alive) {
    let parentId: string | null = null;
    if (row.parentId !== null) {
      const parent = uuids.get(row.parentId);
      if (parent === undefined) {
        return yield* new ExportFailed({ message: `block ${row.id} hangs under ${row.parentId}, which the export does not carry` });
      }
      parentId = parent;
    }
    tree.push({ parentId, frontmatter: rowFrontmatter(row, connections), body: row.body });
  }
  return tree;
});
