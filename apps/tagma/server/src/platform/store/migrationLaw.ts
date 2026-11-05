import { Schema } from 'effect';
import { isKeyword, isMark, nameOf, schemaStatement, statementTarget, tokenize } from './statementTarget.js';

export const ASIDE_FILE = 'aside.json';

export const AsideDeclared = Schema.Struct({
  tables: Schema.optionalKey(Schema.NonEmptyArray(Schema.NonEmptyString)),
  derived: Schema.optionalKey(Schema.NonEmptyArray(Schema.NonEmptyString)),
  moved: Schema.optionalKey(Schema.Boolean),
});

export type MigrationIssue = { readonly table: string | null; readonly statement: string; readonly reason: string };

const UNRETURNED = {
  renamed: 'a renamed table leaves the build before without the rows it reads under the old name',
  column: 'a renamed column comes back empty to the build before',
  droppedColumn: 'a dropped column comes back empty to the build before',
  dropped: 'a dropped table comes back empty to the build before',
  written: 'rows rewritten here reach the build before in a shape it never wrote',
  unresolved: 'the statement cannot be judged',
} as const;

export const DROPPING: ReadonlySet<string> = new Set([UNRETURNED.dropped, UNRETURNED.droppedColumn]);

type Renamed = { readonly tables: ReadonlySet<string>; readonly columns: ReadonlyMap<string, ReadonlySet<string>> };

export const renamedIn = (statements: readonly string[]): Renamed => {
  const tables = new Set<string>();
  const columns = new Map<string, Set<string>>();
  for (const statement of statements) {
    const tokens = tokenize(statement);
    if (!isKeyword(tokens[0], 'alter') || !isKeyword(tokens[1], 'table')) continue;
    const table = nameOf(tokens[2])?.toLowerCase();
    const rename = tokens.findIndex((token) => isKeyword(token, 'rename'));
    if (table === undefined || rename < 0) continue;
    if (isKeyword(tokens[rename + 1], 'to')) tables.add(table);
    else {
      const old = nameOf(tokens[rename + (isKeyword(tokens[rename + 1], 'column') ? 2 : 1)])?.toLowerCase();
      if (old !== undefined) columns.set(table, new Set([...(columns.get(table) ?? []), old]));
    }
  }
  return { tables, columns };
};

export const unreturnedIssues = (statements: readonly string[]): readonly MigrationIssue[] => {
  const created = new Set<string>();
  const dropped = new Map<string, string>();
  const issues: MigrationIssue[] = [];
  const issue = (table: string | null, statement: string, reason: keyof typeof UNRETURNED) =>
    issues.push({ table, statement, reason: UNRETURNED[reason] });
  for (const statement of statements) {
    const target = statementTarget(statement);
    if (target.kind === 'write') {
      if (!created.has(target.table.toLowerCase())) issue(target.table, statement, 'written');
      continue;
    }
    const shape = schemaStatement(statement);
    const tokens = tokenize(statement);
    const columnChange =
      isKeyword(tokens[0], 'alter') &&
      isKeyword(tokens[1], 'table') &&
      tokens.some((token) => isKeyword(token, 'rename') || isKeyword(token, 'drop'));
    if (shape.kind === 'unresolved' && columnChange) {
      const table = nameOf(tokens[2]);
      const dropping = tokens.some((token) => isKeyword(token, 'drop'));
      if (table === null || !created.has(table.toLowerCase())) issue(table, statement, dropping ? 'droppedColumn' : 'column');
    } else if (shape.kind === 'unresolved') issue(null, statement, 'unresolved');
    else if (shape.kind === 'create-table') created.add(shape.table.toLowerCase());
    else if (shape.kind === 'drop-table') {
      const table = shape.table.toLowerCase();
      if (!created.delete(table)) dropped.set(table, statement);
    } else if (shape.kind === 'alter-table') {
      const table = shape.table.toLowerCase();
      if (shape.renameTo !== null) {
        const to = shape.renameTo.toLowerCase();
        if (!created.delete(table)) issue(shape.table, statement, 'renamed');
        created.add(to);
        dropped.delete(to);
      } else if (shape.addedColumn === null && !created.has(table))
        issue(shape.table, statement, tokens.some((token) => isKeyword(token, 'drop')) ? 'droppedColumn' : 'column');
    }
  }
  for (const [table, statement] of dropped) issue(table, statement, 'dropped');
  return issues;
};

export const migrationIssues = (statement: string, history: ReadonlySet<string>): readonly MigrationIssue[] => {
  const shape = schemaStatement(statement);
  const target = statementTarget(statement);
  if (shape.kind === 'unresolved' && target.kind !== 'write')
    return [{ table: null, statement, reason: 'the statement cannot be resolved' }];
  if (shape.kind === 'create-trigger' || shape.kind === 'drop-trigger') return [];
  const tokens = tokenize(statement);
  const touched = new Set(
    tokens.flatMap((token) => {
      const name = nameOf(token)?.toLowerCase();
      return name !== undefined && history.has(name) ? [name] : [];
    }),
  );
  if (touched.size === 0) return [];
  if (shape.kind === 'alter-table' && shape.addedColumn !== null && touched.size === 1 && touched.has(shape.table)) {
    const added = tokens.findIndex((token) => isKeyword(token, 'add'));
    const column = added + (isKeyword(tokens[added + 1], 'column') ? 2 : 1);
    const definition = tokens.slice(column + 1);
    const expensive = definition.some((token) => ['check', 'stored', 'primary', 'unique'].some((word) => isKeyword(token, word)));
    const generated = definition.some((token) => isKeyword(token, 'as'));
    const notNull = definition.some((token, at) => isKeyword(token, 'not') && isKeyword(definition[at + 1], 'null'));
    const defaultAt = definition.findIndex((token) => isKeyword(token, 'default'));
    const defaultToken = definition[defaultAt + 1];
    const constant =
      defaultAt < 0 ||
      (defaultToken !== undefined &&
        (isMark(defaultToken, "'") ||
          ['null', 'true', 'false'].some((word) => isKeyword(defaultToken, word)) ||
          ('mark' in defaultToken && /^[+\-0-9.]$/.test(defaultToken.mark)) ||
          (isKeyword(defaultToken, 'x') && isMark(definition[defaultAt + 2], "'"))));
    if (!expensive && constant && !(generated && notNull) && (!notNull || defaultAt >= 0)) return [];
  }
  return [...touched].map((table) => ({
    table,
    statement,
    reason: 'the statement touches history beyond a constant-time column or trigger change',
  }));
};
