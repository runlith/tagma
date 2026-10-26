import { afterAll, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Assembled } from '../../builtins';
import { ready } from '../../builtins.node';
import { measure } from './run';

await ready('modules');

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const aliased = (target: string) => JSON.stringify({ compilerOptions: { paths: { '$lib/*': [target] } } });

const repository = (files: Readonly<Record<string, string>>): string => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'measure-generated-')));
  dirs.push(dir);
  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  };
  for (const [path, text] of Object.entries(files)) write(path, text);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
  git('init', '-q');
  git('add', '-A');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init');
  return dir;
};

const inspection: Assembled = {
  builtin: 'modules',
  params: {
    base: '',
    cycles: 'refuse',
    coverage: 'refuse',
    unresolved: 'refuse',
    reads: 'every',
    conditions: [],
    files: { extensions: ['.ts'], exclude: [] },
    built: [{ output: 'app/.gen/tsconfig.json', source: 'app/gen.json', why: 'The committed copy of the generated config.' }],
    map: {
      modules: [
        { id: 'routes', territory: ['app/src/routes/'] },
        { id: 'store', territory: ['app/src/lib/store/'], entries: [{ at: 'app/src/lib/store/contract/' }] },
      ],
      relations: [{ from: 'routes', to: 'store' }],
      region: ['app/src/'],
    },
  },
};

test('measuring a commit refuses a copy the checkout generated config contradicts, naming both, and reads it where none is generated', () => {
  const dir = repository({
    '.gitignore': '.gen/\n',
    'app/tsconfig.json': JSON.stringify({ extends: './.gen/tsconfig.json' }),
    'app/gen.json': aliased('../src/lib/*'),
    'app/src/lib/store/contract/x.ts': 'export const x = 1;\n',
    'app/src/lib/store/x.ts': 'export const y = 1;\n',
    'app/src/routes/page.ts': "import { y } from '$lib/store/x';\n",
  });
  const asked = { at: 'HEAD', debt: [] };
  expect(measure(dir, inspection, asked).verdict.violations.map(({ fingerprint }) => fingerprint)).toEqual([
    'routes -> store private @ app/src/routes/page.ts',
  ]);
  mkdirSync(join(dir, 'app/.gen'));
  writeFileSync(join(dir, 'app/.gen/tsconfig.json'), aliased('../src/kit/*'));
  expect(() => measure(dir, inspection, asked)).toThrow(
    expect.objectContaining({ path: 'app/gen.json', output: 'app/.gen/tsconfig.json' }),
  );
});
