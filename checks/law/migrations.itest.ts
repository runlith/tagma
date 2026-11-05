import { expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ProgramAnswer, type ProgramKey } from '@tagma/inspection/program';
import { Schema } from 'effect';

const RUNNER = join(import.meta.dir, '../../apps/tagma/server/src/enforcement/programs/runner.ts');
const PROGRAMS = join(import.meta.dir, 'programs.ts');

const initial = '20200101000000_initial';
const next = '20200102000000_change';

const AT_ONCE = 3;

const inspect = async (root: string, key: ProgramKey, tree: string, base: string | null) => {
  const sides = (base === null ? ['tree'] : ['tree', 'base']).map((side) => ({ side, paths: null, files: null }));
  const invocation = { request: 'test', checker: PROGRAMS, root, tree, base, keys: [key], sides };
  const child = Bun.spawn([process.execPath, '--no-install', RUNNER, PROGRAMS], {
    cwd: root,
    stdin: new TextEncoder().encode(JSON.stringify(invocation)),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [out, err, status] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  expect(status, err).toBe(0);
  const answer = Schema.decodeUnknownSync(ProgramAnswer)(JSON.parse(out));
  expect(answer.failure).toBeUndefined();
  return answer.readings;
};

const inspectAll = async (root: string, key: ProgramKey, trees: readonly string[], base: string) => {
  const found: Awaited<ReturnType<typeof inspect>>[] = [];
  for (let at = 0; at < trees.length; at += AT_ONCE)
    found.push(...(await Promise.all(trees.slice(at, at + AT_ONCE).map((tree) => inspect(root, key, tree, base)))));
  return found.map((readings) => readings.find((reading) => reading.side === 'tree')!.findings);
};

test('landing judges a new history migration and a backdated form against the immutable base', async () => {
  const root = mkdtempSync(join(tmpdir(), 'migration-law-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const put = (path: string, text: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  try {
    git('init', '-q');
    put(
      'src/owner.ts',
      "const events = sqliteTable('events', {}); const m = manifest({ tables: async () => { return { entities: [], history: [events] }; } });",
    );
    put(
      'src/forms.ts',
      "export const current = { name: '20261010000000_current', samples: {} } satisfies ThreadFormStep; const owner = manifest({ formSteps: [current] });",
    );
    put(`drizzle/${initial}/migration.sql`, 'create table events (id integer primary key, body text);');
    git('add', '.');
    const base = git('write-tree');
    const law = { key: 'law', id: 'migrations', params: { source: 'src', folder: 'drizzle', cut: initial }, reach: { places: [''] } };
    const trees: string[] = [];
    const judge = () => {
      git('add', '.');
      trees.push(git('write-tree'));
    };
    put(`drizzle/${next}/migration.sql`, "update events set body = 'changed';");
    judge();
    put(`drizzle/${next}/migration.sql`, 'alter table events add column label text;');
    put('src/earlier.ts', "const owner = manifest({ formSteps: [{ name: '20261009000000_earlier', samples: {} }] });");
    judge();
    put(
      'src/earlier.ts',
      "const later: ThreadFormStep = { name: '20261011000000_later', samples: {} }; const owner = manifest({ formSteps: [later] });",
    );
    put(
      'src/owner.ts',
      "const events = sqliteTable('events', {}); const m = manifest({ async tables() { return { entities: [], history: [events] }; } });",
    );
    put(
      `drizzle/${next}/migration.sql`,
      'create table owners(id integer primary key);\n--> statement-breakpoint\nalter table events add column owner integer references owners(id);',
    );
    judge();
    put(`drizzle/${next}/migration.sql`, 'create index event_body on events(body);');
    put(`drizzle/${next}/heavy.json`, JSON.stringify({ reason: 'Build a searchable history index' }));
    put('src/steps/next.ts', "export const next = { name: '20261013000000_next', samples: {} };");
    put(
      'src/forms.ts',
      "import { next } from './steps/next.js'; export const current = { name: '20261010000000_current', samples: {} } satisfies ThreadFormStep; const owner = manifest({ formSteps: [current, next] });",
    );
    judge();
    put('src/steps/next.ts', "export const next = { name: '20261001000000_next', samples: {} };");
    judge();
    const warmed = await inspectAll(root, law, trees.slice(0, 4), base);
    expect([...warmed, ...(await inspectAll(root, law, trees.slice(4), base))]).toEqual([
      [expect.objectContaining({ path: `drizzle/${next}/migration.sql`, message: expect.stringContaining('events') })],
      [expect.objectContaining({ path: 'src/earlier.ts', message: expect.stringContaining('20261010000000_current') })],
      [expect.objectContaining({ message: expect.stringContaining('foreign key (owner)') })],
      [],
      [expect.objectContaining({ path: 'src/steps/next.ts', message: expect.stringContaining('20261001000000_next') })],
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a new migration of any judged chain that a step back cannot return without losing what the build before reads is named until a back.sql stands beside it', async () => {
  const root = mkdtempSync(join(tmpdir(), 'migration-backs-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const put = (path: string, text: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  try {
    git('init', '-q');
    put(`drizzle/${initial}/migration.sql`, 'create table events (id integer primary key, body text);');
    put(`host/${initial}/migration.sql`, 'create table runs (id integer primary key);');
    git('add', '.');
    const base = git('write-tree');
    const law = {
      key: 'backs',
      id: 'migration-backs',
      params: { folders: ['drizzle', 'host'], cut: initial },
      reach: { places: [''] },
    };
    const trees: string[] = [];
    const judge = () => {
      git('add', '.');
      trees.push(git('write-tree'));
    };
    put(`drizzle/${next}/migration.sql`, 'alter table events rename column body to text;');
    put(`host/${next}/migration.sql`, 'drop table runs;');
    judge();
    put(`drizzle/${next}/back.sql`, 'alter table events rename column text to body;');
    put(`host/${next}/migration.sql`, 'alter table runs add column label text;');
    judge();
    put(
      `drizzle/${next}/migration.sql`,
      "create table __new_events (id integer primary key, body text not null);\n--> statement-breakpoint\ninsert into __new_events select id, coalesce(body, '') from events;\n--> statement-breakpoint\ndrop table events;\n--> statement-breakpoint\nalter table __new_events rename to events;",
    );
    rmSync(join(root, `drizzle/${next}/back.sql`));
    judge();
    expect(await inspectAll(root, law, trees, base)).toEqual([
      [
        expect.objectContaining({ path: `drizzle/${next}/migration.sql`, message: expect.stringContaining('back.sql') }),
        expect.objectContaining({ path: `host/${next}/migration.sql`, message: expect.stringContaining('runs') }),
      ],
      [],
      [],
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a form step a manifest takes from live code is named, and one from its steps folder is not, whatever the memo holds', async () => {
  const root = mkdtempSync(join(tmpdir(), 'step-places-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const put = (path: string, text: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  try {
    git('init', '-q');
    put('src/owner/steps/kept.ts', "export const kept = { name: '20261010000000_kept', samples: {} };");
    put('src/owner/live.ts', "export const live = { name: '20261011000000_live', samples: {} };");
    put(
      'src/owner/owner.ts',
      "import { kept } from './steps/kept.js'; import { live } from './live.js'; const owner = manife\\u0073t({ formSteps: [kept, live] });",
    );
    git('add', '.');
    put('.git/runlith-law/migrations.json', '{"version":');
    const places = { key: 'places', id: 'step-places', params: { source: 'src' }, reach: { places: [''] } };
    const findings = (await inspect(root, places, git('write-tree'), null)).flatMap((reading) => reading.findings);
    expect(findings.map((finding) => finding.path)).toEqual(['src/owner/live.ts']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
