import { Database } from 'bun:sqlite';
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BACK_SCRIPT, chainFits, type ChainTarget, returnToChain } from './chainReturn.js';

const CHAIN_LEDGER = '__drizzle_migrations';
type ChainStep = ChainTarget['steps'][number];

let home = '';
let serial = 0;
beforeAll(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), 'chain-return-')));
});
afterAll(() => rmSync(home, { recursive: true, force: true }));

const LEDGER = `CREATE TABLE ${CHAIN_LEDGER} (id INTEGER PRIMARY KEY, hash text NOT NULL, created_at numeric, name text, applied_at TEXT)`;

const step = (name: string, ...sql: string[]): ChainStep => ({ name, hash: `hash-${name}`, folderMillis: Number(name.slice(0, 4)), sql });

const applied = (db: Database, steps: readonly ChainStep[]): void => {
  for (const one of steps) {
    for (const statement of one.sql) db.run(statement);
    db.run(`INSERT INTO ${CHAIN_LEDGER} (hash, created_at, name, applied_at) VALUES (?, ?, ?, 'then')`, [
      one.hash,
      one.folderMillis,
      one.name!,
    ]);
  }
};

const store = (steps: readonly ChainStep[], fill: (db: Database) => void): string => {
  const path = join(home, `store-${++serial}.sqlite`);
  const db = new Database(path);
  db.run('PRAGMA journal_mode = WAL');
  db.run(LEDGER);
  applied(db, steps);
  fill(db);
  db.close();
  return path;
};

const shapeOf = (db: Database) =>
  db
    .query<{ type: string; name: string; sql: string }, []>(
      `select type, name, sql from sqlite_master where sql is not null and name not like 'sqlite_%' and name != '${CHAIN_LEDGER}' order by type, name`,
    )
    .all();

const fresh = (steps: readonly ChainStep[]) => {
  const db = new Database(':memory:');
  db.run(LEDGER);
  applied(db, steps);
  const shape = shapeOf(db);
  db.close();
  return shape;
};

const read = <A>(path: string, work: (db: Database) => A): A => {
  const db = new Database(path);
  try {
    return work(db);
  } finally {
    db.close();
  }
};

const ledger = (path: string) =>
  read(path, (db) =>
    db
      .query<{ name: string }, []>(`select name from ${CHAIN_LEDGER} order by created_at, id`)
      .all()
      .map((row) => row.name),
  );

const forward = (path: string, one: ChainStep): void => read(path, (db) => applied(db, [one]));

const BASE = step('1000_base', 'CREATE TABLE thread (id text PRIMARY KEY NOT NULL, title text NOT NULL, kept text)');

test('a store returns onto the target chain and goes forward again, whatever shape the leaving migration took, keeping every row the target can hold', () => {
  const shapes: readonly { readonly name: string; readonly leaving: ChainStep; readonly back?: string }[] = [
    { name: 'added column', leaving: step('2000_added', 'ALTER TABLE thread ADD `extra` text') },
    {
      name: 'added table with index',
      leaving: step('2000_table', 'CREATE TABLE later (id integer PRIMARY KEY)', 'CREATE INDEX later_id ON later (id)'),
    },
    { name: 'added index', leaving: step('2000_index', 'CREATE INDEX thread_title ON thread (title)') },
    {
      name: 'rebuilt table with a NOT NULL column',
      leaving: step(
        '2000_rebuilt',
        "CREATE TABLE __new_thread (id text PRIMARY KEY NOT NULL, title text NOT NULL, kept text, required text NOT NULL DEFAULT ('x'))",
        'INSERT INTO __new_thread (id, title, kept) SELECT id, title, kept FROM thread',
        'DROP TABLE thread',
        'ALTER TABLE __new_thread RENAME TO thread',
      ),
    },
    { name: 'dropped column', leaving: step('2000_dropped', 'ALTER TABLE thread DROP COLUMN kept') },
    { name: 'dropped table', leaving: step('2000_gone', 'DROP TABLE thread') },
    {
      name: 'relaxed NOT NULL',
      leaving: step(
        '2000_relaxed',
        'CREATE TABLE __new_thread (id text PRIMARY KEY NOT NULL, title text, kept text)',
        'INSERT INTO __new_thread SELECT * FROM thread',
        'DROP TABLE thread',
        'ALTER TABLE __new_thread RENAME TO thread',
      ),
    },
    {
      name: 'renamed column',
      leaving: step('2000_renamed', 'ALTER TABLE thread RENAME COLUMN kept TO held'),
      back: 'ALTER TABLE thread RENAME COLUMN held TO kept',
    },
    {
      name: 'written row',
      leaving: step('2000_row', `INSERT INTO thread (id, title) VALUES ('seed', 'seeded')`),
      back: `DELETE FROM thread WHERE id = 'seed'`,
    },
  ];
  for (const { name, leaving, back } of shapes) {
    const folder = join(home, `chain-${++serial}`);
    if (back !== undefined) {
      mkdirSync(join(folder, leaving.name!), { recursive: true });
      writeFileSync(join(folder, leaving.name!, BACK_SCRIPT), back);
    }
    const path = store([BASE], (db) => void db.run(`INSERT INTO thread (id, title, kept) VALUES ('a', 'first', 'value')`));
    forward(path, leaving);
    const target = { steps: [BASE] };
    expect([name, chainFits(path, target)]).toEqual([name, false]);
    const answer = returnToChain(path, target, { steps: [BASE, leaving], folder: back === undefined ? null : folder });
    expect([name, answer.returned]).toEqual([name, true]);
    expect([name, chainFits(path, target), ledger(path)]).toEqual([name, true, [BASE.name!]]);
    expect([name, read(path, shapeOf)]).toEqual([name, fresh([BASE])]);
    if (name !== 'dropped table' && name !== 'dropped column')
      expect([name, read(path, (db) => db.query(`select id, title, kept from thread where id = 'a'`).all())]).toEqual([
        name,
        [{ id: 'a', title: 'first', kept: 'value' }],
      ]);
    if (name === 'dropped column')
      expect(read(path, (db) => db.query(`select id, title, kept from thread`).all())).toEqual([{ id: 'a', title: 'first', kept: null }]);
    forward(path, leaving);
    expect([name, read(path, shapeOf)]).toEqual([name, fresh([BASE, leaving])]);
    expect([name, read(path, (db) => db.query('PRAGMA integrity_check').get())]).toEqual([name, { integrity_check: 'ok' }]);
  }
});

