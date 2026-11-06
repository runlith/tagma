import { Database } from 'bun:sqlite';
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BACK_SCRIPT, chainFits, type ChainKept, type ChainTarget, returnToChain } from './chainReturn.js';

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

const keptCopy = (path: string, table: string): ChainKept => {
  const file = join(home, `kept-${++serial}.sqlite`);
  read(path, (db) => {
    db.run(`ATTACH DATABASE ? AS kept`, [file]);
    db.run(`CREATE TABLE kept.${table} AS SELECT * FROM main.${table}`);
    db.run('DETACH DATABASE kept');
  });
  return { file, tables: null };
};

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

test('a uniqueness the leaving build relaxed comes back with the newest of each duplicate as the index itself judges it, NULL keys, collation and expressions included; an external-content index follows the rows', () => {
  const base = step(
    '1000_base',
    'CREATE TABLE doc (body text, slug text, code text COLLATE NOCASE)',
    'CREATE UNIQUE INDEX doc_slug ON doc (slug)',
    'CREATE UNIQUE INDEX doc_code ON doc (code)',
    'CREATE UNIQUE INDEX doc_head ON doc (substr(body, 1, 5))',
    `CREATE VIRTUAL TABLE doc_search USING fts5(body, content='doc')`,
    `CREATE TRIGGER doc_in AFTER INSERT ON doc BEGIN INSERT INTO doc_search(rowid, body) VALUES (new.rowid, new.body); END`,
  );
  const leaving = step(
    '2000_loose',
    'DROP INDEX doc_slug',
    'DROP INDEX doc_code',
    'DROP INDEX doc_head',
    'ALTER TABLE doc ADD `tag` text',
    'CREATE INDEX doc_tag ON doc (tag)',
  );
  const path = store(
    [base, leaving],
    (db) =>
      void db.run(
        `INSERT INTO doc (body, slug, code) VALUES ('older words', 'same', 'a'), ('newer words', 'same', 'b'), ('cat one', NULL, 'C'), ('dog two', NULL, 'c'), ('loner text', NULL, NULL), ('loner again', NULL, NULL)`,
      ),
  );
  const answer = returnToChain(path, { steps: [base] }, { steps: [base, leaving], folder: null });
  expect(answer.lost).toEqual([{ table: 'doc', rows: 3 }]);
  expect(read(path, shapeOf)).toEqual(fresh([base]));
  expect(read(path, (db) => db.query('select body from doc order by rowid').all())).toEqual([
    { body: 'newer words' },
    { body: 'dog two' },
    { body: 'loner again' },
  ]);
  expect(read(path, (db) => db.query(`select rowid from doc_search where doc_search match 'newer'`).all().length)).toBe(1);
  expect(read(path, (db) => db.query(`select rowid from doc_search where doc_search match 'older'`).all().length)).toBe(0);
});

test('a child the leaving build kept without its foreign key comes back without the rows that point nowhere', () => {
  const base = step(
    '1000_base',
    'CREATE TABLE parent (id text PRIMARY KEY NOT NULL)',
    'CREATE TABLE child (id integer PRIMARY KEY, parent text NOT NULL REFERENCES parent(id))',
  );
  const leaving = step(
    '2000_unbound',
    'CREATE TABLE __new_child (id integer PRIMARY KEY, parent text NOT NULL)',
    'INSERT INTO __new_child SELECT * FROM child',
    'DROP TABLE child',
    'ALTER TABLE __new_child RENAME TO child',
  );
  const path = store([base, leaving], (db) => {
    db.run(`INSERT INTO parent VALUES ('p')`);
    db.run(`INSERT INTO child VALUES (1, 'p'), (2, 'ghost')`);
  });
  const answer = returnToChain(path, { steps: [base] }, { steps: [base, leaving], folder: null });
  expect(answer.lost).toEqual([{ table: 'child', rows: 1 }]);
  expect(read(path, (db) => db.query('select id from child').all())).toEqual([{ id: 1 }]);
});

