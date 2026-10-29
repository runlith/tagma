import { Effect, Layer } from 'effect';
import { type FloorRefusal, GateRefusal } from '../../platform/contract/wire/refusal.js';
import { and, eq, inArray, or } from 'drizzle-orm';
import { GraphStore, type StoreFailure } from '../../platform/contract/service/store.js';
import { block, edge, farEdge } from '../store/tables.js';
import { CORE_EDGES, DISCOVERED_FROM, type EdgeKind, RELATES } from '../contract/wire/edges.js';
import { BlockRows } from '../acts/rows.js';
import { Act, BlockNames, type BlockRow } from '../contract/service/acts.js';
import { Edges, type EdgeNode, type EdgeRefusal, type FarBlock } from '../contract/service/blocks.js';
import { assertStanding } from '../work/retirement.js';
import { tagLabel } from '../contract/wire/tags/roles.js';
import type { TagTable } from '../contract/wire/tags/table.js';
import { Tags } from '../contract/service/vocabulary.js';
import { blockName } from '../contract/wire/references.js';
import { writes } from '../../platform/contract/service/writes.js';
import { linking } from '../store/actWrites.js';
import { edgeKindOf, edgeTargetsOf } from '../contract/wire/tags/declaration.js';
import { RELATION_EDGES } from '../contract/wire/tags/moduleContract.js';
import { boundaryRefusal } from './guards.js';
import { type FarAddress, type FarTarget, farKey, farText } from '../contract/wire/far.js';
import { RoutedGraphs } from '../contract/service/serving.js';
import { ownRoot } from '../acts/far.js';
import { storedTypeId } from '../vocabulary/projection.js';
import { pagesOf } from '../../platform/store/binds.js';

const linkingEdge = writes('Edges.link', [], linking);
const unlinking = writes('Edges.unlink', [edge, farEdge]);
const readdressing = writes('Edges.readdress', [farEdge], linking);

type WaitEnd = { readonly id: number } | { readonly far: FarTarget };

type FarServices = { readonly vocabulary: Tags['Service']; readonly rows: BlockRows['Service']; readonly names: BlockNames['Service'] };

const farBlockWith = Effect.fnUntraced(function* (services: FarServices, row: BlockRow, kind: EdgeKind) {
  const table = yield* services.vocabulary.of(row.projectId);
  if (table.edgeRule(kind)?.standing === true) yield* assertStanding(services.rows, services.names, row.id, `be linked with ${kind}`);
  return yield* farEndWith(services, row);
});

const farEndWith = Effect.fnUntraced(function* (services: FarServices, row: EdgeNode) {
  const table = yield* services.vocabulary.of(row.projectId);
  const root = yield* services.rows.rootBlockOf(row.projectId);
  const carried = table.tagsOf(row);
  const lineage = new Set<string>();
  for (const tag of carried) {
    for (let at: string | undefined = tag.id; at !== undefined && !lineage.has(at); at = table.tagById(at)?.extends) lineage.add(at);
  }
  const typed = (key: string) => ({ key, typeId: storedTypeId(table, key) });
  return {
    target: { graph: root.uuid, uuid: row.uuid, label: root.title },
    types: carried.map((tag) => typed(tag.id)),
    lineage: [...lineage].map(typed),
    contracts: table.contracts.filter((contract) => table.supports(row, contract)),
  } satisfies FarBlock;
});

