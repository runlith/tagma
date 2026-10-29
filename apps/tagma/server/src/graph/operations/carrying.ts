import { Effect } from 'effect';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { canonicalJson } from '@runlith/utils/object';
import { GraphStore } from '../../platform/contract/service/store.js';
import { WriterRegister } from '../../platform/contract/service/writers.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { pagesOf } from '../../platform/store/binds.js';
import { block, edge, farEdge } from '../store/tables.js';
import { BlockNames, type BlockRow } from '../contract/service/acts.js';
import { type CarriedBlock, type CarriedFar, Edges, type FarBlock, type GraphAddress } from '../contract/service/blocks.js';
import { Sources } from '../contract/service/sources.js';
import { Tags } from '../contract/service/vocabulary.js';
import type { MapProblem } from '../contract/service/law.js';
import type { ModuleCard } from '../contract/wire/modules.js';
import type { TagTable } from '../contract/wire/tags/table.js';
import { MODULE, RELATION_EDGES } from '../contract/wire/tags/moduleContract.js';
import { isEnabled } from '../contract/wire/tags/law.js';
import { blockName } from '../contract/wire/references.js';
import { BlockRows } from '../acts/rows.js';
import { sessionFields } from '../tree/sessions.js';
import { carriesTag } from '../vocabulary/projection.js';
import { readFieldOption } from '../vocabulary/declarationRules.js';

const PROVENANCE: readonly string[] = ['supersedes'];

const RUNS: ReadonlySet<string> = new Set(['watch', 'gate']);

export type Carried = {
  readonly root: BlockRow;
  readonly rows: readonly BlockRow[];
  readonly blocks: readonly CarriedBlock[];
  readonly graph: GraphAddress;
};

type Lawful = { readonly uuid: string; readonly tags: readonly string[]; readonly fields: Readonly<Record<string, unknown>> };

export type Running = { readonly uuid: string; readonly key: string };

export const carriedOf = Effect.fn('update_block.carried')(function* (rootId: number) {
  const { db } = yield* GraphStore;
  const rows = yield* BlockRows;
  const edges = yield* Edges;
  const writers = yield* WriterRegister;
  const root = yield* rows.blockById(rootId);
  const subtree = [root, ...(yield* rows.collectDescendants(root.id))];
  const byId = new Map(subtree.map((row) => [row.id, row] as const));
  const ids = [...byId.keys()];
  const table = yield* (yield* Tags).of(root.projectId);
  const home = yield* rows.rootBlockOf(root.projectId);
  const graph: GraphAddress = { graph: home.uuid, label: home.title };
  const placed = yield* (yield* Sources).byBlock(ids);
  const near: (typeof edge.$inferSelect)[] = [];
  const far: (typeof farEdge.$inferSelect)[] = [];
  for (const page of pagesOf(ids, 1)) {
    near.push(
      ...(yield* db.select().from(edge).where(inArray(edge.fromId, page)).orderBy(asc(edge.fromId), asc(edge.kind), asc(edge.toId))),
    );
    far.push(
      ...(yield* db
        .select()
        .from(farEdge)
        .where(inArray(farEdge.fromId, page))
        .orderBy(asc(farEdge.fromId), asc(farEdge.kind), asc(farEdge.graph), asc(farEdge.uuid))),
    );
  }
  const nearFrom = Map.groupBy(near, (link) => link.fromId);
  const farFrom = Map.groupBy(far, (link) => link.fromId);
  const ends = new Map<number, FarBlock>();
  const endOf = Effect.fnUntraced(function* (id: number) {
    const known = ends.get(id);
    if (known !== undefined) return known;
    const end = yield* edges.farEndOf(yield* rows.rawBlockById(id));
    ends.set(id, end);
    return end;
  });
  const sessionsOf = sessionFields(table);
  const blocks: CarriedBlock[] = [];
  for (const row of subtree) {
    const fields: Record<string, unknown> = { ...row.fields };
    const sessions: { readonly field: string; readonly writer: { readonly harness: string; readonly key: string } }[] = [];
    for (const field of sessionsOf(row)) {
      const value = fields[field];
      if (typeof value !== 'number') continue;
      delete fields[field];
      const writer = yield* writers.writerOf(value);
      if (writer !== null) sessions.push({ field, writer: { harness: writer.harness, key: writer.key } });
    }
    const links: { readonly kind: string; readonly to: string }[] = [];
    const leaving: CarriedFar[] = [];
    for (const link of nearFrom.get(row.id) ?? []) {
      const inside = byId.get(link.toId);
      if (inside !== undefined) links.push({ kind: link.kind, to: inside.uuid });
      else if (!RELATION_EDGES.includes(link.kind)) {
        const end = yield* endOf(link.toId);
        leaving.push({ kind: link.kind, target: end.target, end });
      }
    }
    for (const link of farFrom.get(row.id) ?? []) {
      leaving.push({ kind: link.kind, target: { graph: link.graph, uuid: link.uuid, label: link.label }, end: null });
    }
    const parent = row.id === root.id || row.parentId === null ? undefined : byId.get(row.parentId);
    blocks.push({
      uuid: row.uuid,
      parent: parent === undefined ? null : parent.uuid,
      ord: row.ord,
      title: row.title,
      body: row.body,
      tags: row.tags,
      fields,
      sessions,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      sources: (placed.get(row.id) ?? []).map((one) => ({ kind: one.kind, ref: one.ref, symbol: one.symbol ?? undefined })),
      links,
      far: leaving,
    });
  }
  return { root, rows: subtree, blocks, graph } satisfies Carried;
});

