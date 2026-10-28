import { Clock, Effect } from 'effect';
import { eq } from 'drizzle-orm';
import { GraphStore, type StoreFailure } from '../../../platform/contract/service/store.js';
import { type WriterRef, WriterRegister } from '../../../platform/contract/service/writers.js';
import { block } from '../../store/tables.js';
import { Amendments, type Accepted, type AcceptedRefusal, type ProposalVerdictRow } from '../../contract/service/work.js';
import { type FloorRefusal, GateRefusal } from '../../../platform/contract/wire/refusal.js';
import { verdictReason } from '../../acts/records.js';
import { Act, BlockNames, BlockProjection } from '../../contract/service/acts.js';
import { BlockRows } from '../../acts/rows.js';
import { type BlockRecord, type BlockRow } from '../../contract/service/acts.js';
import { checkTransition } from '../lifecycle.js';
import { type VerdictPayload, readJournal } from '../../contract/wire/journalPayloads.js';
import { type AmendmentVerdict, type StatusMove, statusMove, tagLabel, verdictStatus } from '../../contract/wire/tags/roles.js';
import type { TagTable } from '../../contract/wire/tags/table.js';
import { Tags } from '../../contract/service/vocabulary.js';
import { blockName } from '../../contract/wire/references.js';
import { GraphJournal } from '../../contract/service/journal.js';
import { type ProposalFiling } from './filing.js';
import { deferredOps } from './payload.js';
import type { AmendmentRefusal } from '../../contract/service/blocks.js';
import { writes } from '../../../platform/contract/service/writes.js';
import { linking, projecting } from '../../store/actWrites.js';
import { LIFECYCLE, lifecycleOf } from '../../contract/wire/tags/lifecycle.js';
import { AMENDMENT } from '../../contract/wire/tags/amendment.js';
import { Edges } from '../../contract/service/blocks.js';

const accepting = writes('Review.accept', [block], projecting, linking);
const rejecting = writes('Review.reject', [block], projecting);
const upholding = writes('Review.uphold', [block], projecting);

function amendmentVerdict(table: TagTable, row: BlockRow, verdict: AmendmentVerdict): string {
  const tag = table.bindingTag(row, AMENDMENT) ?? table.tagOf(row);
  return (tag === null ? null : verdictStatus(tag, verdict)) ?? verdict;
}

function withStatus(table: TagTable, row: BlockRow, word: string): Record<string, unknown> {
  const tag = table.bindingTag(row, LIFECYCLE);
  const name = tag === null ? undefined : lifecycleOf(tag)?.field;
  return name === undefined ? { ...row.fields } : { ...row.fields, [name]: word };
}

function verdictMove(table: TagTable, row: BlockRow, word: string): Partial<StatusMove> {
  const tag = table.bindingTag(row, LIFECYCLE);
  return tag === null ? {} : (statusMove(tag, table.statusOf(row), word) ?? {});
}

type VerdictRefusal = FloorRefusal | 'not-found' | 'deleted' | 'not-an-amendment' | 'no-status' | 'illegal-status' | 'illegal-transition';

type AcceptRefusal = VerdictRefusal | AmendmentRefusal | AcceptedRefusal | 'anchor-not-found' | 'field-invalid';

type RejectRefusal = VerdictRefusal | 'reason-required';

type UpholdRefusal = VerdictRefusal | 'reason-required' | 'self-answer' | 'cross-project';

