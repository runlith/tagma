import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Result } from 'effect';
import type { ProgramInvocation } from '../../core/program.js';
import { planAstGrep, readAstGrep } from './adapter.js';

const unwrap = <A>(result: Result.Result<A, string>): A => {
  if (Result.isFailure(result)) throw new Error(result.failure);
  return result.success;
};
const input: ProgramInvocation = {
  request: 'conformance',
  checker: 'locked-ast-grep',
  tree: 'tree',
  base: 'base',
  root: '/project',
  keys: [{ key: 'imports', id: 'domain-imports', params: {}, reach: { places: ['src'] } }],
  sides: [{ side: 'tree', paths: [], files: [] }],
};
const configText = 'ruleDirs: [rules]\n';
const ruleText = 'id: domain-imports\nlanguage: Python\nseverity: error\nmessage: forbidden import\nrule:\n  pattern: import billing.api\n';
let root: string;
let binary: string;
beforeAll(() => {
  const require = createRequire(import.meta.url);
  const cli = require.resolve('@ast-grep/cli/package.json');
  const native = require.resolve(
    `@ast-grep/cli-${process.platform}-${process.arch}${process.platform === 'linux' ? '-gnu' : process.platform === 'win32' ? '-msvc' : ''}/package.json`,
    { paths: [dirname(cli)] },
  );
  binary = join(dirname(native), process.platform === 'win32' ? 'ast-grep.exe' : 'ast-grep');
  root = realpathSync(mkdtempSync(join(tmpdir(), 'ast-grep-conformance-')));
  mkdirSync(join(root, 'checks/rules'), { recursive: true });
  writeFileSync(join(root, 'checks/sgconfig.yml'), configText);
  writeFileSync(join(root, 'checks/rules/.domain.yml'), ruleText);
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

const run = async (args: readonly string[]) => {
  const child = Bun.spawn([binary, ...args], { cwd: root, stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0 && exitCode !== 1) throw new Error(`${exitCode}: ${stderr}`);
  return { stdout, exitCode };
};

test('locked native ast-grep counts each side in one files invocation, at checkout-equivalent counts', async () => {
  const sides = [
    {
      side: 'tree' as const,
      whole: false,
      files: [
        { path: 'src/domain.py', text: 'x = 0\nimport billing.api\nimport billing.api\n' },
        { path: 'src/a%20b.py', text: 'import billing.api\n' },
        { path: 'src/a b.py', text: 'x = 1\n' },
      ],
    },
    { side: 'base' as const, whole: false, files: [{ path: 'src/domain.py', text: 'x = 0\nimport billing.api\n' }] },
  ];
  const plan = unwrap(
    planAstGrep(input, sides, { text: configText, absolute: join(root, 'checks/sgconfig.yml') }, [
      { path: 'checks/rules/.domain.yml', text: ruleText },
    ]),
  );
  for (const file of plan.files) {
    mkdirSync(dirname(join(root, file.path)), { recursive: true });
    writeFileSync(join(root, file.path), file.text);
  }
  const ending = await run(plan.args);
  const answer = unwrap(readAstGrep(input, sides, plan, ending));
  expect(answer.readings.map((reading) => reading.findings.find((found) => found.path === 'src/domain.py')?.value)).toEqual([2, 1]);
  expect(answer.readings[0]!.findings.find((found) => found.path === 'src/a%20b.py')?.value).toBe(1);
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src/domain.py'), 'import billing.api\nimport billing.api\n');
  const checkout = await run([...plan.args.slice(0, plan.args.indexOf('--') + 1), 'src/domain.py']);
  const raw = JSON.parse(checkout.stdout);
  expect(raw.runs[0].results.length).toBe(2);
  expect(raw.version).toBe(answer.run.version);
  expect(readFileSync(join(root, 'tree/src/domain.py'), 'utf8').split('\n').length).toBe(sides[0]!.files[0]!.text.split('\n').length);
});
