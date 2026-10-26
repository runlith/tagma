import { afterAll, beforeAll, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { Result } from 'effect';
import type { FileSide, ProgramAnswer, ProgramInvocation, ProgramKey } from '../../core/program.js';
import { planEslint, readEslint } from './adapter.js';
import { DRIVER } from './driver.js';

const modules = resolve(import.meta.dir, '../../../../../../node_modules');
const dirs: string[] = [];
const scratch = (files: Readonly<Record<string, string>>): string => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'eslint-conformance-')));
  dirs.push(dir);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
};
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

let env: string;
beforeAll(() => {
  env = scratch({
    'plugin.js': `export default { meta: { name: 'fixture' }, rules: { 'no-task': {
  meta: { schema: [{ type: 'object', properties: { allow: { type: 'array', items: { type: 'string' } } }, additionalProperties: false }] },
  create(context) {
    const allow = context.options[0]?.allow ?? [];
    return { Literal(node) { if (typeof node.value === 'string' && node.value.startsWith('task') && !allow.includes(node.value)) context.report({ node, message: 'a task literal' }); } };
  },
} } };\n`,
    'law.config.js': `import svelte from 'eslint-plugin-svelte';
import fixture from './plugin.js';
export default [...svelte.configs.base, { files: ['**/*.svelte'], languageOptions: { parserOptions: { svelteConfig: {} } } },
  { plugins: { fixture }, rules: { 'no-console': ['off', { allow: ['log'] }], 'fixture/no-task': ['error', { allow: ['task'] }] } }];\n`,
    'null.config.js': `import svelte from 'eslint-plugin-svelte';
export default [...svelte.configs.base, { files: ['**/*.svelte'], languageOptions: { parserOptions: { svelteConfig: null } } }];\n`,
    'broken.config.js': `import missing from './missing.js';\nexport default [missing];\n`,
  });
  mkdirSync(join(env, 'node_modules'));
  for (const name of ['eslint', 'eslint-plugin-svelte', 'svelte-eslint-parser', 'svelte'])
    symlinkSync(join(modules, name), join(env, 'node_modules', name));
});

type Bound = { readonly id: string; readonly params?: ProgramKey['params'] };

const invocation = (bound: readonly Bound[], sides: readonly FileSide[]): ProgramInvocation => ({
  request: 'r1',
  checker: 'c1',
  root: '/repo',
  tree: 't1',
  base: sides.length > 1 ? 'b1' : null,
  keys: bound.map((one, at): ProgramKey => ({ key: String(at), id: one.id, params: one.params ?? {}, reach: { places: [''] } })) as [
    ProgramKey,
    ...ProgramKey[],
  ],
  sides: sides.map((side) => ({
    side: side.side,
    paths: side.files.map((file) => file.path),
    files: side.files,
  })) as unknown as ProgramInvocation['sides'],
});

const lint = (
  bound: readonly Bound[],
  sides: readonly FileSide[],
  named: string | null = 'law.config.js',
): Result.Result<ProgramAnswer, string> => {
  const input = invocation(bound, sides);
  const plan = planEslint(input, sides, { env, config: named === null ? null : join(env, named) });
  if (Result.isFailure(plan)) return Result.fail(plan.failure);
  if (plan.success.targets.length === 0) return readEslint(input, sides, plan.success, null);
  const cwd = scratch({ ...Object.fromEntries(plan.success.files.map((file) => [file.path, file.text])), 'driver.mjs': DRIVER });
  const ending = spawnSync(process.execPath, ['--no-install', join(cwd, 'driver.mjs')], {
    cwd,
    input: plan.success.stdin,
    encoding: 'utf8',
    timeout: 30_000,
  });
  return readEslint(input, sides, plan.success, { exitCode: ending.status ?? -1, stdout: ending.stdout });
};