export const edgesLayer: Layer.Layer<Edges, never, GraphStore | Act | BlockNames | BlockRows | Tags> = Layer.effect(
  Edges,
  Effect.gen(function* () {
    const { db } = yield* GraphStore;
    const act = yield* Act;
    const names = yield* BlockNames;
    const rows = yield* BlockRows;
    const vocabulary = yield* Tags;

    const assertDeclaredEdge = (table: TagTable, from: EdgeNode, kind: string): Effect.Effect<void, GateRefusal<'edge-undeclared'>> => {
      const tags = table.tagsOf(from);
      const declared = [...new Set(tags.flatMap((tag) => tag.edges.map(edgeKindOf)))];
      if (declared.includes(kind) || CORE_EDGES.includes(kind)) return Effect.void;
      const label = tags.length === 0 ? tagLabel(null) : tags.map(tagLabel).join(' ');
      const many = tags.length > 1;
      const carried = [...new Set([RELATES, DISCOVERED_FROM, ...declared])].join(', ');
      return new GateRefusal('edge-undeclared', `${label} ${many ? 'declare' : 'declares'} no "${kind}" edge`, [
        `${from.id === undefined ? 'create_block with' : `link_blocks from ${blockName(from.uuid)} along`} an edge it carries: ${carried}`,
        tags.length === 0
          ? `tags whose declaration carries "${kind}" make a node that points along it`
          : `update_block the #tag node declaring one of ${label}, adding "${kind}" to its edges`,
      ]);
    };

    const admittedTargets = (table: TagTable, from: EdgeNode, kind: string): readonly string[] | null => {
      const allowed = table
        .tagsOf(from)
        .flatMap((tag) => tag.edges.filter((declared) => edgeKindOf(declared) === kind).map(edgeTargetsOf))
        .filter((targets): targets is readonly string[] => targets !== null);
      return allowed.length === 0 ? null : [...new Set(allowed.flat())];
    };

    const shapeRefusal = (table: TagTable, from: EdgeNode, kind: string, named: readonly string[], carried: string) =>
      new GateRefusal(
        'edge-shape',
        `"${kind}" from ${tagLabel(table.tagOf(from))} points only at ${named.map((target) => `#${table.nameOf(target)}`).join(' or ')}`,
        [
          `${carried}: link a node carrying ${named.map((target) => `#${table.nameOf(target)}`).join(' or ')}`,
          kind === RELATES
            ? 'a reference in its body ([[name]]) names any other block'
            : 'link_blocks with relates — a connection of another shape',
        ],
      );

    const assertEdgeTarget = (
      table: TagTable,
      from: EdgeNode,
      to: EdgeNode,
      kind: string,
    ): Effect.Effect<void, GateRefusal<'edge-shape'>> => {
      const named = admittedTargets(table, from, kind);
      if (named === null) return Effect.void;
      const ids = named.map((target) => table.tagById(target)?.id ?? target);
      const admitted = new Set([...ids, ...table.descendantsOf(ids)]);
      if (table.tagsOf(to).some((tag) => admitted.has(tag.id))) return Effect.void;
      return shapeRefusal(
        table,
        from,
        kind,
        named,
        `${blockName(to.uuid)} carries ${to.tags.length === 0 ? 'no tag' : to.tags.map((tag) => `#${table.nameOf(tag)}`).join(' ')}`,
      );
    };

    const assertFarTarget = (
      table: TagTable,
      from: EdgeNode,
      end: FarBlock,
      kind: string,
    ): Effect.Effect<void, GateRefusal<'edge-shape'>> => {
      const named = admittedTargets(table, from, kind);
      if (named === null) return Effect.void;
      const ids = named.map((target) => table.tagById(target)?.id ?? target);
      const keys = new Set([...ids, ...table.descendantsOf(ids)]);
      const typeIds = new Set([...keys].flatMap((key) => storedTypeId(table, key) ?? []));
      if (end.lineage.some((type) => (type.typeId !== null && typeIds.has(type.typeId)) || (type.typeId === null && keys.has(type.key)))) {
        return Effect.void;
      }
      return shapeRefusal(
        table,
        from,
        kind,
        named,
        `${blockName(end.target.uuid)} in ${end.target.label} carries ${end.types.length === 0 ? 'no tag' : end.types.map((type) => `#${type.key}`).join(' ')}`,
      );
    };

    const waitsFrom = Effect.fnUntraced(function* (level: readonly number[], kind: string, root: string | null) {
      const local = yield* db
        .select({ toId: edge.toId })
        .from(edge)
        .where(and(inArray(edge.fromId, [...level]), eq(edge.kind, kind)));
      const far = yield* db
        .select({ graph: farEdge.graph, uuid: farEdge.uuid })
        .from(farEdge)
        .where(and(inArray(farEdge.fromId, [...level]), eq(farEdge.kind, kind)));
      const home = far.filter((row) => row.graph === root).map((row) => row.uuid);
      const homed = home.length === 0 ? [] : yield* db.select({ id: block.id }).from(block).where(inArray(block.uuid, home));
      return {
        ids: [...local.map((row) => row.toId), ...homed.map((row) => row.id)],
        far: far.filter((row) => row.graph !== root),
      };
    });

    const assertNoWaitCycle = Effect.fn('Edges.assertNoCycle')(function* (
      dependent: EdgeNode & { readonly id: number },
      blocker: WaitEnd,
      kind: string,
    ): Effect.fn.Return<void, StoreFailure | GateRefusal<'wait-cycle'>> {
      const root = yield* ownRoot(db, dependent.projectId);
      const pool = yield* RoutedGraphs;
      const seen = new Set<number>();
      const seenFar = new Set<string>();
      let local: number[] = 'id' in blocker ? [blocker.id] : [];
      let far: { graph: string; uuid: string }[] = 'far' in blocker ? [blocker.far] : [];
      while (local.length > 0 || far.length > 0) {
        if (local.includes(dependent.id)) {
          const named = 'id' in blocker ? yield* names.nameOf(blocker.id) : blockName(blocker.far.uuid);
          return yield* new GateRefusal('wait-cycle', 'this edge would create a dependency cycle', [
            `read_block ${blockName(dependent.uuid)} — the chain it already waits through reaches ${named}`,
            'unlink one edge of that chain, or split the work so the wait runs one way',
          ]);
        }
        const level = local.filter((id) => !seen.has(id));
        for (const id of level) seen.add(id);
        const outward = far.filter((one) => !seenFar.has(farKey(one)));
        for (const one of outward) seenFar.add(farKey(one));
        const next = level.length === 0 ? { ids: [], far: [] } : yield* waitsFrom(level, kind, root);
        local = next.ids;
        far = next.far;
        if (pool === null || outward.length === 0) continue;
        const graphs = new Map<string, string[]>();
        for (const one of outward) {
          const group = graphs.get(one.graph);
          if (group === undefined) graphs.set(one.graph, [one.uuid]);
          else group.push(one.uuid);
        }
        for (const [graph, uuids] of graphs) {
          for (const step of yield* pool.farOutgoing(graph, uuids, kind)) {
            if (step.graph !== root) {
              far.push({ graph: step.graph, uuid: step.to });
              continue;
            }
            const home = yield* db.select({ id: block.id }).from(block).where(eq(block.uuid, step.to)).get();
            if (home !== undefined) local.push(home.id);
          }
        }
      }
    });

    const operationOnly = (kind: EdgeKind): Effect.Effect<void, GateRefusal<'operation-only'>> => {
      if (kind === 'supersedes') {
        return new GateRefusal('operation-only', '"supersedes" is written by `supersede_block`', [
          'supersede_block naming the retired block and its successor',
        ]);
      }
      return Effect.void;
    };

    const assertEdge = Effect.fn('Edges.assertEdge')(function* (
      from: EdgeNode,
      to: BlockRow,
      kind: EdgeKind,
    ): Effect.fn.Return<void, StoreFailure | GateRefusal<EdgeRefusal>> {
      const table = yield* vocabulary.of(from.projectId);
      if (RELATION_EDGES.includes(kind)) return yield* boundaryRefusal(blockName(from.uuid), 'linked');
      yield* assertDeclaredEdge(table, from, kind);
      yield* assertEdgeTarget(table, from, to, kind);
      const rule = table.edgeRule(kind);
      if (rule !== null) {
        if (!table.supports(from, rule.from) || !table.supports(to, rule.to)) {
          return yield* new GateRefusal('edge-shape', `"${kind}" connects ${rule.from} → ${rule.to}`, [
            `${blockName(from.uuid)} is ${tagLabel(table.tagOf(from))} and ${blockName(to.uuid)} is ${tagLabel(table.tagOf(to))}: link FROM a node supporting ${rule.from} TO a node supporting ${rule.to}`,
            'link_blocks with relates, which connects any two blocks, or with discovered-from, to its origin',
          ]);
        }
        if (rule.acyclic === true && from.id !== undefined) yield* assertNoWaitCycle({ ...from, id: from.id }, { id: to.id }, kind);
        if (rule.standing === true) yield* assertStanding(rows, names, to.id, `be linked with ${kind}`);
      }
      yield* operationOnly(kind);
    });

    const assertFarEdge = Effect.fn('Edges.assertFarEdge')(function* (
      from: EdgeNode,
      end: FarBlock,
      kind: EdgeKind,
    ): Effect.fn.Return<void, StoreFailure | GateRefusal<EdgeRefusal>> {
      const table = yield* vocabulary.of(from.projectId);
      if (RELATION_EDGES.includes(kind)) return yield* boundaryRefusal(blockName(from.uuid), 'linked');
      yield* assertDeclaredEdge(table, from, kind);
      yield* operationOnly(kind);
      yield* assertFarTarget(table, from, end, kind);
      const rule = table.edgeRule(kind);
      if (rule === null) return;
      if (!table.supports(from, rule.from) || !end.contracts.includes(rule.to)) {
        return yield* new GateRefusal('edge-shape', `"${kind}" connects ${rule.from} → ${rule.to}`, [
          `${blockName(from.uuid)} is ${tagLabel(table.tagOf(from))} and ${blockName(end.target.uuid)} in ${end.target.label} supports ${end.contracts.join(', ') || 'no contract'}: link FROM a node supporting ${rule.from} TO a node supporting ${rule.to}`,
          'link_blocks with relates, which connects any two blocks, or with discovered-from, to its origin',
        ]);
      }
      if (rule.acyclic === true && from.id !== undefined) yield* assertNoWaitCycle({ ...from, id: from.id }, { far: end.target }, kind);
    });

    const assertCarried = Effect.fn('Edges.assertCarried')(function* (
      from: EdgeNode,
      kind: EdgeKind,
      to: EdgeNode | FarBlock | null,
    ): Effect.fn.Return<void, StoreFailure | GateRefusal<'edge-undeclared' | 'edge-shape'>> {
      const table = yield* vocabulary.of(from.projectId);
      yield* assertDeclaredEdge(table, from, kind);
      if (to !== null && 'target' in to) yield* assertFarTarget(table, from, to, kind);
      else if (to !== null) yield* assertEdgeTarget(table, from, to, kind);
      const rule = table.edgeRule(kind);
      if (rule === null) return;
      const reaches = to === null || ('target' in to ? to.contracts.includes(rule.to) : table.supports(to, rule.to));
      if (table.supports(from, rule.from) && reaches) return;
      const named =
        to === null ? 'its far end' : 'target' in to ? `${blockName(to.target.uuid)} in ${to.target.label}` : blockName(to.uuid);
      return yield* new GateRefusal(
        'edge-shape',
        `"${kind}" connects ${rule.from} → ${rule.to}, and ${blockName(from.uuid)} → ${named} does not`,
        [`unlink_blocks ${blockName(from.uuid)} ${kind} ${named} before the move, or name a parent in a graph whose tags carry it`],
      );
    });

    const readdress = Effect.fn('Edges.readdress')(function* (input: {
      projectId: number;
      from: string;
      to: { readonly graph: string; readonly label: string };
      uuids: readonly string[];
    }) {
      if (input.uuids.length === 0) return 0;
      return yield* act.unit(
        readdressing,
        Effect.gen(function* () {
          let moved = 0;
          for (const page of pagesOf([...input.uuids], 1)) {
            const pointing = yield* db
              .select({ row: farEdge })
              .from(farEdge)
              .innerJoin(block, eq(block.id, farEdge.fromId))
              .where(and(eq(block.projectId, input.projectId), eq(farEdge.graph, input.from), inArray(farEdge.uuid, page)));
            for (const { row } of pointing) {
              yield* db
                .delete(farEdge)
                .where(
                  and(eq(farEdge.fromId, row.fromId), eq(farEdge.kind, row.kind), eq(farEdge.graph, row.graph), eq(farEdge.uuid, row.uuid)),
                );
              yield* act.record('unlink', row.fromId, { kind: row.kind, far: farText(row) });
              yield* rows.insertFarEdge(row.fromId, row.kind, { graph: input.to.graph, uuid: row.uuid, label: input.to.label });
              moved += 1;
            }
          }
          return moved;
        }),
      );
    });

    const unlinkFar = Effect.fn('Edges.unlinkFar')(function* (input: { fromId: number; kind: EdgeKind; to: readonly FarAddress[] }) {
      yield* rows.rawBlockById(input.fromId);
      yield* act.unit(
        unlinking,
        Effect.gen(function* () {
          for (const to of input.to) {
            const gone = (yield* db
              .delete(farEdge)
              .where(
                and(eq(farEdge.fromId, input.fromId), eq(farEdge.kind, input.kind), eq(farEdge.graph, to.graph), eq(farEdge.uuid, to.uuid)),
              )
              .returning())[0];
            if (gone === undefined) {
              const name = yield* names.nameOf(input.fromId);
              return yield* new GateRefusal('no-edge', `no "${input.kind}" edge from ${name} to ${blockName(to.uuid)}`, [
                `read_block ${name} — the edges it does carry, and which way each points`,
              ]);
            }
            yield* act.record('unlink', input.fromId, { kind: input.kind, far: farText(gone) });
          }
        }),
      );
    });

    const retagRefusal = (code: 'edge-undeclared' | 'edge-shape', reason: string, unlink: string, kind: string) =>
      new GateRefusal(code, reason, [`unlink_blocks ${unlink} first, then change the tags`, `or name tags under which "${kind}" holds`]);

    const assertRetagged = Effect.fn('Edges.assertRetagged')(function* (node: BlockRow, tags: readonly string[]) {
      const table = yield* vocabulary.of(node.projectId);
      const future = { ...node, tags };
      const name = blockName(node.uuid);
      const label = tags.length === 0 ? tagLabel(null) : tags.map((tag) => `#${table.nameOf(tag)}`).join(' ');
      const declared = new Set(table.tagsOf(future).flatMap((tag) => tag.edges.map(edgeKindOf)));
      const admissions = new Map<string, ReadonlySet<string> | null>();
      const admits = (from: EdgeNode, kind: string, to: EdgeNode) => {
        const key = `${from.tags.join(' ')}\u0000${kind}`;
        let admitted = admissions.get(key);
        if (admitted === undefined) {
          const named = admittedTargets(table, from, kind);
          const ids = named?.map((target) => table.tagById(target)?.id ?? target);
          admitted = ids === undefined ? null : new Set([...ids, ...table.descendantsOf(ids)]);
          admissions.set(key, admitted);
        }
        return admitted === null || table.tagsOf(to).some((tag) => admitted.has(tag.id));
      };
      const restriction = (from: EdgeNode, kind: string) => JSON.stringify([...(admittedTargets(table, from, kind) ?? [])].sort());
      const end = { uuid: block.uuid, tags: block.tags, projectId: block.projectId, deletedAt: block.deletedAt };
      const near = yield* db
        .select({ kind: edge.kind, toId: edge.toId, ...end })
        .from(edge)
        .innerJoin(block, eq(block.id, edge.toId))
        .where(eq(edge.fromId, node.id));
      const far = yield* db.select({ kind: farEdge.kind, uuid: farEdge.uuid }).from(farEdge).where(eq(farEdge.fromId, node.id));
      const outgoing: { readonly kind: string; readonly uuid: string; readonly to: EdgeNode | null }[] = [
        ...near.map((row) => ({ kind: row.kind, uuid: row.uuid, to: row.toId === node.id ? future : row })),
        ...far.map((row) => ({ kind: row.kind, uuid: row.uuid, to: null })),
      ];
      for (const link of outgoing) {
        const toName = blockName(link.uuid);
        const unlink = `${name} ${link.kind} ${toName}`;
        if (!declared.has(link.kind) && !CORE_EDGES.includes(link.kind)) {
          return yield* retagRefusal(
            'edge-undeclared',
            `${label} declares no "${link.kind}" edge, and ${name} points along one to ${toName}`,
            unlink,
            link.kind,
          );
        }
        if (
          link.to === null &&
          admittedTargets(table, future, link.kind) !== null &&
          restriction(future, link.kind) !== restriction(node, link.kind)
        ) {
          return yield* retagRefusal(
            'edge-shape',
            `"${link.kind}" from ${label} points only at some tags, and ${toName} stands in another graph, where this change cannot judge its tags`,
            unlink,
            link.kind,
          );
        }
        if (link.to !== null && !admits(future, link.kind, link.to)) {
          return yield* retagRefusal(
            'edge-shape',
            `"${link.kind}" from ${label} does not point at ${toName}, which ${name} links`,
            unlink,
            link.kind,
          );
        }
        const rule = table.edgeRule(link.kind);
        if (rule !== null && !table.supports(future, rule.from)) {
          return yield* retagRefusal(
            'edge-shape',
            `"${link.kind}" leaves a node supporting ${rule.from}, and ${label} does not`,
            unlink,
            link.kind,
          );
        }
      }
      const incoming = yield* db
        .select({ kind: edge.kind, fromId: edge.fromId, ...end })
        .from(edge)
        .innerJoin(block, eq(block.id, edge.fromId))
        .where(eq(edge.toId, node.id));
      for (const link of incoming) {
        if (link.deletedAt !== null) continue;
        const from: EdgeNode = link.fromId === node.id ? future : link;
        const unlink = `${blockName(from.uuid)} ${link.kind} ${name}`;
        if (!admits(from, link.kind, future)) {
          return yield* retagRefusal(
            'edge-shape',
            `"${link.kind}" from ${blockName(from.uuid)} points only at other tags than ${label}`,
            unlink,
            link.kind,
          );
        }
        const rule = table.edgeRule(link.kind);
        if (rule !== null && !table.supports(future, rule.to)) {
          return yield* retagRefusal(
            'edge-shape',
            `"${link.kind}" reaches a node supporting ${rule.to}, and ${label} does not`,
            unlink,
            link.kind,
          );
        }
      }
    });

    return Edges.of({
      assertEdge,
      assertFarEdge,
      assertRetagged,
      farBlockOf: Effect.fn('Edges.farBlockOf')((row: BlockRow, kind: EdgeKind) => farBlockWith({ vocabulary, rows, names }, row, kind)),
      farEndOf: Effect.fn('Edges.farEndOf')((node: EdgeNode) => farEndWith({ vocabulary, rows, names }, node)),
      assertCarried,
      readdress,

      link: Effect.fn('Edges.link')(function* (input: {
        fromId: number;
        kind: EdgeKind;
        toId: number;
      }): Effect.fn.Return<void, StoreFailure | GateRefusal<EdgeRefusal | FloorRefusal | 'not-found' | 'deleted' | 'no-root'>> {
        const from = yield* rows.blockById(input.fromId);
        const to = yield* rows.blockById(input.toId);
        if (to.projectId !== from.projectId) {
          const end = yield* farBlockWith({ vocabulary, rows, names }, to, input.kind);
          yield* assertFarEdge(from, end, input.kind);
          return yield* act.unit(linkingEdge, rows.insertFarEdge(input.fromId, input.kind, end.target));
        }
        yield* assertEdge(from, to, input.kind);
        yield* act.unit(
          linkingEdge,
          Effect.gen(function* () {
            yield* rows.insertEdge(input.fromId, input.kind, input.toId);
          }),
        );
      }),

      linkFar: Effect.fn('Edges.linkFar')(function* (input: { fromId: number; kind: EdgeKind; end: FarBlock }) {
        const from = yield* rows.blockById(input.fromId);
        yield* assertFarEdge(from, input.end, input.kind);
        yield* act.unit(linkingEdge, rows.insertFarEdge(input.fromId, input.kind, input.end.target));
      }),

      unlink: Effect.fn('Edges.unlink')(function* (input: {
        fromId: number;
        kind: EdgeKind;
        toId: number;
      }): Effect.fn.Return<void, StoreFailure | GateRefusal<FloorRefusal | 'not-found' | 'operation-only' | 'no-edge' | 'no-root'>> {
        if (input.kind === 'supersedes') {
          return yield* new GateRefusal('operation-only', `"${input.kind}" is provenance; it is not unlinked`, [
            'what replaced a block is history: it stays readable',
            'wrong successor? supersede the successor in turn — the chain IS the decision record',
            'unsupersede_block — the replacement was taken in error, or the replaced record itself must be corrected; the block stands again',
          ]);
        }
        if (RELATION_EDGES.includes(input.kind)) return yield* boundaryRefusal(yield* names.nameOf(input.fromId), 'unlinked');
        const from = yield* rows.rawBlockById(input.fromId);
        const to = yield* rows.rawBlockById(input.toId);
        if (to.projectId !== from.projectId) {
          const graph = (yield* rows.rootBlockOf(to.projectId)).uuid;
          return yield* unlinkFar({ fromId: input.fromId, kind: input.kind, to: [{ graph, uuid: to.uuid }] });
        }
        yield* act.unit(
          unlinking,
          Effect.gen(function* () {
            const removed = yield* db
              .delete(edge)
              .where(and(eq(edge.fromId, input.fromId), eq(edge.kind, input.kind), eq(edge.toId, input.toId)))
              .returning();
            if (removed.length === 0) {
              return yield* new GateRefusal(
                'no-edge',
                `no "${input.kind}" edge from ${yield* names.nameOf(input.fromId)} to ${yield* names.nameOf(input.toId)}`,
                [`read_block ${yield* names.nameOf(input.fromId)} — the edges it does carry, and which way each points`],
              );
            }
            yield* act.record('unlink', input.fromId, { kind: input.kind, toId: input.toId });
          }),
        );
      }),

      unlinkFar,

      of: (projectId: number, within?: ReadonlySet<number>) =>
        db
          .select({ row: edge })
          .from(edge)
          .innerJoin(block, eq(block.id, edge.fromId))
          .where(
            within === undefined
              ? eq(block.projectId, projectId)
              : and(eq(block.projectId, projectId), or(inArray(edge.fromId, [...within]), inArray(edge.toId, [...within]))),
          )
          .pipe(Effect.map((found) => found.map((item) => item.row))),

      farOf: (projectId: number) =>
        db
          .select({ row: farEdge })
          .from(farEdge)
          .innerJoin(block, eq(block.id, farEdge.fromId))
          .where(eq(block.projectId, projectId))
          .pipe(Effect.map((found) => found.map((item) => item.row))),

      farFrom: (fromId: number, kind: EdgeKind) =>
        db
          .select()
          .from(farEdge)
          .where(and(eq(farEdge.fromId, fromId), eq(farEdge.kind, kind))),

      insertEdgeRow: rows.insertEdgeRow,
      insertEdge: rows.insertEdge,
      insertFarEdge: rows.insertFarEdge,
    });
  }),
);
