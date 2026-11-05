import { Database } from 'bun:sqlite';
import { afterAll, expect } from 'bun:test';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it } from '@runlith/effect-test';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { Effect, Result } from 'effect';
import { returnToChain } from '@runlith/sqlite-process/chainReturn';
import { swapCurrent } from '../../platform/lock/versionedDirectories.js';
import { beginAttempt, readStepBack, writeStepBack } from '../closure/attempt.js';
import { MIGRATIONS } from '../contract/wire/manifest.js';
import { type ReturnPlace, stepBackCarried, stepBackSettled } from './returning.js';

const tree = realpathSync(mkdtempSync(join(tmpdir(), 'tagma-returning-')));
afterAll(() => rmSync(tree, { recursive: true, force: true }));

const OLD = '20260101T000000000Z';
const NEW = '20260102T000000000Z';
const OTHER = '20260103T000000000Z';
const BASE = '20260101000000_base';
const EXTRA = '20260102000000_extra';

const migration = (release: string, name: string, sql: string): void => {
  mkdirSync(join(release, MIGRATIONS, name), { recursive: true });
  writeFileSync(join(release, MIGRATIONS, name, 'migration.sql'), sql);
};

const ledger = (path: string): readonly string[] => {
  const db = new Database(path, { readonly: true });
  try {
    return db
      .query<{ name: string }, []>('select name from __drizzle_migrations order by created_at')
      .all()
      .map((row) => row.name);
  } finally {
    db.close();
  }
};

const world = (name: string) => {
  const installRoot = join(tree, name, 'install');
  for (const version of [OLD, NEW, OTHER]) {
    mkdirSync(join(installRoot, version), { recursive: true });
    writeFileSync(join(installRoot, version, 'install.json'), '{}');
    migration(join(installRoot, version), BASE, 'CREATE TABLE note (id integer PRIMARY KEY, body text);');
  }
  migration(join(installRoot, NEW), EXTRA, 'ALTER TABLE note ADD `extra` text;');
  swapCurrent(installRoot, NEW);
  const data = join(tree, name, 'data');
  mkdirSync(data, { recursive: true });
  const store = join(data, 'tagma.sqlite');
  const db = new Database(store);
  db.run('CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, hash text NOT NULL, created_at numeric, name text)');
  for (const step of readMigrationFiles({ migrationsFolder: join(installRoot, NEW, MIGRATIONS) })) {
    for (const statement of step.sql) db.run(statement);
    db.run('INSERT INTO __drizzle_migrations (hash, created_at, name) VALUES (?, ?, ?)', [step.hash, step.folderMillis, step.name ?? null]);
  }
  db.run(`INSERT INTO note (body, extra) VALUES ('kept', 'only the newer build holds this')`);
  db.close();
  const back = { from: NEW, to: OLD, carried: false };
  writeStepBack(installRoot, back);
  const place: ReturnPlace = {
    installRoot,
    own: NEW,
    ownRoot: join(installRoot, NEW),
    files: () => [{ path: store, chain: MIGRATIONS }],
    kept: () => [{ path: store, chain: MIGRATIONS }],
  };
  return { installRoot, data, store, back, place };
};

const standing = (installRoot: string) => readlinkSync(join(installRoot, 'current'));

it.live(
  'a store the step back cannot copy aside is not returned: the step back fails with why, and current and the data stay as they stood',
  () =>
    Effect.gen(function* () {
      const { installRoot, data, store, back, place } = world('uncopied');
      chmodSync(data, 0o555);
      const carried = yield* stepBackCarried(place, back).pipe(Effect.ensuring(Effect.sync(() => chmodSync(data, 0o755))));
      expect(carried).toBe(false);
      expect([standing(installRoot), ledger(store), existsSync(`${store}.back`)]).toEqual([NEW, [BASE, EXTRA], false]);
      expect(Result.getOrThrow(readStepBack(installRoot))?.failed?.detail).toContain('could not be copied aside');
    }),
);

it.live('an installation that moved current while the data was being returned keeps its choice, and the data comes back as it stood', () =>
  Effect.gen(function* () {
    const { installRoot, store, back, place } = world('overtaken');
    swapCurrent(installRoot, OTHER);
    const carried = yield* stepBackCarried(place, back);
    expect(carried).toBe(false);
    expect([standing(installRoot), ledger(store), existsSync(`${store}.back`)]).toEqual([OTHER, [BASE, EXTRA], false]);
    expect(Result.getOrThrow(readStepBack(installRoot))?.failed?.detail).toContain('no longer stands');
  }),
);

it.live(
  'a start that meets a store half returned under a step back not yet carried puts the copy back before it opens the data, and keeps the ask',
  () =>
    Effect.gen(function* () {
      const { installRoot, store, back, place } = world('half');
      copyFileSync(store, `${store}.back`);
      returnToChain(
        store,
        { steps: readMigrationFiles({ migrationsFolder: join(installRoot, OLD, MIGRATIONS) }) },
        { steps: readMigrationFiles({ migrationsFolder: join(installRoot, NEW, MIGRATIONS) }), folder: join(installRoot, NEW, MIGRATIONS) },
      );
      yield* stepBackSettled(place);
      expect([standing(installRoot), ledger(store), existsSync(`${store}.back`)]).toEqual([NEW, [BASE, EXTRA], false]);
      expect(Result.getOrThrow(readStepBack(installRoot))).toEqual(back);
    }),
);

it.live('a step-back record that does not read is set aside with the copies it may name, never dropped', () =>
  Effect.gen(function* () {
    const { installRoot, store, place } = world('unread');
    copyFileSync(store, `${store}.back`);
    writeFileSync(join(installRoot, 'back.json'), '{"from":');
    yield* stepBackSettled(place);
    const aside = readdirSync(installRoot).filter((name) => name.startsWith('back.json.unread-'));
    expect([aside.length, existsSync(join(installRoot, 'back.json')), existsSync(`${store}.back`)]).toEqual([1, false, false]);
    expect(existsSync(`${store}.back.${aside[0]!.slice('back.json.'.length)}`)).toBe(true);
  }),
);

it.live(
  'a step back cut off after its attempt was written is carried through by the next start, keeping the copy taken before the data changed',
  () =>
    Effect.gen(function* () {
      const { installRoot, store, back, place } = world('resumed');
      copyFileSync(store, `${store}.back`);
      returnToChain(
        store,
        { steps: readMigrationFiles({ migrationsFolder: join(installRoot, OLD, MIGRATIONS) }) },
        { steps: readMigrationFiles({ migrationsFolder: join(installRoot, NEW, MIGRATIONS) }), folder: join(installRoot, NEW, MIGRATIONS) },
      );
      beginAttempt(installRoot, NEW, OLD);
      const carried = yield* stepBackCarried(place, back);
      expect(carried).toBe(true);
      expect([standing(installRoot), ledger(store), ledger(`${store}.back`)]).toEqual([OLD, [BASE], [BASE, EXTRA]]);
      expect(Result.getOrThrow(readStepBack(installRoot))).toEqual({ from: NEW, to: OLD, carried: true });
    }),
);
