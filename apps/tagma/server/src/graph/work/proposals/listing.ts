import { Effect, Layer } from 'effect';
import { GraphStore, type StoreFailure } from '../../../platform/contract/service/store.js';
import { WriterRegister } from '../../../platform/contract/service/writers.js';
import { blockOwners } from '../../store/owners.js';
import { Amendments, Review, type ProposalFilter, type ProposalListRow } from '../../contract/service/work.js';
import type { BlockQuery } from '../../contract/wire/query.js';
import { Blocks, Edges } from '../../contract/service/blocks.js';
import { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import { Act, BlockNames, BlockProjection } from '../../contract/service/acts.js';
import { BlockRows } from '../../acts/rows.js';
import { type BlockRow } from '../../contract/service/acts.js';
import { Tags } from '../../contract/service/vocabulary.js';
import { Selection, type BlockPosition, type SelectionRefusal } from '../../contract/service/reads.js';
import { blockName } from '../../contract/wire/references.js';
import { GraphJournal } from '../../contract/service/journal.js';
import { Sources } from '../../contract/service/sources.js';
import { type ProposalFiling, proposalFiling } from './filing.js';
import { deferredOps } from './payload.js';
import { proposalVerdicts } from './verdicts.js';
import { AMENDMENT } from '../../contract/wire/tags/amendment.js';
import { GraphUnits } from '../../../platform/contract/service/units.js';
import { proposalConflicts } from './conflicts.js';

const proposalListing = Effect.fnUntraced(function* (filing: ProposalFiling) {
  const { db } = yield* GraphStore;
  const blockRows = yield* BlockRows;
  const blockNames = yield* BlockNames;
  const sources = yield* Sources;
  const selection = yield* Selection;
  const vocabulary = yield* Tags;
  const tableOf = (row: { projectId: number }) => vocabulary.of(row.projectId);
  const { assertAmendment, amendsEdgeOf } = filing;

  const proposalQuery = Effect.fnUntraced(function* (filter: ProposalFilter) {
    const owners = filter.projectId !== undefined ? [filter.projectId] : yield* blockOwners(db);
    const tables = yield* Effect.forEach(owners, (projectId) => vocabulary.of(projectId));
    const amendmentStatuses = tables.flatMap((table) =>
      table.wordsAt(AMENDMENT, filter.decided === true ? 'terminal' : 'initial').flatMap((set) => [...set.words]),
    );
    return {
      tags: [...new Set(tables.flatMap((table) => [...table.typesSupporting(AMENDMENT)]))],
      roles: { status: [...new Set(amendmentStatuses)] },
      sort: { by: 'updated', order: 'desc' },
      scope: filter.scopeId === undefined ? undefined : [yield* blockNames.nameOf(filter.scopeId)],
    } satisfies BlockQuery;
  });

  const listed = Effect.fnUntraced(function* (rows: readonly BlockRow[]) {
    const found: ProposalListRow[] = [];
    for (const row of yield* blockRows.details(rows)) found.push({ ...row, sources: yield* sources.of(row.id) });
    return found;
  });

  return {
    obstacles: Effect.fn('Review.obstacles')(function* (proposalId: number): Effect.fn.Return<string[], StoreFailure> {
      const row = yield* blockRows.liveBlock(proposalId);
      if (row === undefined) return [];
      const table = yield* tableOf(row);
      if (!table.supports(row, AMENDMENT) || table.isTerminal(row)) return [];
      const targetId = yield* amendsEdgeOf(proposalId);
      const target = yield* blockRows.liveBlock(targetId);
      if (target === undefined) {
        const uuid = yield* blockNames.uuidOf(targetId);
        return [uuid === null ? 'the block this proposal amends is gone' : `amends target ${blockName(uuid)} is in the trash`];
      }
      const readable = yield* Effect.result(deferredOps(table, row));
      if (readable._tag === 'Failure') return [readable.failure.reason];
      const ops = readable.success;
      const standing: string[] = [];
      const stale = yield* Effect.result(assertAmendment(table, target, ops));
      if (stale._tag === 'Failure') {
        if (stale.failure._tag !== 'GateRefusal') return yield* Effect.fail(stale.failure);
        standing.push(stale.failure.reason);
      }
      for (const [index, op] of ops.entries()) {
        if (op.op !== 'edit' || op.id.startsWith('$')) continue;
        const found = yield* Effect.result(blockNames.idOfName(op.id));
        if (found._tag === 'Failure') {
          if (!(found.failure instanceof GateRefusal)) return yield* Effect.fail(found.failure);
          standing.push(`ops[${index}] (edit): ${op.id} does not resolve to one block`);
          continue;
        }
        const targetId = found.success;
        if (targetId === null) continue;
        const body = (yield* blockRows.liveBlock(targetId))?.body;
        if (body === undefined) continue;
        const occurrences = body.split(op.old).length - 1;
        if (occurrences === 0) standing.push(`ops[${index}] (edit): the anchor is no longer in ${op.id}`);
        else if (occurrences > 1 && op.all !== true) {
          standing.push(`ops[${index}] (edit): the anchor appears ${occurrences} times in ${op.id}`);
        }
      }
      return standing;
    }),

    proposals: Effect.fn('Review.proposals')(function* (
      filter: ProposalFilter,
    ): Effect.fn.Return<ProposalListRow[], StoreFailure | GateRefusal<SelectionRefusal>> {
      return yield* listed(yield* selection.rows(yield* proposalQuery(filter), filter.projectId));
    }),

    proposalsPage: Effect.fn('Review.proposalsPage')(function* (filter: ProposalFilter, after: BlockPosition | undefined, rows: number) {
      const slice = yield* selection.rowsPage(yield* proposalQuery(filter), filter.projectId, after, rows);
      return { rows: yield* listed(slice.rows), total: slice.total };
    }),
  };
});

export const reviewLayer: Layer.Layer<
  Review,
  never,
  | GraphStore
  | GraphUnits
  | Act
  | Blocks
  | Edges
  | Sources
  | Selection
  | GraphJournal
  | Amendments
  | WriterRegister
  | Tags
  | BlockRows
  | BlockNames
  | BlockProjection
> = Layer.effect(
  Review,
  Effect.gen(function* () {
    const filing = yield* proposalFiling;
    return Review.of({
      propose: filing.propose,
      revise: filing.revise,
      conflicts: yield* proposalConflicts,
      ...(yield* proposalVerdicts(filing)),
      ...(yield* proposalListing(filing)),
    });
  }),
);
