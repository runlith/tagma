import { isKeyword, isMark, nameOf, schemaStatement, statementTarget, tokenize } from './statementTarget.js';

export type MigrationIssue = { readonly table: string | null; readonly statement: string; readonly reason: string };

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
