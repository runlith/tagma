import { expect, test } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { ProgramAnswer, type ProgramInvocation, type ProgramSide } from '@tagma/inspection/program';
import { Schema } from 'effect';

const RUNNER = join(import.meta.dir, '../../apps/tagma/server/src/enforcement/programs/runner.ts');
const PROGRAMS = join(import.meta.dir, 'programs.ts');

const initial = '20200101000000_initial';
const next = '20200102000000_change';

const consumer =
  "import { Layer } from 'effect'; import { Current } from '../tag.js'; import { Current as Indexed } from '../keys'; class Invocation {} const at = new Invocation(); export const layer = Layer.succeed(Current, at); export const indexed = Layer.succeed(Indexed, at);";

const service = "import { Context } from 'effect'; export class Current extends Context.Service<Current, Invocation>()('Current') {}";

const reference =
  "import { Context } from 'effect'; export const Current = Context.Reference<Invocation>('Current', { defaultValue: () => new Invocation() });";

test('the runner judges effect-style and migrations of the programs module in one process, both sides, change and reach, resolving tags outside the region from each side’s own snapshot', () => {
  const root = mkdtempSync(join(tmpdir(), 'law-programs-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const put = (path: string, text: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  try {
    git('init', '-q');
    put('src/use.ts', consumer);
    put('tag.ts', service);
    put('keys/index.ts', service);
    put(
      'src/owner.ts',
      "const events = sqliteTable('events', {}); const m = manifest({ tables: async () => { return { entities: [], history: [events] }; } });",
    );
    put(`drizzle/${initial}/migration.sql`, 'create table events (id integer primary key, body text);');
    git('add', '.');
    const base = git('write-tree');
    put('tag.ts', reference);
    put('keys/index.ts', reference);
    put(`drizzle/${next}/migration.sql`, "update events set body = 'changed';");
    git('add', '.');
    const tree = git('write-tree');
    const changed = ['src/use.ts', `drizzle/${next}/migration.sql`];
    const judged = (whole: boolean) => {
      const side = (name: ProgramSide['side']): ProgramSide => ({
        side: name,
        paths: whole ? null : changed.filter((path) => name === 'tree' || path === 'src/use.ts'),
        files: whole
          ? null
          : changed
              .filter((path) => name === 'tree' || path === 'src/use.ts')
              .map((path) => ({ path, text: git('show', `${name === 'tree' ? tree : base}:${path}`) })),
      });
      const invocation: ProgramInvocation = {
        request: 'programs',
        checker: PROGRAMS,
        root,
        tree,
        base,
        keys: [
          {
            key: 'style',
            id: 'effect-style',
            params: { base: '', region: ['src/'], files: { extensions: ['.ts'], exclude: [] }, forms: ['service-instance'] },
            reach: { places: ['src'] },
          },
          { key: 'law', id: 'migrations', params: { source: 'src', folder: 'drizzle', cut: initial }, reach: { places: [''] } },
        ],
        sides: [side('tree'), side('base')],
      };
      const ran = spawnSync(process.execPath, ['--no-install', RUNNER, PROGRAMS], { cwd: root, input: JSON.stringify(invocation) });
      expect(ran.status).toBe(0);
      const answer = Schema.decodeUnknownSync(ProgramAnswer)(JSON.parse(ran.stdout.toString()));
      expect(answer.failure).toBeUndefined();
      return answer.readings.map((one) => [one.key, one.side, one.covered, one.findings.map((finding) => finding.path)]);
    };
    expect(judged(false)).toEqual([
      ['style', 'tree', ['src/use.ts'], []],
      ['style', 'base', ['src/use.ts'], ['src/use.ts', 'src/use.ts']],
      ['law', 'tree', { scope: 'reach' }, [`drizzle/${next}/migration.sql`]],
      ['law', 'base', { scope: 'reach' }, []],
    ]);
    expect(judged(true)).toEqual([
      ['style', 'tree', { scope: 'reach' }, []],
      ['style', 'base', { scope: 'reach' }, ['src/use.ts', 'src/use.ts']],
      ['law', 'tree', { scope: 'reach' }, [`drizzle/${next}/migration.sql`]],
      ['law', 'base', { scope: 'reach' }, []],
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);
