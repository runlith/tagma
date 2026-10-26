import { Clock, Effect } from 'effect';
import { type FloorRefusal, type Unblock, GateRefusal } from '../../../platform/contract/wire/refusal.js';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { GraphStore, type StoreFailure } from '../../../platform/contract/service/store.js';
import { SignedSession, WriterRegister } from '../../../platform/contract/service/writers.js';
import { SessionIdentity, sessionName, type SessionRef } from '../../../platform/contract/wire/session.js';
import { block, touch } from '../../store/tables.js';
import { Act, BlockNames, BlockProjection } from '../../contract/service/acts.js';
import { BlockRows } from '../../acts/rows.js';
import { type BlockRecord, type BlockRow } from '../../contract/service/acts.js';
import { checkTransition } from '../lifecycle.js';
import { movedFields } from '../movedFields.js';
import { transactionUnit } from '../../acts/state.js';
import { claimedStatus, releasedStatus, statusMove, tagLabel } from '../../contract/wire/tags/roles.js';
import { Tags } from '../../contract/service/vocabulary.js';
import { assertStanding } from '../retirement.js';
import { Touches } from '../../contract/service/orientation.js';
import { blockName } from '../../contract/wire/references.js';
import { writes } from '../../../platform/contract/service/writes.js';
import { projecting } from '../../store/actWrites.js';
import { LIFECYCLE } from '../../contract/wire/tags/lifecycle.js';
import { HOLDER, HOLDER_SLOT } from '../../contract/wire/tags/holder.js';
import { carriesContract, contractAt, slotIn } from '../../vocabulary/projection.js';
import { GraphJournal } from '../../contract/service/journal.js';
import type { TagTable } from '../../contract/wire/tags/table.js';
import type { Tag } from '../../contract/wire/tags/declaration.js';
import type { HeldWork } from '../../contract/wire/operations/shared.js';
import type { ClaimRefusal, IdleWork } from '../../contract/service/work.js';
import type { HeldTask } from '../../contract/service/serving.js';
import { HolderStandings } from '../../contract/service/holders.js';
import { abandoned } from '../../contract/wire/holders.js';
import { WORK } from '../../contract/wire/tags/work.js';
import { measuredCondition } from '../../acts/measurement.js';
import { scopeCondition } from '../../search/selection.js';
import { holdersOf } from './holders.js';

const claiming = writes('Tasks.claim', [block], projecting);
const releasing = writes('Tasks.release', [block, touch], projecting);

function movedExits(name: string): Unblock {
  return [`read_block ${name} — where it stands now`, `claim_block ${name} again`];
}

export const standingWork = (table: TagTable, projectId: number) =>
  and(
    eq(block.projectId, projectId),
    isNull(block.deletedAt),
    carriesContract(table, WORK, block.id),
    sql`not (${measuredCondition(table).superseded})`,
  );

export const heldBy = (table: TagTable, from: number) =>
  and(contractAt(table, HOLDER, 'active', block.id), slotIn(table, HOLDER, HOLDER_SLOT, [String(from)], block.id));

type ClaimPlan =
  | { readonly kind: 'kept' }
  | { readonly kind: 'taken-over'; readonly standing: string }
  | { readonly kind: 'taken'; readonly tag: Tag; readonly standing: string | null; readonly taken: string };

type ReleaseRefusal =
  | FloorRefusal
  | 'not-found'
  | 'deleted'
  | 'no-holder'
  | 'not-held'
  | 'no-status'
  | 'illegal-status'
  | 'illegal-transition';

