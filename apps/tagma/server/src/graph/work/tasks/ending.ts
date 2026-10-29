import { Clock, Effect, Layer } from 'effect';
import { type FloorRefusal, GateRefusal } from '../../../platform/contract/wire/refusal.js';
import { eq } from 'drizzle-orm';
import { GraphStore, type StoreFailure } from '../../../platform/contract/service/store.js';
import { type WriterRef, WriterRegister } from '../../../platform/contract/service/writers.js';
import { SessionIdentity } from '../../../platform/contract/wire/session.js';
import { block, touch } from '../../store/tables.js';
import { Act, BlockNames, BlockProjection } from '../../contract/service/acts.js';
import { BlockRows } from '../../acts/rows.js';
import { type BlockRow } from '../../contract/service/acts.js';
import { Tasks, type BlockEnd, type BlockEnding, type WorklessSpec, type WorklessSpecs } from '../../contract/service/work.js';
import { WORK } from '../../contract/wire/tags/work.js';
import { worklessSpecsOf } from '../worklessSpecs.js';
import { farSpecsOf, withoutFarWork } from '../worklessFar.js';
import { checkTransition, openChildrenOf } from '../lifecycle.js';
import { movedFields } from '../movedFields.js';
import { endingStatus, statusMove, tagLabel } from '../../contract/wire/tags/roles.js';
import type { TagTable } from '../../contract/wire/tags/table.js';
import { Tags } from '../../contract/service/vocabulary.js';
import { assertStanding } from '../retirement.js';
import { GraphJournal } from '../../contract/service/journal.js';
import { Touches } from '../../contract/service/orientation.js';
import { type EndingPayload, readJournal } from '../../contract/wire/journalPayloads.js';
import { blockName } from '../../contract/wire/references.js';
import { taskHolding } from './holding.js';
import { sessionWork } from './sessionWork.js';
import type { HolderStandings } from '../../contract/service/holders.js';
import { writes } from '../../../platform/contract/service/writes.js';
import { projecting } from '../../store/actWrites.js';
import { LIFECYCLE } from '../../contract/wire/tags/lifecycle.js';
import { HOLDER } from '../../contract/wire/tags/holder.js';

const finishing = writes('Tasks.finish', [block, touch], projecting);
const closing = writes('Tasks.close', [block, touch], projecting);

type FinishInput = {
  id: number;
  commit?: string;
  operator?: boolean;
};

type ClosingInput = {
  id: number;
  reason?: string;
  operator?: boolean;
};

type EndRefusal =
  | FloorRefusal
  | 'not-found'
  | 'deleted'
  | 'superseded'
  | 'not-closable'
  | 'open-children'
  | 'status-operation'
  | 'no-status'
  | 'illegal-status'
  | 'illegal-transition';

