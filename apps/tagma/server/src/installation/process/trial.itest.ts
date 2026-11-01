import { afterAll, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it } from '@runlith/effect-test';
import { Clock, Effect } from 'effect';
import { readAttempt, writeAttempt } from '../closure/attempt.js';
import { swapCurrent } from '../closure/versions.js';
import { arrive, enterTrial, rollBack, type TrialPlace } from './trial.js';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'tagma-trial-')));
afterAll(() => rmSync(home, { recursive: true, force: true }));

const install = join(home, 'install');
const store = join(home, 'tagma.sqlite');
const fresh = join(home, 'performance.sqlite');
for (const version of ['v1', 'v2']) {
  mkdirSync(join(install, version), { recursive: true });
  writeFileSync(join(install, version, 'install.json'), '{}');
}
const stores = join(home, 'stores');
const place: TrialPlace = { installRoot: install, release: join(install, 'v2'), files: [store, fresh], stores };
const standing = () => readlinkSync(join(install, 'current'));
const data = () => [readFileSync(store, 'utf8'), readFileSync(`${store}-wal`, 'utf8'), existsSync(`${store}-shm`), existsSync(fresh)];

const attempted = (starts: number, copied = false) => {
  swapCurrent(install, 'v2');
  writeFileSync(store, 'before');
  writeFileSync(`${store}-wal`, 'wal before');
  rmSync(`${store}-shm`, { force: true });
  rmSync(fresh, { force: true });
  writeAttempt(install, { from: 'v1', to: 'v2', starts, copied, ended: null });
};

const written = () => {
  writeFileSync(store, 'migrated');
  writeFileSync(`${store}-wal`, 'wal of the attempt');
  writeFileSync(`${store}-shm`, 'shm of the attempt');
  writeFileSync(fresh, 'made by the attempt');
};

const on = (entered: Effect.Success<ReturnType<typeof enterTrial>>) =>
  entered === null ? Effect.die('the start is no trial') : Effect.succeed(entered);

it.effect(
  'a start the attempt names copies the data whole; failing before its door puts every file back as it stood, returns current to the release before and records why',
  () =>
    Effect.gen(function* () {
      attempted(0);
      const module = join(stores, 'module.sqlite');
      mkdirSync(stores, { recursive: true });
      writeFileSync(module, 'module before');
      expect(yield* arrive(place)).toBe('serve');
      const trial = yield* on(yield* enterTrial(place));
      expect(readAttempt(install)).toMatchObject({ starts: 1, copied: true });
      written();
      writeFileSync(module, 'module migrated');
      yield* trial.failed('the migration failed');

      expect([...data(), readFileSync(module, 'utf8')]).toEqual(['before', 'wal before', false, false, 'module before']);
      expect(standing()).toBe('v1');
      expect(readAttempt(install)?.ended).toEqual({ detail: 'the migration failed', data: 'restored' });
      expect([existsSync(`${store}.attempt`), existsSync(`${module}.attempt`)]).toEqual([false, false]);
      rmSync(stores, { recursive: true, force: true });
    }),
);

it.effect(
  'a start after one that died midway begins from the copy, and the third start without a door rolls back before anything opens',
  () =>
    Effect.gen(function* () {
      attempted(0);
      yield* arrive(place);
      yield* on(yield* enterTrial(place));
      written();
      expect(yield* arrive(place)).toBe('serve');
      yield* on(yield* enterTrial(place));
      expect(data()).toEqual(['before', 'wal before', false, false]);
      written();

      expect(yield* arrive(place)).toBe('roll');
      yield* rollBack(place, 'it started 2 times and never opened its door');
      expect([standing(), readAttempt(install)?.ended?.data]).toEqual(['v1', 'restored']);
      expect(data()).toEqual(['before', 'wal before', false, false]);
    }),
);