export const snapshotOf = (blocks: readonly CarriedBlock[]): string =>
  canonicalJson(blocks.map((one) => ({ ...one, createdAt: one.createdAt.toISOString(), updatedAt: one.updatedAt.toISOString() })));

export const contentOf = (blocks: readonly CarriedBlock[]): string =>
  canonicalJson(
    blocks.map((one) => ({
      ...one,
      ord: one.parent === null ? 0 : one.ord,
      createdAt: one.createdAt.toISOString(),
      updatedAt: one.updatedAt.toISOString(),
      links: one.links.map((link) => `${link.kind} ${link.to}`).toSorted(),
      far: one.far.map((link) => `${link.kind} ${link.target.uuid}`).toSorted(),
    })),
  );

const lawRows = Effect.fnUntraced(function* (table: TagTable, projectId: number) {
  const { db } = yield* GraphStore;
  return yield* db
    .select()
    .from(block)
    .where(and(eq(block.projectId, projectId), isNull(block.deletedAt), carriesTag(table.lawBearingTypes(), block.id)));
});

const documentOf = Effect.fnUntraced(function* (table: TagTable, rule: Lawful) {
  const field = table.lawProjection(rule)?.enforcement?.field;
  if (field === undefined) return undefined;
  return yield* readFieldOption(rule, field, 'lawEnforcement').pipe(
    Effect.mapError((refused) => new GateRefusal(refused.code, `${blockName(rule.uuid)}: ${refused.reason}`, refused.unblock)),
  );
});

export const runningOf = Effect.fnUntraced(function* (table: TagTable, rules: readonly Lawful[]) {
  const running: Running[] = [];
  for (const rule of rules) {
    if (table.lawProjection(rule) === null || !isEnabled(table.lawProjection(rule), rule)) continue;
    const document = yield* documentOf(table, rule);
    if (document !== undefined && RUNS.has(document.strictness)) running.push({ uuid: rule.uuid, key: document.inspection });
  }
  return running;
});

export const runningIn = Effect.fnUntraced(function* (projectId: number) {
  const table = yield* (yield* Tags).of(projectId);
  return yield* runningOf(table, yield* lawRows(table, projectId));
});

export const arrivingLaw = Effect.fnUntraced(function* (projectId: number, blocks: readonly CarriedBlock[]) {
  const table = yield* (yield* Tags).of(projectId);
  const nodes = blocks.map((one) => ({
    uuid: one.uuid,
    tags: one.tags.map((word) => table.identities.keyOf(word) ?? word),
    fields: one.fields,
  }));
  return { running: yield* runningOf(table, nodes), cards: nodes.some((node) => table.supports(node, MODULE)), nodes };
});

export const freshProblems = (before: readonly MapProblem[], after: readonly MapProblem[]): readonly MapProblem[] =>
  after.filter((one) => !before.some((stood) => stood.key === one.key));

export const mapRefusal = (project: string, fresh: readonly MapProblem[]): GateRefusal<'module-map-invalid'> =>
  new GateRefusal(
    'module-map-invalid',
    `after this move the module map of ${project} would not hold together: ${fresh.map((one) => `${one.key}: ${one.problem}`).join('; ')}`,
    [
      'set_module with the module cards corrected so their map holds together, then move again',
      'or move the module cards it names together, in one subtree',
    ],
  );

export const withoutCards = (cards: readonly ModuleCard[], leaving: ReadonlySet<number>): readonly ModuleCard[] =>
  cards
    .filter((card) => !leaving.has(card.block))
    .map((card) => ({
      ...card,
      imports: card.imports.filter((id) => !leaving.has(id)),
      importsTests: card.importsTests.filter((id) => !leaving.has(id)),
    }));

