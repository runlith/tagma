import { Effect, Semaphore } from 'effect';
import { and, eq, getTableName, inArray, isNull } from 'drizzle-orm';
import { GraphStore } from '../../../platform/contract/service/store.js';
import { GraphUnits } from '../../../platform/contract/service/units.js';
import { pagesOf } from '../../../platform/store/binds.js';
import { block, blockField, blockTag, source } from '../../store/tables.js';
import { BlockNames } from '../../contract/service/acts.js';
import { Sources } from '../../contract/service/sources.js';
import { Tags } from '../../contract/service/vocabulary.js';
import type { ConflictFilter, Review } from '../../contract/service/work.js';
import { AMENDMENT } from '../../contract/wire/tags/amendment.js';
import { blockName } from '../../contract/wire/references.js';
import { scopeCondition } from '../../search/selection.js';
import { carriesContract, contractAt } from '../../vocabulary/projection.js';
import { UnitOpen } from '../../../platform/store/transaction.js';
import { conflictComputation, type ConflictJob } from './computation.js';
import { deferredOps } from './payload.js';
import {
  conflictsOf,
  indexConflicts,
  type ConflictIndex,
  type ConflictInput,
  type ConflictSubject,
  type ConflictTarget,
} from './overlaps.js';

const LOOP_SUBJECTS = 64;
const LOOP_TEXT = 30_000;

type ConflictReading = { readonly kind: 'local'; readonly index: ConflictIndex } | { readonly kind: 'worker'; readonly key: string };

function bounded(input: ConflictInput): boolean {
  const text = [...input.targets.values()].reduce((sum, row) => sum + row.body.length, 0);
  const work = input.proposals.reduce((sum, row) => sum + row.edits.length + row.sources.length + 1, 0);
  return work <= LOOP_SUBJECTS && work * (text + 1) <= LOOP_TEXT;
}

export const proposalConflicts = Effect.gen(function* () {
  const store = yield* GraphStore;
  const { db } = store;
  const units = yield* GraphUnits;
  const vocabulary = yield* Tags;
  const names = yield* BlockNames;
  const sources = yield* Sources;
  const tables = [block, blockTag, blockField, source];
  const tracked = tables.map((table) => getTableName(table).toLowerCase());
  const held = store.moves.answers<string, ConflictReading>(tables);
  const gate = yield* Semaphore.make(1);
  const computation = yield* conflictComputation;

  const load = Effect.fn('Review.conflictInput')(function* (filter: ConflictFilter) {
    const table = yield* vocabulary.of(filter.projectId);
    const conditions = [
      carriesContract(table, AMENDMENT, block.id),
      contractAt(table, AMENDMENT, 'initial', block.id),
      eq(block.projectId, filter.projectId),
      isNull(block.deletedAt),
    ];
    if (filter.scopeId !== undefined) conditions.push(scopeCondition(filter.scopeId));
    const proposals = yield* db
      .select()
      .from(block)
      .where(and(...conditions))
      .orderBy(block.id);
    const evidence = yield* sources.byBlock(proposals.map((row) => row.id));
    const unread: { name: string; reason: string }[] = [];
    const readable = [];
    for (const row of proposals) {
      const ops = yield* Effect.result(deferredOps(table, row));
      const name = blockName(row.uuid);
      if (ops._tag === 'Failure') unread.push({ name, reason: ops.failure.reason });
      readable.push({ row, name, ops: ops._tag === 'Failure' ? [] : ops.success });
    }
    const spelled = readable.flatMap(({ ops }) => ops.flatMap((op) => (op.op === 'edit' && !op.id.startsWith('$') ? [op.id] : [])));
    const resolved = yield* names.idsOfNames(spelled);
    const subjects: ConflictSubject[] = readable.map(({ row, name, ops }) => ({
      name,
      edits: ops.flatMap((op) => {
        if (op.op !== 'edit' || op.id.startsWith('$')) return [];
        const target = resolved.get(op.id.toLowerCase().replaceAll('-', ''));
        return target === undefined ? [] : [{ target, old: op.old }];
      }),
      sources: evidence.get(row.id) ?? [],
    }));
    const targets = new Map<number, ConflictTarget>();
    const wanted = [...new Set(subjects.flatMap((row) => row.edits.map((edit) => edit.target)))];
    for (const page of pagesOf(wanted, 1)) {
      const rows = yield* db
        .select({ id: block.id, uuid: block.uuid, body: block.body })
        .from(block)
        .where(and(inArray(block.id, page), isNull(block.deletedAt)));
      for (const row of rows) targets.set(row.id, { name: blockName(row.uuid), body: row.body });
    }
    return { proposals: subjects, targets, unread } satisfies ConflictInput;
  });

  const build = Effect.fn('Review.indexConflicts')(function* (filter: ConflictFilter, key: string) {
    const input = yield* units.markReadOnly(load(filter));
    const revision = store.moves.revision(tracked);
    if (bounded(input)) {
      if (computation.running()) yield* computation.ask({ kind: 'clear', revision }).pipe(Effect.orDie);
      return { kind: 'local', index: indexConflicts(input) } as const;
    }
    yield* computation.ask({ kind: 'index', key, revision, input }).pipe(Effect.orDie);
    return { kind: 'worker', key } as const;
  });

  const computed = Effect.fnUntraced(function* (job: ConflictJob) {
    const answer = yield* computation.ask(job).pipe(Effect.orDie);
    if (answer === null) return yield* Effect.die(new Error('the conflict calculation returned no page'));
    return answer;
  });

  const reading = Effect.fnUntraced(function* (filter: ConflictFilter) {
    const key = JSON.stringify([filter.projectId, filter.scopeId ?? null, computation.generation()]);
    const heldIndex = yield* held.read(key, build(filter, key));
    return heldIndex.kind === 'local'
      ? conflictsOf(heldIndex.index, filter.names)
      : yield* computed({ kind: 'read', key: heldIndex.key, names: filter.names });
  });

  const conflicts: Review['Service']['conflicts'] = Effect.fn('Review.conflicts')(function* (filter) {
    if (yield* UnitOpen) {
      const input = yield* units.markReadOnly(load(filter));
      return bounded(input)
        ? conflictsOf(indexConflicts(input), filter.names)
        : yield* computed({ kind: 'compute', input, names: filter.names });
    }
    return yield* gate.withPermit(reading(filter));
  });
  return conflicts;
});