test('a table an unknown migration left and the leaving chain creates again goes with its rows counted, so going forward never meets it standing', () => {
  const elsewhere = step('1500_elsewhere', 'CREATE TABLE later (id integer PRIMARY KEY)', `ALTER TABLE thread ADD \`seen\` text`);
  const leaving = step('2000_later', 'CREATE TABLE later (id integer PRIMARY KEY)');
  const path = store([BASE, elsewhere], (db) => {
    db.run(`INSERT INTO thread (id, title) VALUES ('a', 'first')`);
    db.run('INSERT INTO later (id) VALUES (1), (2)');
  });
  const answer = returnToChain(path, { steps: [BASE] }, { steps: [BASE, leaving], folder: null });
  expect(answer.lost).toEqual([{ table: 'later', rows: 2 }]);
  expect(read(path, shapeOf)).toEqual(fresh([BASE]));
  forward(path, leaving);
  expect(read(path, shapeOf)).toEqual(fresh([BASE, leaving]));
  expect(read(path, (db) => db.query('select id, title from thread').all())).toEqual([{ id: 'a', title: 'first' }]);
});

test('a full-text index the return recreates comes back holding its rows: its own content copied, a contentless one filled by its owner, and one with no fill is named', () => {
  const base = step(
    '1000_base',
    'CREATE TABLE note (id integer PRIMARY KEY, body text NOT NULL)',
    'CREATE VIRTUAL TABLE note_words USING fts5(body)',
    `CREATE VIRTUAL TABLE note_find USING fts5(body, content='', contentless_delete=1)`,
    `CREATE VIRTUAL TABLE note_lost USING fts5(body, content='', contentless_delete=1)`,
  );
  const leaving = step(
    '2000_trigram',
    'DROP TABLE note_words',
    `CREATE VIRTUAL TABLE note_words USING fts5(body, tokenize='trigram')`,
    'DROP TABLE note_find',
    `CREATE VIRTUAL TABLE note_find USING fts5(body, content='', contentless_delete=1, tokenize='trigram')`,
    'DROP TABLE note_lost',
    `CREATE VIRTUAL TABLE note_lost USING fts5(body, content='', contentless_delete=1, tokenize='trigram')`,
  );
  const path = store([base, leaving], (db) => {
    db.run(`INSERT INTO note (id, body) VALUES (1, 'alpha words'), (2, 'beta words')`);
    for (const table of ['note_words', 'note_find', 'note_lost'])
      db.run(`INSERT INTO ${table} (rowid, body) VALUES (1, 'alpha words'), (2, 'beta words')`);
  });
  const answer = returnToChain(
    path,
    { steps: [base] },
    { steps: [base, leaving], folder: null },
    new Map([['note_find', (db: Database) => void db.run('INSERT INTO note_find (rowid, body) SELECT id, body FROM note')]]),
  );
  expect(answer.unfilled).toEqual([{ table: 'note_lost', reason: 'no fill is declared for it' }]);
  expect(read(path, shapeOf)).toEqual(fresh([base]));
  const found = (table: string) =>
    read(path, (db) =>
      db
        .query<{ rowid: number }, []>(`select rowid from ${table} where ${table} match 'alpha'`)
        .all()
        .map((row) => row.rowid),
    );
  expect(found('note_words')).toEqual([1]);
  expect(found('note_find')).toEqual([1]);
  forward(path, leaving);
  expect(read(path, shapeOf)).toEqual(fresh([base, leaving]));
});