export const partedDebt = Effect.fn('update_block.partedDebt')(function* (projectId: number, ids: ReadonlySet<number>) {
  const rows = yield* BlockRows;
  const names = yield* BlockNames;
  const { db } = yield* GraphStore;
  const table = yield* (yield* Tags).of(projectId);
  const moving = new Set<string>();
  for (const page of pagesOf([...ids], 1)) {
    for (const row of yield* db.select({ uuid: block.uuid }).from(block).where(inArray(block.id, page))) moving.add(blockName(row.uuid));
  }
  const parted: { readonly rule: string; readonly owner: string; readonly entries: number; readonly goes: boolean }[] = [];
  for (const rule of yield* lawRows(table, projectId)) {
    const document = yield* documentOf(table, rule);
    if (document === undefined) continue;
    const leaves = ids.has(rule.id);
    const owners = new Map<string, number>();
    for (const entry of document.debt) owners.set(entry.owner.toLowerCase(), (owners.get(entry.owner.toLowerCase()) ?? 0) + 1);
    for (const [owner, entries] of owners) {
      const goes = moving.has(owner);
      if (leaves !== goes) parted.push({ rule: blockName(rule.uuid), owner, entries, goes });
    }
  }
  const staying = yield* names.idsOfNames(parted.filter((one) => !one.goes).map((one) => one.owner));
  const split: string[] = [];
  for (const one of parted) {
    if (!one.goes) {
      const id = staying.get(one.owner);
      const live = id === undefined ? undefined : yield* rows.liveBlock(id);
      if (live === undefined || live.projectId !== projectId) continue;
    }
    split.push(
      `${one.rule} owes ${one.entries} debt ${one.entries === 1 ? 'entry' : 'entries'} to ${one.owner}, which ${one.goes ? 'leaves' : 'stays'}`,
    );
  }
  if (split.length === 0) return;
  return yield* new GateRefusal(
    'relocation-shape',
    `debt and its owner stand in one graph, and this move would part them: ${split.join('; ')}`,
    [
      'move each rule together with the task or spec that owns its debt, in one subtree',
      'or read_enforcement with the rule, then enforce_rule with owners mapping those entries to a task or spec of the graph the rule will stand in',
    ],
  );
});

export const crossingEdges = Effect.fnUntraced(function* (ids: ReadonlySet<number>) {
  const { db } = yield* GraphStore;
  const outgoing: (typeof edge.$inferSelect)[] = [];
  const incoming: (typeof edge.$inferSelect)[] = [];
  for (const page of pagesOf([...ids], 1)) {
    for (const link of yield* db.select().from(edge).where(inArray(edge.fromId, page))) if (!ids.has(link.toId)) outgoing.push(link);
    for (const link of yield* db.select().from(edge).where(inArray(edge.toId, page))) if (!ids.has(link.fromId)) incoming.push(link);
  }
  return { outgoing, incoming };
});

export const assertIncoming = Effect.fn('update_block.incoming')(function* (ids: ReadonlySet<number>, ends: ReadonlyMap<string, FarBlock>) {
  const rows = yield* BlockRows;
  const edges = yield* Edges;
  for (const link of (yield* crossingEdges(ids)).incoming) {
    if (RELATION_EDGES.includes(link.kind) || PROVENANCE.includes(link.kind)) continue;
    const to = yield* rows.rawBlockById(link.toId);
    yield* edges.assertCarried(yield* rows.rawBlockById(link.fromId), link.kind, ends.get(to.uuid) ?? null);
  }
});

export const leavingOf = Effect.fn('update_block.leaving')(function* (carried: Carried) {
  const rows = yield* BlockRows;
  const { root } = carried;
  const table = yield* (yield* Tags).of(root.projectId);
  if (root.tags.length === 0 && root.parentId === null) {
    return yield* new GateRefusal('project-root', 'the project root does not leave its graph', [
      'move the blocks under it, each with its subtree',
    ]);
  }
  const ids = new Set(carried.rows.map((row) => row.id));
  const dropped: string[] = [];
  const nameOf = Effect.fnUntraced(function* (id: number) {
    return blockName((yield* rows.rawBlockById(id)).uuid);
  });
  const { outgoing, incoming } = yield* crossingEdges(ids);
  for (const link of [...outgoing, ...incoming]) {
    if (PROVENANCE.includes(link.kind)) {
      const from = yield* nameOf(link.fromId);
      const to = yield* nameOf(link.toId);
      return yield* new GateRefusal(
        'relocation-shape',
        `${from} ${link.kind} ${to} crosses the edge of the moving subtree, and that edge stays in one graph`,
        [`move ${from} and ${to} in one subtree: ${link.kind} is written by its own operation, inside one graph`],
      );
    }
    if (RELATION_EDGES.includes(link.kind)) dropped.push(`${yield* nameOf(link.fromId)} ${link.kind} ${yield* nameOf(link.toId)}`);
  }
  yield* partedDebt(root.projectId, ids);
  const cards = carried.rows.filter((row) => table.supports(row, MODULE)).map((row) => row.id);
  return { ids, dropped, cards: new Set(cards), stood: yield* runningIn(root.projectId) };
});