it.effect(
  'data that does not come back keeps current on the attempt and its copies, and every later start of the attempt tries again until it comes back',
  () =>
    Effect.gen(function* () {
      attempted(0);
      yield* arrive(place);
      const trial = yield* on(yield* enterTrial(place));
      written();
      chmodSync(`${store}.attempt`, 0o000);
      yield* trial.failed('the migration failed');
      expect([standing(), readAttempt(install)?.ended?.data]).toEqual(['v2', 'unrestored']);

      expect(yield* arrive(place)).toBe('roll');
      chmodSync(`${store}.attempt`, 0o600);
      yield* rollBack(place, 'unused');
      expect([standing(), readAttempt(install)?.ended]).toEqual(['v1', { detail: 'the migration failed', data: 'restored' }]);
      expect(data()).toEqual(['before', 'wal before', false, false]);
      expect(yield* arrive(place)).toBe('serve');
    }),
);

const database = (migrations: readonly string[], rows: readonly string[]) => {
  for (const side of ['', '-wal', '-shm']) rmSync(`${store}${side}`, { force: true });
  const db = new Database(store);
  db.run('create table __drizzle_migrations (id integer primary key, hash text, name text)');
  db.run('create table note (said text)');
  for (const name of migrations) db.run('insert into __drizzle_migrations (hash, name) values (?, ?)', [`hash of ${name}`, name]);
  for (const said of rows) db.run('insert into note (said) values (?)', [said]);
  db.close();
};

const notes = () => {
  const db = new Database(store, { readonly: true });
  const said = db
    .query<{ said: string }, []>('select said from note order by rowid')
    .all()
    .map((row) => row.said);
  db.close();
  return said;
};

const unreturned = Effect.fnUntraced(function* (migrations: readonly string[]) {
  attempted(0);
  database(['base'], ['before']);
  yield* arrive(place);
  const trial = yield* on(yield* enterTrial(place));
  database(migrations, ['before', 'by the attempt']);
  chmodSync(`${store}.attempt`, 0o000);
  yield* trial.failed('the migration failed');
  chmodSync(`${store}.attempt`, 0o600);
  expect(readAttempt(install)?.ended?.data).toBe('unrestored');
});

it.effect(
  'data that did not come back and that the release before has since served and written stays as it left it, even beside a module store the attempt made: current goes to that release, and the copies leave',
  () =>
    Effect.gen(function* () {
      yield* unreturned(['base']);
      const made = join(stores, 'made.sqlite');
      mkdirSync(stores, { recursive: true });
      writeFileSync(made, 'made by the attempt');
      const db = new Database(store);
      db.run('insert into note (said) values (?)', ['by the release before']);
      db.close();

      expect(yield* arrive(place)).toBe('roll');
      yield* rollBack(place, 'unused');
      expect([standing(), readAttempt(install)?.ended]).toEqual(['v1', { detail: 'the migration failed', data: 'kept' }]);
      expect(notes()).toEqual(['before', 'by the attempt', 'by the release before']);
      expect([existsSync(`${store}.attempt`), readFileSync(made, 'utf8')]).toEqual([false, 'made by the attempt']);
      rmSync(stores, { recursive: true, force: true });
    }),
);

it.live(
  'data that did not come back and still carries the migrations of the attempt goes back from the copies, even after another release opened it and moved its files',
  () =>
    Effect.gen(function* () {
      yield* unreturned(['base', 'of the attempt']);
      const later = new Date((yield* Clock.currentTimeMillis) + 60_000);
      utimesSync(store, later, later);

      expect(yield* arrive(place)).toBe('roll');
      yield* rollBack(place, 'unused');
      expect([standing(), readAttempt(install)?.ended?.data]).toEqual(['v1', 'restored']);
      expect(notes()).toEqual(['before']);
    }),
);

it.effect('the door opening ends the attempt and drops the copies, and a start no open attempt names is no trial', () =>
  Effect.gen(function* () {
    attempted(1);
    const trial = yield* on(yield* enterTrial(place));
    yield* trial.passed;
    expect([readAttempt(install), existsSync(`${store}.attempt`), existsSync(`${fresh}.attempt`)]).toEqual([null, false, false]);
    expect(yield* enterTrial(place)).toBeNull();
    expect(standing()).toBe('v2');
  }),
);
