import type { Tag } from '../contract/wire/tags/declaration.js';
import type { TagTable } from '../contract/wire/tags/table.js';

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

export type StoredFields = (types: readonly Tag[], fields: Raw) => Raw;

export const storedFields =
  (table: TagTable, documents: Readonly<Record<string, Change>>, field: (stored: string) => string): StoredFields =>
  (types, fields) => {
    const out: Raw = {};
    for (const [stored, value] of Object.entries(fields)) {
      const name = field(stored);
      const key = types.flatMap((tag) => table.identities.resolveStoredField(tag.id, name) ?? [])[0] ?? name;
      const type = types.find((tag) => tag.fields[key] !== undefined)?.fields[key];
      const schema = object(type) && type.type === 'schema' ? type.name : undefined;
      out[name] = typeof schema === 'string' && Object.hasOwn(documents, schema) ? documents[schema]!(value) : value;
    }
    return out;
  };