test('what the leaving migrations dropped comes back from the copies they kept: a table with its rows, a column by key, and a row deleted after the drop stays deleted', () => {
  const base = step(
    '1000_base',
    'CREATE TABLE thread (id text PRIMARY KEY NOT NULL, title text NOT NULL, kept text)',
    'CREATE TABLE note (id integer PRIMARY KEY, body text NOT NULL)',
  );
  const narrowed = step('2000_narrowed', 'ALTER TABLE thread DROP COLUMN kept');
  const gone = step('3000_gone', 'DROP TABLE note');
  const path = store([base], (db) => {
    db.run(`INSERT INTO thread (id, title, kept) VALUES ('a', 'first', 'value'), ('c', 'third', 'gone too')`);
    db.run(`INSERT INTO note (id, body) VALUES (1, 'hello')`);
  });
  const column = keptCopy(path, 'thread');
  forward(path, narrowed);
  read(path, (db) => {
    db.run(`INSERT INTO thread (id, title) VALUES ('b', 'second')`);
    db.run(`DELETE FROM thread WHERE id = 'c'`);
  });
  const table = keptCopy(path, 'note');
  forward(path, gone);

  const answer = returnToChain(
    path,
    { steps: [base] },
    {
      steps: [base, narrowed, gone],
      folder: null,
      kept: new Map([
        [narrowed.name!, column],
        [gone.name!, table],
      ]),
    },
  );

  expect(answer.restored.toSorted((a, b) => a.table.localeCompare(b.table))).toEqual([
    { table: 'note', rows: 1 },
    { table: 'thread', rows: 1 },
  ]);
  expect(read(path, shapeOf)).toEqual(fresh([base]));
  expect(read(path, (db) => db.query('select id, title, kept from thread order by id').all())).toEqual([
    { id: 'a', title: 'first', kept: 'value' },
    { id: 'b', title: 'second', kept: null },
  ]);
  expect(read(path, (db) => db.query('select id, body from note').all())).toEqual([{ id: 1, body: 'hello' }]);
});

test('a dropped column comes back inside the rebuild of its table, from any number of copies: a required unique value keeps every row, and a NULL stays NULL under a default', () => {
  const tables = Array.from({ length: 11 }, (_, at) => `gone${at}`);
  const base = step(
    '1000_base',
    `CREATE TABLE note (id integer PRIMARY KEY, token text NOT NULL UNIQUE, tone text DEFAULT 'plain', body text)`,
    ...tables.map((table) => `CREATE TABLE ${table} (id integer PRIMARY KEY, body text NOT NULL)`),
  );
  const narrowed = step(
    '2000_narrowed',
    'CREATE TABLE __new_note (id integer PRIMARY KEY, body text)',
    'INSERT INTO __new_note (id, body) SELECT id, body FROM note',
    'DROP TABLE note',
    'ALTER TABLE __new_note RENAME TO note',
  );
  const drops = tables.map((table, at) => step(`${3000 + at}_${table}`, `DROP TABLE ${table}`));
  const path = store([base], (db) => {
    db.run(`INSERT INTO note (id, token, tone, body) VALUES (1, 't1', NULL, 'a'), (2, 't2', 'loud', 'b')`);
    for (const table of tables) db.run(`INSERT INTO ${table} (id, body) VALUES (1, '${table}')`);
  });
  const kept = new Map<string, ChainKept>([[narrowed.name!, keptCopy(path, 'note')]]);
  forward(path, narrowed);
  for (const [at, drop] of drops.entries()) {
    kept.set(drop.name!, keptCopy(path, tables[at]!));
    forward(path, drop);
  }

  returnToChain(path, { steps: [base] }, { steps: [base, narrowed, ...drops], folder: null, kept });

  expect(read(path, (db) => db.query('select id, token, tone, body from note order by id').all())).toEqual([
    { id: 1, token: 't1', tone: null, body: 'a' },
    { id: 2, token: 't2', tone: 'loud', body: 'b' },
  ]);
  expect(read(path, (db) => tables.map((table) => db.query(`select body from ${table}`).get()))).toEqual(
    tables.map((table) => ({ body: table })),
  );
});

test('a store whose ledger the target already holds is left untouched', () => {
  const later = step('2000_later', 'CREATE TABLE later (id integer PRIMARY KEY)');
  const path = store([BASE], () => undefined);
  expect(returnToChain(path, { steps: [BASE, later] }, { steps: [BASE, later], folder: null })).toEqual({
    returned: false,
    lost: [],
    unfilled: [],
    restored: [],
  });
  expect(ledger(path)).toEqual([BASE.name!]);
});
