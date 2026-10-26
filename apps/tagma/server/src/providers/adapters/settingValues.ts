import type { SettingField, SettingLeaf } from '@runlith/tagma/adapter/settings';
import type { SettingRow, SettingValue } from '@runlith/tagma/adapter/provider';

export type Normalized = { readonly values: SettingRow; readonly secrets: SettingRow } | { readonly problem: string };

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const absent = (value: unknown): boolean =>
  value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);

function leaf(field: SettingLeaf, value: unknown, require: boolean): SettingValue | { readonly problem: string } | undefined {
  if (field.secret === true && value === null)
    return field.required === true && require ? { problem: `${field.label} is required.` } : undefined;
  if (absent(value) && field.type === 'choice' && field.default !== undefined) return field.default;
  if (absent(value)) return field.required === true && require ? { problem: `${field.label} is required.` } : undefined;
  switch (field.type) {
    case 'text':
      return typeof value === 'string' ? value : { problem: `${field.label} must be text.` };
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) return { problem: `${field.label} must be a number.` };
      return field.min !== undefined && value < field.min ? { problem: `${field.label} must be at least ${field.min}.` } : value;
    case 'flag':
      return typeof value === 'boolean' ? value : { problem: `${field.label} must be on or off.` };
    case 'choice':
      return typeof value === 'string' && field.options.some((option) => option.id === value)
        ? value
        : { problem: `${field.label} is not one of its options.` };
    case 'set':
      return Array.isArray(value) &&
        value.every((entry) => typeof entry === 'string' && field.options.some((option) => option.id === entry))
        ? (value as readonly string[])
        : { problem: `${field.label} holds a value that is not one of its options.` };
  }
}

export function publicValues(fields: readonly SettingField[], given: SettingRow): SettingRow {
  const values: Record<string, SettingValue> = {};
  for (const field of fields) {
    const value = given[field.id];
    if (field.secret === true || value === undefined) continue;
    values[field.id] =
      field.type === 'rows' && Array.isArray(value) ? value.map((row) => publicValues(field.fields, row as SettingRow)) : value;
  }
  return values;
}

export function settingsValues(fields: readonly SettingField[], values: SettingRow, secrets: SettingRow): SettingRow {
  const combined: Record<string, SettingValue> = {};
  for (const field of fields) {
    const value = field.secret === true ? secrets[field.id] : values[field.id];
    if (value === undefined) continue;
    const hiddenValue = secrets[field.id];
    const hidden = Array.isArray(hiddenValue) ? hiddenValue : [];
    combined[field.id] =
      field.type === 'rows' && field.secret !== true && Array.isArray(value)
        ? value.map((row, at) => settingsValues(field.fields, row as SettingRow, (hidden[at] as SettingRow) ?? {}))
        : value;
  }
  return combined;
}

export function normalize(
  fields: readonly SettingField[],
  given: Readonly<Record<string, unknown>>,
  held: SettingRow = {},
  require = true,
): Normalized {
  const values: Record<string, SettingValue> = {};
  const secrets: Record<string, SettingValue> = {};
  for (const field of fields) {
    const value = field.secret === true && given[field.id] === undefined ? held[field.id] : given[field.id];
    if (field.type !== 'rows') {
      const prepared = typeof value === 'string' && field.secret !== true ? value.trim() : value;
      const kept = leaf(field, prepared, require);
      if (typeof kept === 'object' && !Array.isArray(kept) && 'problem' in kept) return kept;
      if (kept !== undefined) (field.secret === true ? secrets : values)[field.id] = kept;
      continue;
    }
    if (value !== undefined && value !== null && !Array.isArray(value)) return { problem: `${field.label} must be a list.` };
    const kept: SettingRow[] = [];
    const hidden: SettingRow[] = [];
    const storedValue = held[field.id];
    const stored = Array.isArray(storedValue) ? storedValue : [];
    for (const [at, entry] of (value ?? []).entries()) {
      if (!isRecord(entry)) return { problem: `${field.label} ${at + 1} must be an entry.` };
      const source = entry._source;
      if (source !== undefined && (!Number.isInteger(source) || typeof source !== 'number' || source < 0))
        return { problem: `${field.label} ${at + 1} has an invalid stored row.` };
      const previous = field.secret === true ? {} : source === undefined ? {} : stored[source];
      const normalized = normalize(field.fields, entry, isRecord(previous) ? (previous as SettingRow) : {}, require);
      if ('problem' in normalized) return { problem: `${field.noun} ${at + 1}: ${normalized.problem}` };
      kept.push(field.secret === true ? { ...normalized.values, ...normalized.secrets } : normalized.values);
      hidden.push(normalized.secrets);
    }
    if (kept.length === 0 && field.required === true && require) return { problem: `${field.label} needs at least one ${field.noun}.` };
    if (field.secret === true) {
      if (kept.length > 0) secrets[field.id] = kept;
    } else if (kept.length > 0) {
      values[field.id] = kept;
      secrets[field.id] = hidden;
    }
  }
  return { values, secrets };
}