type Unit = { readonly key: string; readonly path: string; readonly value: number; readonly line: number };
const read = (answer: Result.Result<ProgramAnswer, string>, side: 'tree' | 'base'): readonly Unit[] => {
  if (Result.isFailure(answer)) throw new Error(answer.failure);
  return answer.success.readings
    .filter((one) => one.side === side)
    .flatMap((one) => one.findings.map((found) => ({ key: one.key, path: found.path, value: found.value!, line: found.line! })))
    .sort((a, b) => a.key.localeCompare(b.key) || a.path.localeCompare(b.path));
};
const tree = (files: Readonly<Record<string, string>>): FileSide => ({
  side: 'tree',
  whole: false,
  files: Object.entries(files).map(([path, text]) => ({ path, text })),
});

test("a binding's params reach its rule as context.options in scripts and .svelte alike, whatever the project config says of the rule", () => {
  const files = tree({
    'src/a.js': "const a = 'task-ok';\nconst b = 'task';\nconsole.warn(a, b);\nconsole.log(a);\n",
    'src/A.svelte': "<script>\n  const c = 'task-ok';\n  console.warn(c);\n</script>\n<p>{'task'}</p>\n",
  });
  expect(
    read(
      lint(
        [
          { id: 'fixture/no-task', params: { allow: ['task-ok'] } },
          { id: 'no-console', params: { allow: ['warn'] } },
        ],
        [files],
      ),
      'tree',
    ),
  ).toEqual([
    { key: '0', path: 'src/a.js', value: 1, line: 2 },
    { key: '0', path: 'src/A.svelte', value: 1, line: 5 },
    { key: '1', path: 'src/a.js', value: 1, line: 4 },
  ]);
  expect(read(lint([{ id: 'fixture/no-task' }, { id: 'no-console' }], [files]), 'tree')).toEqual([
    { key: '0', path: 'src/a.js', value: 2, line: 1 },
    { key: '0', path: 'src/A.svelte', value: 2, line: 2 },
    { key: '1', path: 'src/a.js', value: 2, line: 3 },
    { key: '1', path: 'src/A.svelte', value: 1, line: 3 },
  ]);
});

test('one driver process reads both sides, keyed by check and file with the count as value, and a core rule needs no project config', () => {
  const both = lint(
    [{ id: 'no-console' }, { id: 'no-debugger' }],
    [
      tree({ 'src/a.js': 'debugger;\nconsole.log(0);\nconsole.log(1);\n', 'README.md': '# task' }),
      { side: 'base', whole: false, files: [{ path: 'src/a.js', text: 'console.log(0);\n' }] },
    ],
    null,
  );
  expect(read(both, 'tree')).toEqual([
    { key: '0', path: 'src/a.js', value: 2, line: 2 },
    { key: '1', path: 'src/a.js', value: 1, line: 1 },
  ]);
  expect(read(both, 'base')).toEqual([{ key: '0', path: 'src/a.js', value: 1, line: 1 }]);
  if (Result.isFailure(both)) throw new Error(both.failure);
  expect(both.success.readings.find((one) => one.side === 'tree' && one.key === '0')!.covered).toEqual(['src/a.js', 'README.md']);
});

test('an uncovered or unparsable file, a config or plugin that does not load, a rule its plugin lacks or a rule bound twice with different params fails instead of reading clean', () => {
  const file = [tree({ 'src/a.js': "export const a = 'task';\n" })];
  expect(Result.isFailure(lint([{ id: 'no-console' }], [tree({ 'src/a.ts': 'const a: number = 1;\n' })]))).toBe(true);
  expect(Result.isFailure(lint([{ id: 'no-console' }], [tree({ 'src/a.js': 'const = ;\n' })]))).toBe(true);
  expect(Result.isFailure(lint([{ id: 'no-console' }], file, 'broken.config.js'))).toBe(true);
  expect(Result.isFailure(lint([{ id: 'no-console' }], [tree({ 'src/A.svelte': '<script>debugger;</script>\n' })], 'null.config.js'))).toBe(
    true,
  );
  expect(Result.isFailure(lint([{ id: 'fixture/no-task' }], file, null))).toBe(true);
  expect(Result.isFailure(lint([{ id: 'fixture/nope' }], file))).toBe(true);
  expect(Result.isFailure(lint([{ id: 'fixture/no-task', params: { allow: ['a'] } }, { id: 'fixture/no-task' }], file))).toBe(true);
});
