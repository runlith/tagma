import { Database } from 'bun:sqlite';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const CHAIN_LEDGER = '__drizzle_migrations';
export const BACK_SCRIPT = 'back.sql';

const BREAKPOINT = '--> statement-breakpoint';

type ChainStep = {
  readonly name?: string;
  readonly hash: string;
  readonly folderMillis: number;
  readonly sql: readonly string[];
};

export type ChainTarget = {
  readonly steps: readonly ChainStep[];
  readonly accepted?: ReadonlyMap<string, string>;
};

type ChainLeaving = {
  readonly steps: readonly ChainStep[];
  readonly folder: string | null;
};

export type ChainLoss = { readonly table: string; readonly rows: number };

type ChainReturn = { readonly returned: boolean; readonly lost: readonly ChainLoss[] };

type Row = { readonly type: string; readonly name: string; readonly tbl: string; readonly sql: string | null };

type Column = {
  readonly name: string;
  readonly type: string;
  readonly notnull: number;
  readonly dflt_value: string | null;
  readonly pk: number;
  readonly hidden: number;
};

const quoted = (name: string): string => `"${name.replaceAll('"', '""')}"`;

const NAMED =
  /\b(?:create\s+(?:temp(?:orary)?\s+)?(?:virtual\s+)?table(?:\s+if\s+not\s+exists)?|alter\s+table|drop\s+table(?:\s+if\s+exists)?|rename\s+to)\s+(?:main\s*\.\s*)?["`[]?([\w$]+)/giu;

const touchedBy = (statements: readonly string[]): ReadonlySet<string> =>
  new Set(statements.flatMap((statement) => [...statement.matchAll(NAMED)].map((match) => match[1]!.toLowerCase())));

const catalog = (db: Database): readonly Row[] =>
  db
    .query<Row, []>(
      `select type, name, tbl_name as tbl, sql from sqlite_master where name not like 'sqlite_%' and name != '${CHAIN_LEDGER}'
       and name not in (select name from pragma_table_list where type = 'shadow')`,
    )
    .all();

const virtualTables = (db: Database): ReadonlySet<string> =>
  new Set(
    db
      .query<{ name: string }, []>(`select name from pragma_table_list where type = 'virtual'`)
      .all()
      .map((row) => row.name.toLowerCase()),
  );

const columnsOf = (db: Database, table: string): readonly Column[] =>
  db
    .query<Column, [string]>('select name, type, "notnull", dflt_value, pk, hidden from pragma_table_xinfo(?)')
    .all(table)
    .filter((column) => column.hidden === 0);

const withoutRowid = (db: Database, table: string): boolean =>
  db.query<{ wr: number }, [string]>(`select wr from pragma_table_list where schema = 'main' and name = ?`).get(table)?.wr === 1;

const zeroOf = (type: string): string => {
  const declared = type.toUpperCase();
  if (declared.includes('INT')) return '0';
  if (declared.includes('CHAR') || declared.includes('CLOB') || declared.includes('TEXT')) return `''`;
  if (declared === '' || declared.includes('BLOB')) return `x''`;
  return '0';
};

type LedgerRow = { readonly name: string | null; readonly hash: string };

const ledgerRows = (db: Database): readonly LedgerRow[] | null =>
  db.query(`select 1 from sqlite_master where type = 'table' and name = '${CHAIN_LEDGER}'`).get() === null
    ? null
    : db.query<LedgerRow, []>(`select name, hash from ${CHAIN_LEDGER} order by created_at, id`).all();

const membersOf = (target: ChainTarget): ReadonlyMap<string, string> =>
  new Map<string, string>([
    ...(target.accepted ?? []),
    ...target.steps.flatMap((step) => (step.name === undefined ? [] : [[step.name, step.hash] as const])),
  ]);

export const chainFits = (path: string, target: ChainTarget): boolean => {
  const db = new Database(path, { readonly: true });
  try {
    const rows = ledgerRows(db);
    if (rows === null) return true;
    const members = membersOf(target);
    return rows.every((row) => row.name !== null && members.get(row.name) === row.hash);
  } finally {
    db.close();
  }
};

const referenceOf = (target: ChainTarget): Database => {
  const reference = new Database(':memory:');
  reference.run('PRAGMA foreign_keys = OFF');
  for (const step of target.steps) for (const statement of step.sql) if (statement.trim() !== '') reference.run(statement);
  return reference;
};

const scriptOf = (leaving: ChainLeaving, name: string): readonly string[] => {
  if (leaving.folder === null) return [];
  const path = join(leaving.folder, name, BACK_SCRIPT);
  return existsSync(path)
    ? readFileSync(path, 'utf8')
        .split(BREAKPOINT)
        .filter((statement) => statement.trim() !== '')
    : [];
};

const narrowed = (db: Database, reference: Database, table: string, wanted: string | null): boolean => {
  const kept = new Set(columnsOf(reference, table).map((column) => column.name.toLowerCase()));
  const extra = columnsOf(db, table).filter((column) => !kept.has(column.name.toLowerCase()));
  if (extra.length === 0) return false;
  db.run('SAVEPOINT chain_narrow');
  try {
    for (const column of extra) db.run(`ALTER TABLE ${quoted(table)} DROP COLUMN ${quoted(column.name)}`);
    const standing = db
      .query<{ sql: string | null }, [string]>(`select sql from sqlite_master where type = 'table' and name = ?`)
      .get(table);
    if ((standing?.sql ?? null) === wanted) {
      db.run('RELEASE chain_narrow');
      return true;
    }
  } catch {
    //! a column an index, key or check uses cannot be dropped; the rebuild below takes it
  }
  db.run('ROLLBACK TO chain_narrow');
  db.run('RELEASE chain_narrow');
  return false;
};

const rebuilt = (db: Database, reference: Database, table: string, wanted: string): number => {
  const aside = `__chain_return_${table}`;
  const sequence = db.query(`select 1 from sqlite_master where name = 'sqlite_sequence'`).get()
    ? (db.query<{ seq: number }, [string]>('select seq from sqlite_sequence where name = ?').get(table)?.seq ?? null)
    : null;
  for (const index of db
    .query<{ name: string }, [string]>(`select name from sqlite_master where type = 'index' and tbl_name = ? and sql is not null`)
    .all(table))
    db.run(`DROP INDEX ${quoted(index.name)}`);
  db.run(`ALTER TABLE ${quoted(table)} RENAME TO ${quoted(aside)}`);
  db.run(wanted);
  const held = new Map(columnsOf(db, aside).map((column) => [column.name.toLowerCase(), column.name]));
  const into: string[] = [];
  const from: string[] = [];
  const target = columnsOf(reference, table);
  for (const column of target) {
    const source = held.get(column.name.toLowerCase());
    if (source !== undefined) {
      into.push(quoted(column.name));
      from.push(column.notnull === 1 ? `coalesce(${quoted(source)}, ${column.dflt_value ?? zeroOf(column.type)})` : quoted(source));
    } else if (column.notnull === 1 && column.dflt_value === null && column.pk === 0) {
      into.push(quoted(column.name));
      from.push(zeroOf(column.type));
    }
  }
  const aliased =
    target.filter((column) => column.pk > 0).length === 1 &&
    target.some((column) => column.pk === 1 && column.type.toUpperCase() === 'INTEGER');
  const kept =
    !aliased &&
    !withoutRowid(db, table) &&
    !withoutRowid(db, aside) &&
    !held.has('rowid') &&
    !target.some((column) => column.name.toLowerCase() === 'rowid');
  const before = db.query<{ n: number }, []>(`select count(*) as n from ${quoted(aside)}`).get()?.n ?? 0;
  if (into.length > 0)
    db.run(
      `INSERT OR IGNORE INTO ${quoted(table)} (${[...(kept ? ['rowid'] : []), ...into].join(', ')}) SELECT ${[...(kept ? ['rowid'] : []), ...from].join(', ')} FROM ${quoted(aside)}`,
    );
  db.run(`DROP TABLE ${quoted(aside)}`);
  if (sequence !== null) db.run(`UPDATE sqlite_sequence SET seq = max(seq, ?) WHERE name = ?`, [sequence, table]);
  return before - (db.query<{ n: number }, []>(`select count(*) as n from ${quoted(table)}`).get()?.n ?? 0);
};

const seeded = (db: Database, reference: Database, table: string): void => {
  const columns = columnsOf(reference, table).map((column) => column.name);
  const rows = reference.query<Record<string, string | number | bigint | Uint8Array | null>, []>(`select * from ${quoted(table)}`).all();
  for (const row of rows)
    db.run(
      `INSERT OR IGNORE INTO ${quoted(table)} (${columns.map(quoted).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
      columns.map((column) => row[column] ?? null),
    );
};

const uniqueHeld = (db: Database, name: string, sql: string, table: string): number => {
  const keys = db
    .query<{ name: string | null }, [string]>(`select name from pragma_index_xinfo(?) where "key" = 1 order by seqno`)
    .all(name)
    .map((column) => column.name);
  if (keys.some((key) => key === null))
    throw new Error(`the unique index ${name} is over an expression, and its duplicates cannot be named`);
  const partial = /\bwhere\b(.*)$/isu.exec(sql)?.[1]?.trim();
  const where = partial === undefined ? '' : `WHERE ${partial}`;
  const group = keys.map((key) => quoted(key!)).join(', ');
  db.run(
    `DELETE FROM ${quoted(table)} ${where === '' ? 'WHERE' : `${where} AND`} rowid NOT IN (SELECT max(rowid) FROM ${quoted(table)} ${where} GROUP BY ${group})`,
  );
  return db.query<{ n: number }, []>('select changes() as n').get()?.n ?? 0;
};

const indexed = (db: Database, name: string, sql: string, table: string, lost: Map<string, number>): void => {
  try {
    db.run(sql);
  } catch (cause) {
    if (!/unique/iu.test(String(cause))) throw cause;
    db.run(`DROP INDEX IF EXISTS ${quoted(name)}`);
    const auto = sql.replace(/\bunique\b/iu, '');
    db.run(auto);
    const removed = uniqueHeld(db, name, sql, table);
    lost.set(table, (lost.get(table) ?? 0) + removed);
    db.run(`DROP INDEX ${quoted(name)}`);
    db.run(sql);
  }
};

const danglingRemoved = (db: Database, parents: ReadonlySet<string>, lost: Map<string, number>): void => {
  const tables = db.query<{ name: string }, []>(`select name from sqlite_master where type = 'table' and name not like 'sqlite_%'`).all();
  const children = tables.filter((table) =>
    db
      .query<{ table: string }, [string]>('select "table" from pragma_foreign_key_list(?)')
      .all(table.name)
      .some((key) => parents.has(key.table.toLowerCase())),
  );
  const next = new Set<string>();
  for (const { name } of children) {
    const violations = db
      .query<{ rowid: number | null }, []>(`select rowid from pragma_foreign_key_check(${quoted(name).replaceAll('"', "'")})`)
      .all();
    for (const violation of violations) {
      if (violation.rowid === null) continue;
      db.run(`DELETE FROM ${quoted(name)} WHERE rowid = ?`, [violation.rowid]);
      lost.set(name, (lost.get(name) ?? 0) + 1);
      next.add(name.toLowerCase());
    }
  }
  if (next.size > 0) danglingRemoved(db, next, lost);
};

const reshaped = (
  db: Database,
  reference: Database,
  target: ChainTarget,
  leaving: ChainLeaving,
  excess: readonly LedgerRow[],
): ChainReturn => {
  const known = new Map(leaving.steps.map((step) => [step.name, step]));
  const excessSteps = excess.flatMap((row) => {
    const step = row.name === null ? undefined : known.get(row.name);
    return step === undefined ? [] : [step];
  });
  const touched = excessSteps.length === excess.length ? touchedBy(excessSteps.flatMap((step) => step.sql)) : null;
  const scripts = excessSteps.toReversed().flatMap((step) => (step.name === undefined ? [] : scriptOf(leaving, step.name)));
  const lost = new Map<string, number>();
  db.run('PRAGMA foreign_keys = OFF');
  db.run('PRAGMA legacy_alter_table = ON');
  db.run('BEGIN IMMEDIATE');
  try {
    for (const script of scripts) db.run(script);
    const wanted = catalog(reference);
    const wantedTables = new Map(wanted.filter((row) => row.type === 'table').map((row) => [row.name.toLowerCase(), row]));
    const virtualWanted = virtualTables(reference);
    const standing = catalog(db);
    for (const row of standing) {
      if (row.type === 'trigger' || row.type === 'view') db.run(`DROP ${row.type.toUpperCase()} ${quoted(row.name)}`);
    }
    const standingTables = new Map(standing.filter((row) => row.type === 'table').map((row) => [row.name.toLowerCase(), row]));
    const reachable = (table: string): boolean => touched === null || touched.has(table.toLowerCase());
    const wantedIndexes = new Map(
      wanted.filter((row) => row.type === 'index' && row.sql !== null).map((row) => [row.name.toLowerCase(), row]),
    );
    for (const row of standing) {
      if (row.type !== 'index' || row.sql === null) continue;
      const same = wantedIndexes.get(row.name.toLowerCase())?.sql === row.sql;
      if (!same && (reachable(row.tbl) || wantedTables.has(row.tbl.toLowerCase()))) db.run(`DROP INDEX ${quoted(row.name)}`);
    }
    const remade = new Set<string>();
    for (const [name, row] of standingTables) {
      if (!wantedTables.has(name) && touched !== null && touched.has(name)) db.run(`DROP TABLE ${quoted(row.name)}`);
    }
    for (const [name, want] of wantedTables) {
      const held = standingTables.get(name);
      if (held === undefined) {
        db.run(want.sql!);
        if (!virtualWanted.has(name)) seeded(db, reference, want.name);
        remade.add(name);
        continue;
      }
      if (!reachable(name) || held.sql === want.sql) continue;
      if (virtualWanted.has(name)) {
        db.run(`DROP TABLE ${quoted(held.name)}`);
        db.run(want.sql!);
        remade.add(name);
        continue;
      }
      if (narrowed(db, reference, held.name, want.sql)) continue;
      const removed = rebuilt(db, reference, held.name, want.sql!);
      if (removed > 0) lost.set(want.name, removed);
      remade.add(name);
    }
    const after = new Map(
      catalog(db)
        .filter((row) => row.type === 'index' && row.sql !== null)
        .map((row) => [row.name.toLowerCase(), row]),
    );
    for (const [name, row] of wantedIndexes) {
      if (after.get(name)?.sql !== row.sql) indexed(db, row.name, row.sql!, row.tbl, lost);
    }
    for (const row of wanted) if (row.type === 'view' && row.sql !== null) db.run(row.sql);
    for (const row of wanted) if (row.type === 'trigger' && row.sql !== null) db.run(row.sql);
    for (const [name, want] of wantedTables) {
      if (!virtualWanted.has(name)) continue;
      const content = /\bcontent\s*=\s*["'`]?([\w$]+)/iu.exec(want.sql ?? '')?.[1]?.toLowerCase();
      if (content !== undefined && (remade.has(content) || remade.has(name)))
        db.run(`INSERT INTO ${quoted(want.name)}(${quoted(want.name)}) VALUES ('rebuild')`);
    }
    db.run(`DELETE FROM ${CHAIN_LEDGER}`);
    const appliedAt = new Date().toISOString();
    const named = new Set(
      db
        .query<{ name: string }, []>(`select name from pragma_table_info('${CHAIN_LEDGER}')`)
        .all()
        .map((column) => column.name),
    );
    for (const step of target.steps) {
      const values: readonly (readonly [string, string | number | null])[] = [
        ['hash', step.hash],
        ['created_at', step.folderMillis],
        ['name', step.name ?? null],
        ['applied_at', appliedAt],
      ];
      const carried = values.filter(([column]) => named.has(column));
      db.run(
        `INSERT INTO ${CHAIN_LEDGER} (${carried.map(([column]) => quoted(column)).join(', ')}) VALUES (${carried.map(() => '?').join(', ')})`,
        carried.map(([, value]) => value),
      );
    }
    if (lost.size > 0) danglingRemoved(db, new Set([...lost.keys()].map((name) => name.toLowerCase())), lost);
    db.run('COMMIT');
  } catch (cause) {
    db.run('ROLLBACK');
    throw cause;
  }
  db.run('PRAGMA wal_checkpoint(TRUNCATE)');
  return { returned: true, lost: [...lost].map(([table, count]) => ({ table, rows: count })) };
};

export const returnToChain = (path: string, target: ChainTarget, leaving: ChainLeaving): ChainReturn => {
  const db = new Database(path);
  try {
    const rows = ledgerRows(db);
    if (rows === null) return { returned: false, lost: [] };
    const members = membersOf(target);
    const excess = rows.filter((row) => row.name === null || members.get(row.name) !== row.hash);
    if (excess.length === 0) return { returned: false, lost: [] };
    const reference = referenceOf(target);
    try {
      return reshaped(db, reference, target, leaving, excess);
    } finally {
      reference.close();
    }
  } finally {
    db.close();
  }
};
