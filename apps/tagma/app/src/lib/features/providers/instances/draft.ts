import type { SettingField } from '@runlith/tagma/adapter/settings';

export type Draft = Record<string, unknown>;

type Rows = Extract<SettingField, { readonly type: 'rows' }>;

const asRows = (value: unknown): readonly Draft[] =>
  Array.isArray(value) ? value.filter((row): row is Draft => typeof row === 'object' && row !== null) : [];

const read = (field: SettingField, value: unknown): unknown => {
  if (field.secret === true) return '';
  if (field.type === 'rows') return value;
  switch (field.type) {
    case 'number':
      return typeof value === 'number' ? String(value) : '';
    case 'flag':
      return value === true;
    case 'set':
      return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
    case 'text':
      return typeof value === 'string' ? value : '';
    case 'choice':
      return typeof value === 'string' ? value : (field.default ?? '');
  }
};

const write = (field: SettingField, value: unknown): unknown => {
  if (field.secret === true) {
    if (value === null) return null;
    if (typeof value !== 'string' || value === '') return undefined;
    if (field.type === 'text') return value;
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  if (field.type === 'rows') return value;
  switch (field.type) {
    case 'number': {
      const text = typeof value === 'string' ? value.trim() : '';
      if (text === '') return undefined;
      const number = Number(text);
      return Number.isNaN(number) ? text : number;
    }
    case 'flag':
      return value === true ? true : undefined;
    case 'set':
      return Array.isArray(value) && value.length > 0 ? [...value] : undefined;
    case 'text':
    case 'choice':
      return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
  }
};

let serial = 0;

export const emptyRow = (field: Rows): Draft => ({
  _key: ++serial,
  ...Object.fromEntries(field.fields.map((leaf) => [leaf.id, read(leaf, undefined)])),
});

export function draftOf(fields: readonly SettingField[], values: Readonly<Record<string, unknown>>): Draft {
  const draft: Draft = {};
  for (const field of fields) {
    draft[field.id] =
      field.type === 'rows' && field.secret !== true
        ? asRows(values[field.id]).map((row, at) => ({
            _key: ++serial,
            _source: at,
            ...Object.fromEntries(field.fields.map((leaf) => [leaf.id, read(leaf, row[leaf.id])])),
          }))
        : read(field, values[field.id]);
  }
  return draft;
}

export function valuesOf(fields: readonly SettingField[], draft: Draft): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const field of fields) {
    const kept =
      field.type === 'rows' && field.secret !== true
        ? asRows(draft[field.id]).map((row) =>
            Object.fromEntries([
              ...(row._source === undefined ? [] : [['_source', row._source]]),
              ...field.fields.flatMap((leaf) => {
                const written = write(leaf, row[leaf.id]);
                return written === undefined ? [] : [[leaf.id, written] as const];
              }),
            ]),
          )
        : write(field, draft[field.id]);
    if (kept !== undefined) values[field.id] = kept;
  }
  return values;
}

export const candidateRow = (field: Rows, candidate: Readonly<Record<string, unknown>>): Draft => ({
  ...emptyRow(field),
  ...Object.fromEntries(
    field.fields.flatMap((leaf) => (candidate[leaf.id] === undefined ? [] : [[leaf.id, read(leaf, candidate[leaf.id])] as const])),
  ),
});
