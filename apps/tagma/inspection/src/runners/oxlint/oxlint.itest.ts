import { afterAll, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { Result } from 'effect';
import type { ProgramAnswer, ProgramInvocation, ProgramKey } from '../../core/program.js';
import { type LaidSide, planOxlint, readOxlint } from './adapter.js';

const cli = resolve(import.meta.dir, '../../../../../../node_modules/oxlint/bin/oxlint');
const dirs: string[] = [];
const scratch = (files: Readonly<Record<string, string>>): string => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'oxlint-conformance-')));
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

const env = scratch({
  'plugin.ts': `export default { meta: { name: 'fixture' }, rules: { 'no-task': {
  meta: { schema: [{ type: 'object', properties: { allow: { type: 'array', items: { type: 'string' } } }, additionalProperties: false }] },
  create(context: any) {
    const allow: string[] = context.options[0]?.allow ?? [];
    return { Literal(node: any) { if (typeof node.value === 'string' && node.value.startsWith('task') && !allow.includes(node.value)) context.report({ node, message: 'a task literal' }); } };
  },
} } };\n`,
  'law.json': JSON.stringify({
    jsPlugins: ['./plugin.ts'],
    rules: { 'fixture/no-task': ['error', { allow: ['task'] }], 'eslint/no-console': ['off', { allow: ['log'] }] },
  }),
  'missing.json': JSON.stringify({ jsPlugins: ['./missing.ts'] }),
});
const project = (name: string) => ({ path: name, absolute: join(env, name), text: readFileSync(join(env, name), 'utf8') });

type Bound = { readonly id: string; readonly params?: ProgramKey['params'] };