export const taskHolding = Effect.gen(function* () {
  const { db } = yield* GraphStore;
  const act = yield* Act;
  const blockRows = yield* BlockRows;
  const blockNames = yield* BlockNames;
  const blockProjection = yield* BlockProjection;
  const sessions = yield* WriterRegister;
  const identity = yield* SessionIdentity;
  const touches = yield* Touches;
  const vocabulary = yield* Tags;
  const standings = yield* HolderStandings;
  const journal = yield* GraphJournal;

  const tableOf = (row: { projectId: number }) => vocabulary.of(row.projectId);

  const holds = Effect.fn('Tasks.holds')(function* (current: BlockRow, as?: SessionRef) {
    const caller = as ?? (yield* SignedSession);
    const held = (yield* tableOf(current)).holderOf(current);
    return caller === null ? held === null : held !== null && held === (yield* sessions.idOf(caller));
  });

  const holderIn = (unit: Effect.Success<typeof transactionUnit>, as: SessionRef | undefined) =>
    as === undefined ? sessions.signedId(unit) : Effect.map(sessions.resolve(unit, as), (row) => row.id);

  const heldElsewhere = Effect.fn('Tasks.heldElsewhere')(function* (row: BlockRow): Effect.fn.Return<HeldWork | null, StoreFailure> {
    const table = yield* tableOf(row);
    if (!table.standsAt(row, HOLDER, 'active') || (yield* holds(row))) return null;
    const held = table.holderOf(row);
    const holder = held === null ? undefined : (yield* holdersOf(sessions, standings, [held])).get(held);
    if (abandoned(holder?.state)) return null;
    return {
      name: blockName(row.uuid),
      title: row.title,
      holder: holder === undefined ? 'the operator' : `session ${sessionName(holder.session, identity)}`,
    };
  });

  const idle = Effect.fn('Tasks.idle')(function* (input: {
    readonly projectId: number;
    readonly scopeId?: number | undefined;
  }): Effect.fn.Return<readonly IdleWork[], StoreFailure> {
    const table = yield* vocabulary.of(input.projectId);
    const rows = yield* db
      .select()
      .from(block)
      .where(
        and(
          eq(block.projectId, input.projectId),
          isNull(block.deletedAt),
          carriesContract(table, WORK, block.id),
          contractAt(table, WORK, 'active', block.id),
          sql`not (${measuredCondition(table).superseded})`,
          input.scopeId === undefined ? undefined : scopeCondition(input.scopeId),
        ),
      )
      .orderBy(asc(block.updatedAt), asc(block.id));
    const holders = yield* holdersOf(
      sessions,
      standings,
      rows.flatMap((row) => {
        const held = table.holderOf(row);
        return held === null ? [] : [held];
      }),
    );
    return rows.flatMap((row) => {
      const held = table.holderOf(row);
      const holder = held === null ? undefined : holders.get(held);
      return holder?.state !== undefined && abandoned(holder.state)
        ? [{ id: row.id, holder: holder.session, standing: holder.state.standing }]
        : [];
    });
  });

  const takeOver = Effect.fn('Tasks.takeOver')(function* (
    current: BlockRow,
    table: TagTable,
    status: string,
    from: number | null,
    as: SessionRef | undefined,
  ) {
    const now = new Date(yield* Clock.currentTimeMillis);
    return yield* act.unit(
      claiming,
      Effect.gen(function* () {
        const holder = yield* holderIn(yield* transactionUnit, as);
        const row = yield* db
          .update(block)
          .set({ fields: movedFields(table, current, status, holder), updatedAt: now })
          .where(
            and(
              eq(block.id, current.id),
              contractAt(table, HOLDER, 'active', block.id),
              from === null ? undefined : slotIn(table, HOLDER, HOLDER_SLOT, [String(from)], block.id),
            ),
          )
          .returning()
          .get();
        if (!row) {
          return yield* new GateRefusal(
            'claimed-elsewhere',
            `${blockName(current.uuid)} left work while it was being taken over`,
            movedExits(blockName(current.uuid)),
          );
        }
        yield* blockProjection.syncTags(row.id);
        yield* act.record('claim', row.id, {}, now, as === undefined || holder === null ? undefined : holder);
        return yield* blockRows.recordOf(row);
      }),
    );
  });

  const planClaim = Effect.fn('Tasks.planClaim')(function* (
    current: BlockRow,
    table: TagTable,
    as: SessionRef | undefined,
  ): Effect.fn.Return<ClaimPlan, StoreFailure | GateRefusal<ClaimRefusal>> {
    if (!table.supports(current, HOLDER)) {
      return yield* new GateRefusal(
        'no-holder',
        `${blockName(current.uuid)} is ${tagLabel(table.tagOf(current))}, which binds no holder, and only a node somebody can hold is taken`,
        [
          'ready_work — the open work with no unfinished blocker',
          `${tagLabel(table.tagOf(current))} is worked through the work that implements it, never held itself`,
        ],
      );
    }
    yield* assertStanding(blockRows, blockNames, current.id, 'be taken');
    const tag = table.bindingTag(current, LIFECYCLE);
    const standing = table.statusOf(current);
    if (table.standsAt(current, HOLDER, 'active') && standing !== null) {
      return (yield* holds(current, as)) ? { kind: 'kept' as const } : { kind: 'taken-over' as const, standing };
    }
    const taken = tag === null ? null : claimedStatus(tag);
    if (tag === null || taken === null) {
      const holderTag = tag ?? table.bindingTag(current, HOLDER);
      return yield* new GateRefusal(
        'illegal-status',
        `${tagLabel(holderTag)} names no word for work underway, so nothing about it can be taken`,
        [
          `read_tags — choose a type binding ${HOLDER} with an initial → claimed lifecycle transition, or declare it on ${tagLabel(holderTag)}`,
        ],
      );
    }
    const verdict = checkTransition(table.actionsOn(current), tag, standing, taken);
    if (!verdict.ok) return yield* new GateRefusal(verdict.code, verdict.reason, verdict.unblock);
    return { kind: 'taken' as const, tag, standing, taken };
  });

  const claimable = Effect.fn('Tasks.claimable')(function* (input: { id: number }) {
    const current = yield* blockRows.blockById(input.id);
    yield* planClaim(current, yield* tableOf(current), undefined);
  });

  const claim = Effect.fn('Tasks.claim')(function* (input: {
    id: number;
    as?: SessionRef | undefined;
    over?: number | null | undefined;
  }): Effect.fn.Return<BlockRecord, StoreFailure | GateRefusal<ClaimRefusal>> {
    const current = yield* blockRows.blockById(input.id);
    const table = yield* tableOf(current);
    const plan = yield* planClaim(current, table, input.as);
    if (plan.kind === 'kept') return yield* blockRows.recordOf(current);
    if (plan.kind === 'taken-over') {
      const holder = table.holderOf(current);
      if (input.over !== undefined && input.over !== holder) {
        return yield* new GateRefusal(
          'claimed-elsewhere',
          `${blockName(current.uuid)} changed hands after the take-over was agreed, so it is not taken from a holder nobody agreed to`,
          movedExits(blockName(current.uuid)),
        );
      }
      return yield* takeOver(current, table, plan.standing, holder, input.as);
    }
    const { tag, standing, taken } = plan;
    const now = new Date(yield* Clock.currentTimeMillis);
    return yield* act.unit(
      claiming,
      Effect.gen(function* () {
        const assigneeSessionId = yield* holderIn(yield* transactionUnit, input.as);
        const row = yield* db
          .update(block)
          .set({ fields: movedFields(table, current, taken, assigneeSessionId), updatedAt: now })
          .where(and(eq(block.id, input.id), contractAt(table, LIFECYCLE, 'initial', block.id)))
          .returning()
          .get();
        if (!row)
          return yield* new GateRefusal('claimed-elsewhere', 'the block was claimed concurrently', movedExits(blockName(current.uuid)));
        yield* blockProjection.syncTags(row.id);
        yield* act.record(
          'claim',
          row.id,
          statusMove(tag, standing, taken) ?? {},
          now,
          input.as === undefined || assigneeSessionId === null ? undefined : assigneeSessionId,
        );
        return yield* blockRows.recordOf(row);
      }),
    );
  });

  const release = Effect.fn('Tasks.release')(function* (input: {
    id: number;
  }): Effect.fn.Return<BlockRecord, StoreFailure | GateRefusal<ReleaseRefusal>> {
    const current = yield* blockRows.blockById(input.id);
    const table = yield* tableOf(current);
    if (!table.supports(current, HOLDER)) {
      return yield* new GateRefusal(
        'no-holder',
        `${blockName(current.uuid)} is ${tagLabel(table.tagOf(current))}, and only a node whose tag binds a holder is given back`,
        [`read_block ${blockName(current.uuid)} — what this node is, and which tag carries a holder`],
      );
    }
    const tag = table.bindingTag(current, LIFECYCLE);
    const standing = table.statusOf(current);
    if (tag === null || !table.standsAt(current, HOLDER, 'active')) {
      return yield* new GateRefusal('not-held', `${tagLabel(tag)} is "${standing}", so nobody holds it`, [
        `claim_block ${blockName(current.uuid)} — take it first; only claimed work returns to the pool`,
      ]);
    }
    const waiting = releasedStatus(tag);
    if (waiting === null) {
      return yield* new GateRefusal('illegal-status', `${tagLabel(tag)} is "${standing}", and its tag declares no move back out of work`, [
        `finish_block ${blockName(current.uuid)} — work that cannot be given back is ended instead`,
      ]);
    }
    const verdict = checkTransition(table.actionsOn(current), tag, standing, waiting);
    if (!verdict.ok) return yield* new GateRefusal(verdict.code, verdict.reason, verdict.unblock);
    const now = new Date(yield* Clock.currentTimeMillis);
    return yield* act.unit(
      releasing,
      Effect.gen(function* () {
        const row = yield* db
          .update(block)
          .set({ fields: movedFields(table, current, waiting, null), updatedAt: now })
          .where(eq(block.id, input.id))
          .returning()
          .get();
        if (!row) return yield* Effect.die('block release returned no row');
        yield* blockProjection.syncTags(row.id);
        yield* touches.retire(row.id);
        yield* act.record('release', row.id, statusMove(tag, standing, waiting) ?? {}, now);
        return yield* blockRows.recordOf(row);
      }),
    );
  });

  const holdings = Effect.fn('Tasks.holdings')(function* (input: { readonly projectId: number; readonly from: SessionRef }) {
    const from = yield* sessions.idOf(input.from);
    if (from === null) return { held: [], filed: [] };
    const table = yield* vocabulary.of(input.projectId);
    const held = yield* db
      .select({ uuid: block.uuid, title: block.title })
      .from(block)
      .where(and(standingWork(table, input.projectId), heldBy(table, from)))
      .orderBy(asc(block.createdAt), asc(block.id));
    const created = yield* journal.events({
      projectId: input.projectId,
      sessions: [from],
      ops: ['create'],
      tags: table.typesSupporting(WORK),
    });
    const ids = [...new Set(created.flatMap((entry) => (entry.blockId === null ? [] : [entry.blockId])))];
    const filed =
      ids.length === 0
        ? []
        : yield* db
            .select({ uuid: block.uuid, title: block.title })
            .from(block)
            .where(and(standingWork(table, input.projectId), contractAt(table, WORK, 'initial', block.id), inArray(block.id, ids)))
            .orderBy(asc(block.createdAt), asc(block.id));
    const named = (rows: readonly { readonly uuid: string; readonly title: string }[]) =>
      rows.map((row) => ({ name: blockName(row.uuid), title: row.title }));
    return { held: named(held), filed: named(filed) };
  });

  const passOn = Effect.fn('Tasks.passOn')(function* (row: BlockRow, table: TagTable, from: number, to: SessionRef | null) {
    const tag = table.bindingTag(row, LIFECYCLE);
    const standing = table.statusOf(row);
    if (tag === null || standing === null) return false;
    const word = to === null ? releasedStatus(tag) : standing;
    if (word === null || (to === null && !checkTransition(table.actionsOn(row), tag, standing, word).ok)) return false;
    const now = new Date(yield* Clock.currentTimeMillis);
    return yield* act.unit(
      to === null ? releasing : claiming,
      Effect.gen(function* () {
        const holder = to === null ? null : (yield* sessions.resolve(yield* transactionUnit, to)).id;
        const moved = yield* db
          .update(block)
          .set({ fields: movedFields(table, row, word, holder), updatedAt: now })
          .where(and(eq(block.id, row.id), heldBy(table, from)))
          .returning()
          .get();
        if (!moved) return false;
        yield* blockProjection.syncTags(moved.id);
        if (holder === null) {
          yield* touches.retire(moved.id);
          yield* act.record('release', moved.id, statusMove(tag, standing, word) ?? {}, now, from);
        } else yield* act.record('claim', moved.id, {}, now, holder);
        return true;
      }),
    );
  });

  const handOver = Effect.fn('Tasks.handOver')(function* (input: {
    readonly projectId: number;
    readonly from: SessionRef;
    readonly to: SessionRef | null;
  }) {
    const from = yield* sessions.idOf(input.from);
    if (from === null) return [];
    const table = yield* vocabulary.of(input.projectId);
    const held = yield* db
      .select()
      .from(block)
      .where(and(standingWork(table, input.projectId), heldBy(table, from)))
      .orderBy(asc(block.createdAt), asc(block.id));
    const handed: HeldTask[] = [];
    for (const row of held) {
      if (yield* passOn(row, table, from, input.to)) handed.push({ name: blockName(row.uuid), title: row.title });
    }
    return handed;
  });

  return { heldElsewhere, idle, claimable, claim, release, holdings, handOver };
});
