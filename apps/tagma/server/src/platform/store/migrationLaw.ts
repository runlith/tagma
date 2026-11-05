import { Database } from 'bun:sqlite';
import { Result, Schema } from 'effect';
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

const DROPPING: ReadonlySet<string> = new Set([UNRETURNED.dropped, UNRETURNED.droppedColumn]);

type Renamed = { readonly tables: ReadonlySet<string>; readonly columns: ReadonlyMap<string, ReadonlySet<string>> };

const renamedIn = (statements: readonly string[]): Renamed => {
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

const unreturnedIssues = (statements: readonly string[]): readonly MigrationIssue[] => {
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

type ChainedMigration = { readonly name: string; readonly sql: string; readonly back: string | null; readonly aside: string | null };

export type StepBackLoss = {
  readonly migration: string;
  readonly file: 'migration' | 'back' | 'aside';
  readonly fingerprint: string;
  readonly message: string;
};

const statementsOf = (text: string): string[] => text.split('--> statement-breakpoint').filter((one) => one.trim() !== '');

type Shape = ReadonlyMap<string, ReadonlySet<string>>;

const shapeOf = (db: Database): Shape =>
  new Map(
    db
      .query<{ name: string }, []>(
        `select name from pragma_table_list where schema = 'main' and type = 'table' and name not like 'sqlite_%'`,
      )
      .all()
      .map(({ name }) => [
        name.toLowerCase(),
        new Set(
          db
            .query<{ name: string }, [string]>('select name from pragma_table_info(?)')
            .all(name)
            .map((column) => column.name.toLowerCase()),
        ),
      ]),
  );

type Dropped = { readonly table: string; readonly columns: readonly string[] | null };

const droppedBy = (before: Shape, after: Shape, statements: readonly string[]): readonly Dropped[] => {
  const renamed = renamedIn(statements);
  return [...before].flatMap(([table, columns]): Dropped[] => {
    if (renamed.tables.has(table)) return [];
    const standing = after.get(table);
    if (standing === undefined) return [{ table, columns: null }];
    const gone = [...columns].filter((column) => !standing.has(column) && renamed.columns.get(table)?.has(column) !== true);
    return gone.length === 0 ? [] : [{ table, columns: gone }];
  });
};

const decodeAside = Schema.decodeUnknownResult(Schema.fromJsonString(AsideDeclared));

const reasonOf = (failure: unknown): string => (failure instanceof Error ? failure.message : String(failure));

const backed = (db: Database, back: string): { readonly shape: Shape } | { readonly failure: string } => {
  db.run('SAVEPOINT judged_back');
  try {
    for (const statement of statementsOf(back)) db.run(statement);
    return { shape: shapeOf(db) };
  } catch (failure) {
    return { failure: reasonOf(failure) };
  } finally {
    db.run('ROLLBACK TO judged_back');
    db.run('RELEASE judged_back');
  }
};

const unrenamed = (before: Shape, after: Shape, statements: readonly string[]): readonly string[] => {
  const renamed = renamedIn(statements);
  const tables = [...renamed.tables].filter((table) => before.has(table) && !after.has(table));
  const columns = [...renamed.columns].flatMap(([table, names]) =>
    before.has(table)
      ? [...names].filter((name) => before.get(table)!.has(name) && after.get(table)?.has(name) !== true).map((name) => `${table}.${name}`)
      : [],
  );
  return [...tables, ...columns];
};

export const stepBackLosses = (chain: readonly ChainedMigration[], judged: ReadonlySet<string>): readonly StepBackLoss[] => {
  const losses: StepBackLoss[] = [];
  const db = new Database(':memory:');
  let at = chain[0]?.name ?? '';
  try {
    db.run('PRAGMA foreign_keys = OFF');
    for (const migration of chain) {
      at = migration.name;
      const statements = statementsOf(migration.sql);
      const before = judged.has(migration.name) ? shapeOf(db) : null;
      for (const statement of statements) db.run(statement);
      if (before === null) continue;
      const loss = (file: StepBackLoss['file'], fingerprint: string, message: string) =>
        losses.push({ migration: migration.name, file, fingerprint, message });
      if (migration.back === null) {
        for (const issue of unreturnedIssues(statements).filter((one) => !DROPPING.has(one.reason)))
          loss(
            'migration',
            `back ${issue.table ?? 'unresolved'} ${issue.statement.trim()}`,
            `${issue.table ?? 'unknown target'}: ${issue.reason}, and no back.sql stands beside it to return it: ${issue.statement.trim()}`,
          );
      } else {
        const ran = backed(db, migration.back);
        if ('failure' in ran)
          loss(
            'back',
            `back script ${ran.failure}`,
            `back.sql does not run on the shape its migration leaves, so a step back would fail on a person's machine: ${ran.failure}`,
          );
        else
          for (const name of unrenamed(before, ran.shape, statements))
            loss(
              'back',
              `back leaves ${name} renamed`,
              `${name}: the migration renames it and back.sql does not name it back, so a step back would bring it back empty`,
            );
      }
      const read = migration.aside === null ? null : decodeAside(migration.aside);
      if (read !== null && Result.isFailure(read)) {
        loss('aside', 'aside unread', `${ASIDE_FILE} does not read, so it keeps nothing: ${String(read.failure)}`);
        continue;
      }
      const declared = read?.success;
      const kept = new Set([...(declared?.tables ?? []), ...(declared?.derived ?? [])].map((table) => table.toLowerCase()));
      for (const drop of droppedBy(before, shapeOf(db), statements)) {
        if (kept.has(drop.table)) continue;
        const what = drop.columns === null ? 'the migration drops the table' : `the migration drops ${drop.columns.join(', ')}`;
        loss(
          'migration',
          `drops ${drop.table}${drop.columns === null ? '' : ` ${drop.columns.join(',')}`}`,
          `${drop.table}: ${what}, and no ${ASIDE_FILE} beside it keeps the table or names it derived, so a step back would bring it back empty`,
        );
      }
    }
  } catch (failure) {
    losses.push({
      migration: at,
      file: 'migration',
      fingerprint: 'chain unapplied',
      message: `the chain does not apply in memory past this migration, so what its judged migrations lose cannot be told: ${reasonOf(failure)}`,
    });
  } finally {
    db.close();
  }
  return losses;
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