const invocation = (bound: readonly Bound[], sides: readonly LaidSide[]): ProgramInvocation => ({
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
  sides: readonly LaidSide[],
  config: ReturnType<typeof project> | null = project('law.json'),
): Result.Result<ProgramAnswer, string> => {
  const input = invocation(bound, sides);
  const plan = planOxlint(input, sides, config, 1);
  if (Result.isFailure(plan)) return Result.fail(plan.failure);
  if (plan.success.targets.length === 0) return readOxlint(input, sides, plan.success, null);
  const cwd = scratch({
    ...Object.fromEntries(plan.success.sources.map((file) => [file.path, file.text])),
    [plan.success.config.path]: plan.success.config.text,
  });
  const ending = spawnSync('bun', ['--no-install', cli, ...plan.success.args], { cwd, encoding: 'utf8' });
  return readOxlint(input, sides, plan.success, { exitCode: ending.status ?? -1, stdout: ending.stdout });
};

type Unit = { readonly key: string; readonly path: string; readonly value: number; readonly line: number };
const read = (answer: Result.Result<ProgramAnswer, string>, side: 'tree' | 'base'): readonly Unit[] => {
  if (Result.isFailure(answer)) throw new Error(answer.failure);
  return answer.success.readings
    .filter((one) => one.side === side)
    .flatMap((one) => one.findings.map((found) => ({ key: one.key, path: found.path, value: found.value!, line: found.line! })))
    .sort((a, b) => a.key.localeCompare(b.key) || a.path.localeCompare(b.path));
};
const tree = (files: Readonly<Record<string, string>>): LaidSide => ({
  side: 'tree',
  whole: false,
  files: Object.entries(files).map(([path, text]) => ({ path, text })),
});

test("a binding's params reach its rule as context.options, so the allowed site reads clean and every other site is found, whatever the project config says of the rule", () => {
  const files = tree({
    'a.ts': "const a = 'task-ok';\nconst b = 'task';\nconsole.warn(a, b);\nconsole.log(a);\n",
    'b.ts': "export const c = 'task-ok';\n",
  });
  expect(
    read(
      lint(
        [
          { id: 'fixture/no-task', params: { allow: ['task-ok'] } },
          { id: 'eslint/no-console', params: { allow: ['warn'] } },
        ],
        [files],
      ),
      'tree',
    ),
  ).toEqual([
    { key: '0', path: 'a.ts', value: 1, line: 2 },
    { key: '1', path: 'a.ts', value: 1, line: 4 },
  ]);
  expect(read(lint([{ id: 'fixture/no-task' }, { id: 'eslint/no-console' }], [files]), 'tree')).toEqual([
    { key: '0', path: 'a.ts', value: 2, line: 1 },
    { key: '0', path: 'b.ts', value: 1, line: 1 },
    { key: '1', path: 'a.ts', value: 2, line: 3 },
  ]);
});

test('one oxlint process reads both sides, keyed by check and file with the count as value, and a native rule needs no project config', () => {
  const base = 'console.log(0);\n';
  const both = lint(
    [{ id: 'eslint/no-console' }, { id: 'eslint/no-debugger' }],
    [
      tree({ 'src/a.ts': `debugger;\n${base}console.log(1);\n`, 'README.md': '# task' }),
      { side: 'base', whole: false, files: [{ path: 'src/a.ts', text: base }] },
    ],
    null,
  );
  expect(read(both, 'tree')).toEqual([
    { key: '0', path: 'src/a.ts', value: 2, line: 2 },
    { key: '1', path: 'src/a.ts', value: 1, line: 1 },
  ]);
  expect(read(both, 'base')).toEqual([{ key: '0', path: 'src/a.ts', value: 1, line: 1 }]);
  if (Result.isFailure(both)) throw new Error(both.failure);
  expect(both.success.readings.find((one) => one.side === 'tree' && one.key === '0')!.covered).toEqual(['src/a.ts', 'README.md']);
});

test('every rule oxlint lists is bound by the id it reports, and an alias it would rename is refused naming that id', () => {
  const listed = spawnSync('bun', ['--no-install', cli, '--rules', '--format=json'], { encoding: 'utf8' });
  const shown: Readonly<Record<string, string>> = { jsx_a11y: 'jsx-a11y', react_perf: 'react-perf', nextjs: 'next' };
  const ids = (JSON.parse(listed.stdout) as { scope: string; value: string }[])
    .filter((rule) => rule.scope !== 'import')
    .map((rule) => `${shown[rule.scope] ?? rule.scope}/${rule.value}`);
  const files = [tree({ 'a.ts': '' })];
  expect(ids.filter((id) => Result.isFailure(planOxlint(invocation([{ id }], files), files, null, 1)))).toEqual([]);
  expect(
    read(
      lint(
        [{ id: 'next/google-font-display' }],
        [tree({ 'a.tsx': '<link href="https://fonts.googleapis.com/css2?family=Krona+One" />;\n' })],
        null,
      ),
      'tree',
    ),
  ).toEqual([{ key: '0', path: 'a.tsx', value: 1, line: 1 }]);
  for (const id of [
    '@typescript-eslint/no-namespace',
    'react-hooks/rules-of-hooks',
    'typescript/no-unused-vars',
    'nextjs/google-font-display',
    'eslint-plugin-fixture/no-task',
    'no-console',
  ]) {
    expect(Result.isFailure(planOxlint(invocation([{ id }], files), files, null, 1))).toBe(true);
  }
});

test('a plugin that does not resolve, a rule its plugin lacks, a rule bound twice with different params or an unparsable file fails instead of reading clean', () => {
  const files = [tree({ 'a.ts': "const a = 'task';\n" })];
  expect(Result.isFailure(lint([{ id: 'fixture/no-task' }], files, project('missing.json')))).toBe(true);
  expect(Result.isFailure(lint([{ id: 'fixture/nope' }], files))).toBe(true);
  expect(Result.isFailure(lint([{ id: 'fixture/no-task', params: { allow: ['a'] } }, { id: 'fixture/no-task' }], files))).toBe(true);
  expect(Result.isFailure(lint([{ id: 'eslint/no-console' }], [tree({ 'a.ts': 'const = ;\n' })]))).toBe(true);
});
