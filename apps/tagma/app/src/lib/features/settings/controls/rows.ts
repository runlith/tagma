import type { SettingField } from '@tagma/server/platform/contract/wire/setting';

export type Row = Record<string, unknown>;

export type RowNote = { readonly text: string; readonly tone: 'ready' | 'blocked' };

export function readPath(row: Row, path: readonly string[]): unknown {
  return path.reduce<unknown>((held, step) => (held === null || typeof held !== 'object' ? undefined : (held as Row)[step]), row);
}

export function writePath(row: Row, path: readonly string[], value: unknown): Row {
  const [head, ...rest] = path;
  if (head === undefined) return row;
  if (rest.length === 0) {
    const next = { ...row };
    if (value === undefined) delete next[head];
    else next[head] = value;
    return next;
  }
  return { ...row, [head]: writePath((row[head] as Row | undefined) ?? {}, rest, value) };
}

export function fieldApplies(field: SettingField, row: Row): boolean {
  const when = 'when' in field ? field.when : undefined;
  return when === undefined || readPath(row, when.path) === when.equals;
}

export function fieldPaths(field: SettingField): readonly (readonly string[])[] {
  return field.kind === 'model' ? [[field.path[0]], [field.path[1]]] : [field.path];
}

export function settleRow(fields: readonly SettingField[], row: Row): Row {
  let next: Row = {};
  for (const field of fields) {
    if (!fieldApplies(field, row)) continue;
    for (const path of fieldPaths(field)) {
      const value = readPath(row, path);
      if (value !== undefined) next = writePath(next, path, value);
    }
  }
  return next;
}

export function blankRow(fields: readonly SettingField[]): Row {
  let row: Row = {};
  for (const field of fields) {
    if (field.kind === 'choice') row = writePath(row, field.path, field.choices[0]?.value ?? '');
  }
  return row;
}

export function rowsToEdit(input: { own: readonly unknown[] | undefined; inherited: readonly unknown[]; merging: boolean }): Row[] {
  const stored = input.own ?? (input.merging ? [] : input.inherited);
  return stored.map((row) => ({ ...(row as Row) }));
}
