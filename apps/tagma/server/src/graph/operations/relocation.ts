import { Context, Effect, Exit, Result } from 'effect';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { GraphStore } from '../../platform/contract/service/store.js';
import { writes } from '../../platform/contract/service/writes.js';
import { pagesOf } from '../../platform/store/binds.js';
import { Projects } from '../../projects/contract/service/registry.js';
import { block } from '../store/tables.js';
import { Act } from '../contract/service/acts.js';
import { Blocks, type CarriedBlock, Edges, type FarBlock, Trash } from '../contract/service/blocks.js';
import type { GraphAddress } from '../contract/wire/far.js';
import { type LawReading, ProjectLaw } from '../contract/service/law.js';
import { measuredRoot } from '../contract/service/serving.js';
import type { GraphServices } from '../contract/service/services.js';
import type { Moved } from '../contract/wire/answers.js';
import { blockName } from '../contract/wire/references.js';
import { BlockRows } from '../acts/rows.js';
import { farPointers } from '../acts/far.js';
import { OtherGraphs } from '../serving/policy.js';
import { atTarget, type GraphTarget, locate } from './crossing.js';
import {
  arrivingLaw,
  assertIncoming,
  type Carried,
  carriedOf,
  contentOf,
  freshProblems,
  leavingOf,
  mapRefusal,
  partedDebt,
  runningIn,
  snapshotOf,
  withoutCards,
} from './carrying.js';

const relocating = writes('update_block.relocate', []);

const inUnit = <A, E, R>(work: Effect.Effect<A, E, R>) => Effect.flatMap(Act, (act) => act.unit(relocating, work));

const lawOf = (target: GraphTarget) =>
  atTarget(
    target,
    Effect.gen(function* () {
      const root = yield* measuredRoot(yield* (yield* Projects).byId(target.projectId));
      return yield* (yield* ProjectLaw).read({ projectId: target.projectId, root });
    }),
  );

const nameOf = (projectId: number) =>
  Effect.map(
    Effect.flatMap(Projects, (projects) => projects.byId(projectId)),
    (row) => row.name,
  );

const reasonOf = (failure: unknown): string =>
  failure instanceof GateRefusal ? `${failure.code}: ${failure.reason}` : failure instanceof Error ? failure.message : String(failure);

const endsOf = Effect.fn('update_block.ends')(function* (blocks: readonly CarriedBlock[], own: string) {
  const ends = new Map<string, FarBlock | null>();
  for (const one of blocks) {
    for (const link of one.far) {
      if (link.end !== null || link.target.graph === own || ends.has(link.target.uuid)) continue;
      const found = yield* Effect.result(locate(link.target.uuid.replaceAll('-', '')));
      if (Result.isFailure(found)) {
        if (!(found.failure instanceof GateRefusal)) return yield* Effect.fail(found.failure);
        ends.set(link.target.uuid, null);
        continue;
      }
      const there = found.success;
      ends.set(
        link.target.uuid,
        there.row.uuid === link.target.uuid
          ? yield* atTarget(
              there,
              Effect.flatMap(Edges, (edges) => edges.farEndOf(there.row)),
            )
          : null,
      );
    }
  }
  return blocks.map((one) => ({
    ...one,
    far: one.far.map((link) => (link.end !== null ? link : { ...link, end: ends.get(link.target.uuid) ?? null })),
  }));
});

const readdressed = Effect.fn('update_block.readdressed')(function* (
  from: GraphTarget,
  carried: Carried,
  to: GraphTarget,
  address: GraphAddress,
) {
  const uuids = carried.blocks.map((one) => one.uuid);
  const pointing = yield* atTarget(
    from,
    Effect.flatMap(GraphStore, ({ db }) => farPointers(db, from.projectId, uuids)),
  );
  const left: { project: string; edges?: number; reason: string }[] = pointing.unread.map((project) => ({
    project: project.name,
    reason: 'its graph index could not be read, so its edges were not found',
  }));
  const projects = new Map<number, { readonly name: string; edges: number }>();
  for (const pointer of pointing.pointers) {
    if (pointer.project.id === to.projectId) continue;
    const known = projects.get(pointer.project.id) ?? { name: pointer.project.name, edges: 0 };
    known.edges += 1;
    projects.set(pointer.project.id, known);
  }
  const reach = yield* OtherGraphs;
  let relinked = 0;
  for (const [projectId, { name, edges }] of projects) {
    if (reach === null) {
      left.push({ project: name, edges, reason: 'this call reaches no other graph' });
      continue;
    }
    const opened = yield* Effect.result(reach(projectId));
    if (Result.isFailure(opened)) {
      left.push({ project: name, edges, reason: reasonOf(opened.failure) });
      continue;
    }
    const moved = yield* Effect.result(
      atTarget(
        { projectId, graph: opened.success },
        Effect.flatMap(Edges, (graph) => graph.readdress({ projectId, from: carried.graph.graph, to: address, uuids })),
      ),
    );
    if (Result.isSuccess(moved)) relinked += moved.success;
    else left.push({ project: name, edges, reason: reasonOf(moved.failure) });
  }
  return { relinked, left };
});

