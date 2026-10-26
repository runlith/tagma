import { createHash } from 'node:crypto';
import { Effect, Result } from 'effect';
import type { BlockRow } from '../../graph/contract/service/acts.js';
import type { LawEnforcement } from '../../graph/contract/wire/enforcement.js';
import { Tags } from '../../graph/contract/service/vocabulary.js';
import type { TagTable } from '../../graph/contract/wire/tags/table.js';
import { enforcementField } from './predicate.js';
import { enforcementOf } from './law.js';

const canonical = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, held]) => held !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, held]) => `${JSON.stringify(key)}:${canonical(held)}`)
    .join(',')}}`;
};

export const digest = (value: unknown): string => createHash('sha256').update(canonical(value)).digest('hex').slice(0, 12);

type Policy = Pick<LawEnforcement, 'strictness' | 'on' | 'inspection'>;

export const policyForm = (document: Policy): string =>
  canonical({ strictness: document.strictness, on: document.on, inspection: document.inspection });

export const documentRevision = (document: Policy): string => createHash('sha256').update(policyForm(document)).digest('hex').slice(0, 12);

export const revisionOf = (document: LawEnforcement | undefined, stood: unknown): string | null => {
  if (document !== undefined) return documentRevision(document);
  return stood === undefined ? null : digest(stood);
};

export const storedLaw = Effect.fnUntraced(function* (table: TagTable, row: BlockRow) {
  const read = yield* Effect.result(enforcementOf(table, row));
  if (Result.isFailure(read)) {
    yield* Effect.logWarning('the stored enforcement of a rule does not read as a document', {
      rule: row.uuid,
      reason: read.failure.message,
    });
    return undefined;
  }
  return read.success;
});

export const currentEnforcementRevision = Effect.fn('enforcement.currentEnforcementRevision')(function* (row: BlockRow) {
  const table = yield* (yield* Tags).of(row.projectId);
  const field = enforcementField(table, row);
  if (field === null) return null;
  return revisionOf(yield* storedLaw(table, row), row.fields[field]);
});