test('a row the target cannot hold is left out and counted, and rows that referenced it follow it; a row with no value in a required column gets the type zero', () => {
  const base = step(
    '1000_base',
    "CREATE TABLE parent (id text PRIMARY KEY NOT NULL, kind text NOT NULL CHECK (kind in ('old')), label text NOT NULL)",
    'CREATE TABLE child (id integer PRIMARY KEY, parent text NOT NULL REFERENCES parent(id))',
  );
  const leaving = step(
    '2000_wider',
    'CREATE TABLE __new_parent (id text PRIMARY KEY NOT NULL, kind text NOT NULL, label text)',
    'INSERT INTO __new_parent SELECT * FROM parent',
    'DROP TABLE parent',
    'ALTER TABLE __new_parent RENAME TO parent',
  );
  const path = store([base, leaving], (db) => {
    db.run(`INSERT INTO parent VALUES ('kept', 'old', 'named'), ('blank', 'old', NULL), ('new', 'unknown', 'x')`);
    db.run(`INSERT INTO child VALUES (1, 'kept'), (2, 'new')`);
  });
  const answer = returnToChain(path, { steps: [base] }, { steps: [base, leaving], folder: null });
  expect(answer.lost.toSorted((a, b) => a.table.localeCompare(b.table))).toEqual([
    { table: 'child', rows: 1 },
    { table: 'parent', rows: 1 },
  ]);
  expect(read(path, (db) => db.query('select id, kind, label from parent order by id').all())).toEqual([
    { id: 'blank', kind: 'old', label: '' },
    { id: 'kept', kind: 'old', label: 'named' },
  ]);
  expect(read(path, (db) => db.query('select id from child').all())).toEqual([{ id: 1 }]);
});

test('a uniqueness the leaving build relaxed comes back with the newest of each duplicate; rows of an external-content index come back searchable', () => {
  const base = step(
    '1000_base',
    'CREATE TABLE doc (body text, slug text)',
    'CREATE UNIQUE INDEX doc_slug ON doc (slug)',
    `CREATE VIRTUAL TABLE doc_search USING fts5(body, content='doc')`,
    `CREATE TRIGGER doc_in AFTER INSERT ON doc BEGIN INSERT INTO doc_search(rowid, body) VALUES (new.rowid, new.body); END`,
  );
  const leaving = step('2000_loose', 'DROP INDEX doc_slug', 'ALTER TABLE doc ADD `tag` text', 'CREATE INDEX doc_tag ON doc (tag)');
  const path = store(
    [base, leaving],
    (db) => void db.run(`INSERT INTO doc (body, slug) VALUES ('older words', 'same'), ('newer words', 'same')`),
  );
  const answer = returnToChain(path, { steps: [base] }, { steps: [base, leaving], folder: null });
  expect(answer.lost).toEqual([{ table: 'doc', rows: 1 }]);
  expect(read(path, shapeOf)).toEqual(fresh([base]));
  expect(read(path, (db) => db.query('select body from doc').all())).toEqual([{ body: 'newer words' }]);
  expect(read(path, (db) => db.query(`select rowid from doc_search where doc_search match 'newer'`).all().length)).toBe(1);
});

test('a store whose ledger the target already holds is left untouched', () => {
  const later = step('2000_later', 'CREATE TABLE later (id integer PRIMARY KEY)');
  const path = store([BASE], () => undefined);
  expect(returnToChain(path, { steps: [BASE, later] }, { steps: [BASE, later], folder: null })).toEqual({ returned: false, lost: [] });
  expect(ledger(path)).toEqual([BASE.name!]);
});