export const relocate = Effect.fn('update_block.relocate')(function* (blockId: string, parentId: string) {
  const from = yield* locate(blockId);
  const to = yield* locate(parentId);
  const here = yield* Effect.context<GraphServices | GraphStore>();
  const shared = Context.get(from.graph ?? here, GraphStore) === Context.get(to.graph ?? here, GraphStore);
  const carried = yield* atTarget(from, carriedOf(from.row.id));
  const leaving = yield* atTarget(from, leavingOf(carried));
  const uuids = carried.blocks.map((one) => one.uuid);
  const name = blockName(from.row.uuid);
  const arrival = yield* atTarget(
    to,
    Effect.gen(function* () {
      const rows = yield* BlockRows;
      const edges = yield* Edges;
      const { db } = yield* GraphStore;
      yield* rows.blockById(to.row.id);
      const home = yield* rows.rootBlockOf(to.projectId);
      const held: { readonly id: number; readonly uuid: string }[] = [];
      for (const page of pagesOf(uuids, 1)) {
        held.push(
          ...(yield* db
            .select({ id: block.id, uuid: block.uuid })
            .from(block)
            .where(and(eq(block.projectId, to.projectId), inArray(block.uuid, page), isNull(block.deletedAt)))),
        );
      }
      const copy = held.find((one) => one.uuid === from.row.uuid);
      const law = yield* arrivingLaw(to.projectId, carried.blocks);
      const ends = new Map<string, FarBlock>();
      for (const node of law.nodes)
        ends.set(node.uuid, yield* edges.farEndOf({ uuid: node.uuid, projectId: to.projectId, tags: node.tags }));
      return {
        address: { graph: home.uuid, label: home.title } satisfies GraphAddress,
        held: held.length,
        standing: held.length === uuids.length && copy !== undefined ? (yield* carriedOf(copy.id)).blocks : null,
        law,
        ends,
        running: yield* runningIn(to.projectId),
      };
    }),
  );
  const resumed = arrival.held > 0;
  if (resumed && (arrival.standing === null || contentOf(arrival.standing) !== contentOf(carried.blocks))) {
    const there = yield* nameOf(to.projectId);
    return yield* new GateRefusal(
      'relocation-stale',
      `${name} stands in ${there} too, left by a move that stopped half way, and the two copies differ`,
      [
        `delete_block ${to.projectId}/${name} — the copy in ${there} — then repeat the move as update_block ${name}`,
        `or delete_block ${from.projectId}/${name} to keep the copy in ${there}`,
      ],
    );
  }
  const { running } = arrival.law;
  const sourceLaw: LawReading | null = leaving.cards.size === 0 || leaving.stood.length === 0 ? null : yield* lawOf(from);
  const targetLaw: LawReading | null =
    resumed || (running.length === 0 && (!arrival.law.cards || arrival.running.length === 0)) ? null : yield* lawOf(to);
  if (targetLaw !== null) {
    const unknown = running.flatMap(({ uuid, key }) => {
      const why = targetLaw.undeclared(key);
      return why === null ? [] : [`${blockName(uuid)} runs ${key}: ${why}`];
    });
    if (unknown.length > 0) {
      return yield* new GateRefusal(
        'inspection-unknown',
        `a moving rule runs an inspection the new graph's checkout does not declare at HEAD: ${unknown.join('; ')}`,
        [
          `land tagma.config.ts with each named inspection in ${yield* nameOf(to.projectId)} first, then move again`,
          'or enforce_rule strictness off on the rule before the move, and enforce it in its new graph',
        ],
      );
    }
  }
  const moving = new Set(uuids);
  const sourceKeys = {
    before: leaving.stood.map((one) => one.key),
    after: leaving.stood.filter((one) => !moving.has(one.uuid)).map((one) => one.key),
  };
  const sourceCards =
    sourceLaw === null
      ? null
      : yield* atTarget(
          from,
          Effect.flatMap(Blocks, (blocks) => blocks.moduleCards(from.projectId)),
        );
  const sourceStood = sourceLaw === null || sourceCards === null ? null : sourceLaw.mapProblems(sourceKeys.before, sourceCards);
  if (sourceLaw !== null && sourceCards !== null && sourceStood !== null) {
    const fresh = freshProblems(sourceStood, sourceLaw.mapProblems(sourceKeys.after, withoutCards(sourceCards, leaving.cards)));
    if (fresh.length > 0) return yield* mapRefusal(yield* nameOf(from.projectId), fresh);
  }
  const targetKeys = {
    before: arrival.running.map((one) => one.key),
    after: [...arrival.running, ...running].map((one) => one.key),
  };
  const targetStood =
    targetLaw === null
      ? null
      : targetLaw.mapProblems(
          targetKeys.before,
          yield* atTarget(
            to,
            Effect.flatMap(Blocks, (blocks) => blocks.moduleCards(to.projectId)),
          ),
        );
  const arriving = resumed ? carried.blocks : yield* endsOf(carried.blocks, arrival.address.graph);

  const land = Effect.gen(function* () {
    const blocks = yield* Blocks;
    const born = yield* blocks.arrive({ projectId: to.projectId, parentId: to.row.id, from: carried.graph.graph, blocks: arriving });
    if (targetLaw !== null && targetStood !== null) {
      const fresh = freshProblems(targetStood, targetLaw.mapProblems(targetKeys.after, yield* blocks.moduleCards(to.projectId)));
      if (fresh.length > 0) return yield* mapRefusal(yield* nameOf(to.projectId), fresh);
    }
    return born;
  });
  const leave = Effect.gen(function* () {
    if (snapshotOf((yield* carriedOf(from.row.id)).blocks) !== snapshotOf(carried.blocks)) {
      return yield* new GateRefusal('relocation-stale', `${name} or a block under it changed while it moved`, [
        'read it again and repeat the move: it moves as it stands then',
      ]);
    }
    yield* partedDebt(from.projectId, leaving.ids);
    yield* assertIncoming(leaving.ids, arrival.ends);
    yield* (yield* Trash).depart({ id: from.row.id, to: arrival.address });
    if (sourceLaw !== null && sourceStood !== null) {
      const fresh = freshProblems(sourceStood, sourceLaw.mapProblems(sourceKeys.after, yield* (yield* Blocks).moduleCards(from.projectId)));
      if (fresh.length > 0) return yield* mapRefusal(yield* nameOf(from.projectId), fresh);
    }
  });

  const write = yield* Effect.uninterruptible(
    shared
      ? atTarget(from, inUnit(Effect.andThen(leave, atTarget(to, land))))
      : Effect.gen(function* () {
          const born = resumed
            ? yield* atTarget(
                to,
                Effect.gen(function* () {
                  const rows = yield* BlockRows;
                  const { db } = yield* GraphStore;
                  const root = yield* db
                    .select()
                    .from(block)
                    .where(and(eq(block.projectId, to.projectId), eq(block.uuid, from.row.uuid), isNull(block.deletedAt)))
                    .get();
                  if (root === undefined) return yield* Effect.die(`${name} left the graph it was held in`);
                  return yield* rows.written(root, false);
                }),
              )
            : yield* atTarget(to, inUnit(land));
          const left = yield* Effect.exit(atTarget(from, inUnit(leave)));
          if (Exit.isSuccess(left)) return born;
          if (resumed) return yield* Effect.failCause(left.cause);
          yield* atTarget(
            to,
            Effect.flatMap(Trash, (trash) => trash.depart({ id: born.id, to: carried.graph })),
          ).pipe(
            Effect.mapError(
              (failure) =>
                new GateRefusal(
                  'relocation-unfinished',
                  `${name} arrived in project ${to.projectId} and could not leave project ${from.projectId}, and taking the arrival back failed: ${reasonOf(failure)}`,
                  [
                    `the subtree stands in both graphs: repeat the move as update_block ${from.projectId}/${name} to finish it`,
                    `or delete_block ${to.projectId}/${name} to keep it where it was`,
                  ],
                ),
            ),
          );
          return yield* Effect.failCause(left.cause);
        }),
  );
  const { relinked, left } = yield* readdressed(from, carried, to, arrival.address);
  const moved: Moved = {
    blocks: carried.blocks.length,
    from: yield* nameOf(from.projectId),
    relinked,
    dropped: leaving.dropped.length === 0 ? undefined : leaving.dropped,
    left: left.length === 0 ? undefined : left,
  };
  return { write, moved };
});