export const proposalVerdicts = Effect.fnUntraced(function* (filing: ProposalFiling) {
  const { db } = yield* GraphStore;
  const act = yield* Act;
  const blockRows = yield* BlockRows;
  const blockNames = yield* BlockNames;
  const blockProjection = yield* BlockProjection;
  const journal = yield* GraphJournal;
  const sessions = yield* WriterRegister;
  const amendments = yield* Amendments;
  const edges = yield* Edges;
  const vocabulary = yield* Tags;
  const tableOf = (row: { projectId: number }) => vocabulary.of(row.projectId);
  const { assertAmendment, amendsEdgeOf } = filing;

  return {
    accept: Effect.fn('Review.accept')(function* (input: {
      id: number;
      reason?: string;
      enclosing?: ReadonlyMap<string, number>;
    }): Effect.fn.Return<Accepted, StoreFailure | GateRefusal<AcceptRefusal>> {
      const current = yield* blockRows.blockById(input.id);
      const table = yield* tableOf(current);
      if (!table.supports(current, AMENDMENT)) {
        return yield* new GateRefusal(
          'not-an-amendment',
          `${blockName(current.uuid)} is ${tagLabel(table.tagOf(current))}, which supports no core/amendment; only an amendment takes a verdict`,
          [
            'read_amendments — the open findings of a scope, each with what it would do',
            `${tagLabel(table.tagOf(current))} ends by its own verb: finish_block, close_block, supersede_block`,
          ],
        );
      }
      const verdict = checkTransition(
        table.actionsOn(current),
        table.bindingTag(current, LIFECYCLE),
        table.statusOf(current),
        amendmentVerdict(table, current, 'run'),
      );
      if (!verdict.ok) return yield* new GateRefusal(verdict.code, verdict.reason, verdict.unblock);
      const target = yield* blockRows.blockById(yield* amendsEdgeOf(input.id));
      const ops = yield* deferredOps(table, current);
      yield* assertAmendment(table, target, ops);
      return yield* act.unit(
        accepting,
        Effect.gen(function* () {
          const applied = yield* amendments.apply(ops, current.projectId, input.enclosing);
          const born = ops.flatMap((op, index) => (op.op === 'create' ? [applied.ops[index] as BlockRecord] : []));
          const created = born.map((row) => row.id);
          for (const row of born) {
            yield* edges.assertEdge(row, current, 'discovered-from');
            yield* blockRows.insertEdge(row.id, 'discovered-from', input.id);
          }
          const now = new Date(yield* Clock.currentTimeMillis);
          const row = yield* db
            .update(block)
            .set({ fields: withStatus(table, current, amendmentVerdict(table, current, 'run')), updatedAt: now })
            .where(eq(block.id, input.id))
            .returning()
            .get();
          if (!row) return yield* Effect.die('proposal accept returned no row');
          yield* blockProjection.syncTags(row.id);
          yield* act.record(
            'accept',
            row.id,
            {
              ...verdictMove(table, current, amendmentVerdict(table, current, 'run')),
              amends: target.id,
              ops: ops.length,
              created,
              reason: verdictReason(input.reason),
            },
            now,
          );
          return { ...(yield* blockRows.recordOf(row)), born };
        }),
      );
    }),

    reject: Effect.fn('Review.reject')(function* (input: {
      id: number;
      reason?: string;
    }): Effect.fn.Return<BlockRecord, StoreFailure | GateRefusal<RejectRefusal>> {
      const current = yield* blockRows.blockById(input.id);
      const table = yield* tableOf(current);
      if (!table.supports(current, AMENDMENT)) {
        return yield* new GateRefusal(
          'not-an-amendment',
          `${blockName(current.uuid)} is ${tagLabel(table.tagOf(current))}, which supports no core/amendment; only an amendment takes a verdict`,
          [
            'read_amendments — the open findings of a scope, each with what it would do',
            `${tagLabel(table.tagOf(current))} ends by its own verb: finish_block, close_block, supersede_block`,
          ],
        );
      }
      const verdict = checkTransition(
        table.actionsOn(current),
        table.bindingTag(current, LIFECYCLE),
        table.statusOf(current),
        amendmentVerdict(table, current, 'declined'),
      );
      if (!verdict.ok) return yield* new GateRefusal(verdict.code, verdict.reason, verdict.unblock);
      const reason = verdictReason(input.reason);
      if (reason === null) {
        return yield* new GateRefusal('reason-required', 'a rejection says why, or the next review files the same finding again', [
          `reject_amendment on ${input.id}, with the reason it is declined`,
        ]);
      }
      return yield* act.unit(
        rejecting,
        Effect.gen(function* () {
          const now = new Date(yield* Clock.currentTimeMillis);
          const row = yield* db
            .update(block)
            .set({ fields: withStatus(table, current, amendmentVerdict(table, current, 'declined')), updatedAt: now })
            .where(eq(block.id, input.id))
            .returning()
            .get();
          if (!row) return yield* Effect.die('proposal reject returned no row');
          yield* blockProjection.syncTags(row.id);
          yield* act.record(
            'reject',
            row.id,
            {
              ...verdictMove(table, current, amendmentVerdict(table, current, 'declined')),
              amends: yield* amendsEdgeOf(input.id),
              reason,
            },
            now,
          );
          return yield* blockRows.recordOf(row);
        }),
      );
    }),

    uphold: Effect.fn('Review.uphold')(function* (input: {
      id: number;
      reason?: string;
      by: readonly number[];
    }): Effect.fn.Return<BlockRecord, StoreFailure | GateRefusal<UpholdRefusal>> {
      const current = yield* blockRows.blockById(input.id);
      const table = yield* tableOf(current);
      if (!table.supports(current, AMENDMENT)) {
        return yield* new GateRefusal(
          'not-an-amendment',
          `${blockName(current.uuid)} is ${tagLabel(table.tagOf(current))}, which supports no core/amendment; only an amendment takes a verdict`,
          [
            'read_amendments — the open findings of a scope, each with what it would do',
            `${tagLabel(table.tagOf(current))} ends by its own verb: finish_block, close_block, supersede_block`,
          ],
        );
      }
      const verdict = checkTransition(
        table.actionsOn(current),
        table.bindingTag(current, LIFECYCLE),
        table.statusOf(current),
        amendmentVerdict(table, current, 'answered'),
      );
      if (!verdict.ok) return yield* new GateRefusal(verdict.code, verdict.reason, verdict.unblock);
      const reason = verdictReason(input.reason);
      if (reason === null) {
        return yield* new GateRefusal('reason-required', 'a verdict that runs nothing says why the payload does not have to', [
          `uphold_amendment on ${blockName(current.uuid)}, with what was done instead`,
        ]);
      }
      for (const answerId of input.by) {
        if (answerId === input.id) {
          return yield* new GateRefusal('self-answer', `${blockName(current.uuid)} cannot be what answered itself`, [
            `accept_amendment on ${blockName(current.uuid)} — its own ops are what answers it`,
            `reject_amendment on ${blockName(current.uuid)}, when nothing answers it at all`,
          ]);
        }
        const answer = yield* blockRows.blockById(answerId);
        if (answer.projectId !== current.projectId) {
          return yield* new GateRefusal('cross-project', 'a block that answered this finding lives in another graph', [
            `name blocks of project ${current.projectId} — a review reads one graph`,
          ]);
        }
      }
      return yield* act.unit(
        upholding,
        Effect.gen(function* () {
          const now = new Date(yield* Clock.currentTimeMillis);
          const row = yield* db
            .update(block)
            .set({ fields: withStatus(table, current, amendmentVerdict(table, current, 'answered')), updatedAt: now })
            .where(eq(block.id, input.id))
            .returning()
            .get();
          if (!row) return yield* Effect.die('proposal uphold returned no row');
          yield* blockProjection.syncTags(row.id);
          yield* act.record(
            'uphold',
            row.id,
            {
              ...verdictMove(table, current, amendmentVerdict(table, current, 'answered')),
              amends: yield* amendsEdgeOf(input.id),
              reason,
              by: [...input.by],
            },
            now,
          );
          return yield* blockRows.recordOf(row);
        }),
      );
    }),

    verdicts: Effect.fn('Review.verdicts')(function* (
      rows: readonly BlockRow[],
    ): Effect.fn.Return<ReadonlyMap<number, ProposalVerdictRow>, StoreFailure> {
      const decided: BlockRow[] = [];
      const tables = new Map<number, TagTable>();
      for (const row of rows) {
        const table = tables.get(row.projectId) ?? (yield* tableOf(row));
        tables.set(row.projectId, table);
        if (table.supports(row, AMENDMENT) && table.isTerminal(row)) decided.push(row);
      }
      const entries = yield* journal.newest(
        decided.map((row) => row.id),
        ['accept', 'reject', 'uphold'],
      );
      const payloads = new Map<number, VerdictPayload>();
      const unreadable = new Map<number, string>();
      for (const [id, entry] of entries) {
        const read = readJournal.verdict(entry);
        if (read._tag === 'Success') payloads.set(id, read.success);
        else {
          payloads.set(id, {});
          unreadable.set(id, read.failure.message);
        }
      }
      const answerNames = yield* blockNames.namesOf([...payloads.values()].flatMap((payload) => payload.by ?? []));
      const sessionRows = yield* sessions.named(
        [...entries.values()].flatMap((entry) => (entry.sessionId === null ? [] : [entry.sessionId])),
      );
      const writers = new Map<number, WriterRef>(
        sessionRows.map((row) => [row.id, { id: row.id, harness: row.harness, key: row.key }] as const),
      );
      const verdicts = new Map<number, ProposalVerdictRow>();
      for (const row of decided) {
        const entry = entries.get(row.id);
        const payload = payloads.get(row.id);
        if (entry === undefined || payload === undefined) continue;
        const by: string[] = [];
        for (const id of payload.by ?? []) {
          const name = answerNames.get(id);
          if (name === undefined) return yield* Effect.die(`no block ${id} to name in the verdict on ${row.id}`);
          by.push(name);
        }
        verdicts.set(row.id, {
          status: tables.get(row.projectId)?.statusOf(row) ?? '',
          writer: entry.sessionId === null ? null : (writers.get(entry.sessionId) ?? null),
          reason: payload.reason ?? null,
          by,
          at: entry.ts,
          unreadable: unreadable.get(row.id),
        });
      }
      return verdicts;
    }),
  };
});
