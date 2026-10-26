import { eq } from 'drizzle-orm';
import { Effect, Schema } from 'effect';
import { GraphStore, type StoreFailure } from '../../platform/contract/service/store.js';
import { BlockNames } from '../contract/service/acts.js';
import type { Tag } from '../contract/wire/tags/declaration.js';
import { contractIdSchema } from '../contract/wire/tags/behaviour.js';
import type { TagTable } from '../contract/wire/tags/table.js';
import { block } from '../store/tables.js';

export type Raw = Record<string, unknown>;

export type Change = (value: unknown) => unknown;

export const object = (value: unknown): value is Raw => typeof value === 'object' && value !== null && !Array.isArray(value);

export const each =
  (change: Change): Change =>
  (value) =>
    Array.isArray(value) ? value.map(change) : value;

export const properties =
  (changes: Readonly<Record<string, Change>>): Change =>
  (value) =>
    object(value)
      ? Object.fromEntries(Object.entries(value).map(([key, one]) => [key, Object.hasOwn(changes, key) ? changes[key]!(one) : one]))
      : value;

export const keys =
  (change: (key: string) => string): Change =>
  (value) =>
    object(value) ? Object.fromEntries(Object.entries(value).map(([key, one]) => [change(key), one])) : value;

export const refFields =
  (change: Change): Change =>
  (value) =>
    object(value)
      ? Object.fromEntries(
          Object.entries(value).map(([key, type]) => [key, object(type) && type.type === 'ref' ? properties({ tag: change })(type) : type]),
        )
      : value;

export const openChildren =
  (change: Change): Change =>
  (value) =>
    object(value) && value.gate === 'open-children' ? properties({ tag: change })(value) : value;

const decodeContract = Schema.decodeUnknownResult(contractIdSchema);

export type StoredFields = (types: readonly Tag[], fields: Raw) => Effect.Effect<Raw, StoreFailure>;

export const storedFields = Effect.fnUntraced(function* (
  table: TagTable,
  documents: Readonly<Record<string, Change>>,
  creation: Change,
  field: (stored: string) => string,
) {
  const { db } = yield* GraphStore;
  const names = yield* BlockNames;
  const typesOf = (words: readonly unknown[]): readonly Tag[] =>
    table.tagsOf({ tags: words.flatMap((word) => (typeof word === 'string' ? [table.identities.keyOf(word) ?? word] : [])) });
  const fieldsOf: StoredFields = Effect.fnUntraced(function* (types: readonly Tag[], fields: Raw): Effect.fn.Return<Raw, StoreFailure> {
    const out: Raw = {};
    for (const [stored, value] of Object.entries(fields)) {
      const name = field(stored);
      const key = types.flatMap((tag) => table.identities.resolveStoredField(tag.id, name) ?? [])[0] ?? name;
      const type = types.find((tag) => tag.fields[key] !== undefined)?.fields[key];
      const schema = object(type) && type.type === 'schema' ? type.name : undefined;
      if (schema === 'amendmentOps' && Array.isArray(value)) {
        const handles = new Map<string, readonly Tag[]>();
        const ids = yield* names.idsOfNames(
          value.flatMap((op) => (object(op) && op.op === 'update' && typeof op.id === 'string' && !op.id.startsWith('$') ? [op.id] : [])),
        );
        const ops: unknown[] = [];
        for (const input of value) {
          if (!object(input)) {
            ops.push(input);
            continue;
          }
          const op = input.op === 'create' ? (creation(input) as Raw) : { ...input };
          let selected: readonly Tag[] = [];
          if (op.op === 'create') {
            if (Array.isArray(op.tags)) selected = typesOf(op.tags);
            else if (op.contract !== undefined) {
              const read = decodeContract(op.contract);
              if (read._tag === 'Success') {
                const choice = yield* Effect.result(table.creationType(read.success));
                if (choice._tag === 'Success') selected = [choice.success];
                else
                  yield* Effect.logWarning('A stored amendment has no creation type; its opaque fields remain unchanged', {
                    code: choice.failure.code,
                    reason: choice.failure.reason,
                  });
              }
            }
            if (typeof op.$id === 'string') handles.set(`$${op.$id}`, selected);
          } else if (op.op === 'update' && typeof op.id === 'string') {
            const held = handles.get(op.id);
            if (held !== undefined) selected = held;
            else {
              const target = ids.get(op.id);
              if (target !== undefined) {
                const row = yield* db.select({ tags: block.tags }).from(block).where(eq(block.id, target)).get();
                if (row !== undefined) selected = table.tagsOf(row);
              }
            }
          }
          if ((op.op === 'create' || op.op === 'update') && object(op.fields)) op.fields = yield* fieldsOf(selected, op.fields);
          ops.push(op);
        }
        out[name] = ops;
      } else out[name] = typeof schema === 'string' && Object.hasOwn(documents, schema) ? documents[schema]!(value) : value;
    }
    return out;
  });
  return fieldsOf;
});