const taskEnding = Effect.gen(function* () {
  const { db } = yield* GraphStore;
  const act = yield* Act;
  const blockRows = yield* BlockRows;
  const blockNames = yield* BlockNames;
  const blockProjection = yield* BlockProjection;
  const journal = yield* GraphJournal;
  const sessions = yield* WriterRegister;
  const touches = yield* Touches;
  const vocabulary = yield* Tags;

  const tableOf = (row: { projectId: number }) => vocabulary.of(row.projectId);

  const standingBlock = Effect.fn('Tasks.standingBlock')(function* (id: number, attempt: 'be finished' | 'be closed') {
    const current = yield* blockRows.blockById(id);
    const table = yield* tableOf(current);
    yield* assertStanding(blockRows, blockNames, id, attempt);
    return { current, table };
  });

  const assertEndable = Effect.fn('Tasks.assertEndable')(function* (current: BlockRow, table: TagTable, operator: boolean) {
    if (!table.supports(current, LIFECYCLE)) {
      return yield* new GateRefusal(
        'not-closable',
        `${tagLabel(table.tagOf(current))} supports no core/lifecycle, so it reports no work and does not end; supersede it`,
        [
          'supersede_block — a node that reports no work leaves the working set by being replaced',
          'update_block — a node that records what IS is rewritten where it stands',
        ],
      );
    }
    if (operator) return;
    const openChildren = yield* openChildrenOf(db, table, current);
    if (openChildren.length > 0) {
      return yield* new GateRefusal(
        'open-children',
        `${table.tagOf(current)?.id ?? 'node'}.open-children: ${tagLabel(table.tagOf(current))} has open child work: ${openChildren.join(', ')}`,
        ['finish or close the child work first'],
      );
    }
  });

  const endingWord = Effect.fn('Tasks.endingWord')(function* (current: BlockRow, table: TagTable, outcome: 'done' | 'closed') {
    const standingStatus = table.statusOf(current);
    const endingTag = table.bindingTag(current, LIFECYCLE);
    const ending = endingTag === null ? null : endingStatus(endingTag, outcome);
    if (ending === null) {
      return yield* new GateRefusal(
        'illegal-status',
        `${tagLabel(endingTag ?? table.tagOf(current))} names no word for ${outcome === 'done' ? 'work that happened' : 'work decided against'}`,
        [
          `close_block ${blockName(current.uuid)} with a reason — what stands open and is not wanted is closed`,
          `read_block ${blockName(current.uuid)} — what this node is, and whether its tag reports work at all`,
        ],
      );
    }
    const verdict = checkTransition(table.actionsOn(current), endingTag, standingStatus, ending);
    if (!verdict.ok) return yield* new GateRefusal(verdict.code, verdict.reason, verdict.unblock);
    return { endingTag, standingStatus, ending };
  });

  const writeEnding = Effect.fn('Tasks.writeEnding')(function* (id: number, current: BlockRow, table: TagTable, ending: string, now: Date) {
    const row = yield* db
      .update(block)
      .set({ fields: movedFields(table, current, ending), updatedAt: now })
      .where(eq(block.id, id))
      .returning()
      .get();
    if (!row) return yield* Effect.die('block close returned no row');
    yield* blockProjection.syncTags(row.id);
    if (table.supports(row, HOLDER)) yield* touches.retire(row.id);
    return row;
  });

  const worklessSpecs = Effect.fn('Tasks.worklessSpecs')(function* (
    where: WorklessSpecs,
  ): Effect.fn.Return<readonly WorklessSpec[], StoreFailure> {
    const table = yield* vocabulary.of(where.projectId);
    const local = yield* withoutFarWork(db, table, where.projectId, yield* worklessSpecsOf(db, table, where));
    return 'above' in where ? [...local, ...(yield* farSpecsOf(db, table, where.above))] : local;
  });

  const specsLeftBy = Effect.fn('Tasks.specsLeftBy')(function* (
    ended: readonly BlockEnd[],
  ): Effect.fn.Return<readonly WorklessSpec[], StoreFailure> {
    const byProject = new Map<number, number[]>();
    for (const row of ended) {
      if (!(yield* tableOf(row)).supports(row, WORK)) continue;
      byProject.set(row.projectId, [...(byProject.get(row.projectId) ?? []), row.id]);
    }
    const found = new Map<string, WorklessSpec>();
    for (const [projectId, above] of byProject) {
      for (const spec of yield* worklessSpecs({ projectId, above })) found.set(`${spec.projectId ?? projectId}/${spec.uuid}`, spec);
    }
    return [...found.values()];
  });

  const faces: Pick<Tasks['Service'], 'finish' | 'close' | 'endings' | 'worklessSpecs' | 'specsLeftBy'> = {
    worklessSpecs,
    specsLeftBy,

    finish: Effect.fn('Tasks.finish')(function* (input: FinishInput): Effect.fn.Return<BlockEnd, StoreFailure | GateRefusal<EndRefusal>> {
      const { current, table } = yield* standingBlock(input.id, 'be finished');
      yield* assertEndable(current, table, input.operator ?? false);
      const { endingTag, standingStatus, ending } = yield* endingWord(current, table, 'done');
      const now = new Date(yield* Clock.currentTimeMillis);
      return yield* act.unit(
        finishing,
        Effect.gen(function* () {
          const row = yield* writeEnding(input.id, current, table, ending, now);
          const move = endingTag === null ? {} : (statusMove(endingTag, standingStatus, ending) ?? {});
          yield* act.record('done', row.id, { ...move, commit: input.commit ?? null, reason: null }, now);
          return yield* blockRows.recordOf(row);
        }),
      );
    }),

    close: Effect.fn('Tasks.close')(function* (input: ClosingInput): Effect.fn.Return<BlockEnd, StoreFailure | GateRefusal<EndRefusal>> {
      const { current, table } = yield* standingBlock(input.id, 'be closed');
      yield* assertEndable(current, table, input.operator ?? false);
      const { endingTag, standingStatus, ending } = yield* endingWord(current, table, 'closed');
      const now = new Date(yield* Clock.currentTimeMillis);
      return yield* act.unit(
        closing,
        Effect.gen(function* () {
          const row = yield* writeEnding(input.id, current, table, ending, now);
          const cause = { reason: input.reason?.trim() || null };
          const move = endingTag === null ? {} : (statusMove(endingTag, standingStatus, ending) ?? {});
          yield* act.record('close', row.id, { ...move, ...cause }, now);
          return yield* blockRows.recordOf(row);
        }),
      );
    }),

    endings: Effect.fn('Tasks.endings')(function* (
      rows: readonly BlockRow[],
    ): Effect.fn.Return<ReadonlyMap<number, BlockEnding>, StoreFailure> {
      const ended: { row: BlockRow; status: string }[] = [];
      const tables = new Map<number, TagTable>();
      for (const row of rows) {
        const table = tables.get(row.projectId) ?? (yield* tableOf(row));
        tables.set(row.projectId, table);
        const status = table.statusOf(row);
        if (status === null || !table.isTerminal(row)) continue;
        ended.push({ row, status });
      }
      const entries = yield* journal.newest(
        ended.map((entry) => entry.row.id),
        ['done', 'close'],
      );
      const payloads = new Map<number, EndingPayload>();
      const unreadable = new Map<number, string>();
      for (const [id, entry] of entries) {
        const read = readJournal.ending(entry);
        if (read._tag === 'Success') payloads.set(id, read.success);
        else {
          payloads.set(id, {});
          unreadable.set(id, read.failure.message);
        }
      }
      const sessionRows = yield* sessions.named(
        [...entries.values()].flatMap((entry) => (entry.sessionId === null ? [] : [entry.sessionId])),
      );
      const writers = new Map<number, WriterRef>(
        sessionRows.map((row) => [row.id, { id: row.id, harness: row.harness, key: row.key }] as const),
      );
      const endings = new Map<number, BlockEnding>();
      for (const { row, status } of ended) {
        const entry = entries.get(row.id);
        const payload = payloads.get(row.id);
        if (entry === undefined || payload === undefined) continue;
        const happened = entry.op === 'done';
        endings.set(row.id, {
          status,
          writer: entry.sessionId === null ? null : (writers.get(entry.sessionId) ?? null),
          reason: payload.reason ?? null,
          at: entry.ts,
          ...(unreadable.has(row.id) ? { unreadable: unreadable.get(row.id) } : happened ? { commit: payload.commit ?? null } : {}),
        });
      }
      return endings;
    }),
  };
  return faces;
});

export const tasksLayer: Layer.Layer<
  Tasks,
  never,
  | GraphStore
  | Act
  | GraphJournal
  | WriterRegister
  | Touches
  | Tags
  | SessionIdentity
  | BlockRows
  | BlockNames
  | BlockProjection
  | HolderStandings
> = Layer.effect(
  Tasks,
  Effect.gen(function* () {
    const holding = yield* taskHolding;
    const ending = yield* taskEnding;
    const work = yield* sessionWork;
    return Tasks.of({
      heldElsewhere: holding.heldElsewhere,
      idle: holding.idle,
      holdings: holding.holdings,
      workOf: work.workOf,
      handOver: holding.handOver,
      claimable: holding.claimable,
      claim: holding.claim,
      release: holding.release,
      finish: ending.finish,
      close: ending.close,
      endings: ending.endings,
      worklessSpecs: ending.worklessSpecs,
      specsLeftBy: ending.specsLeftBy,
    });
  }),
);
