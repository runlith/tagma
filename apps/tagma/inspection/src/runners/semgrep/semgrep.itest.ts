import { afterAll as bunAfterAll, beforeAll as bunBeforeAll, beforeEach, expect, test as bunTest } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { Result } from 'effect';
import type { ProgramInvocation } from '../../core/program.js';
import { SEMGREP_COVERAGE, planSemgrep, readSemgrep } from './adapter.js';

const pinned = process.env.TAGMA_SEMGREP_BINARY !== undefined;
const test = bunTest.skipIf(!pinned);
const beforeAll = (hook: Parameters<typeof bunBeforeAll>[0]): void => {
  if (pinned) bunBeforeAll(hook);
};
const afterAll = (hook: Parameters<typeof bunAfterAll>[0]): void => {
  if (pinned) bunAfterAll(hook);
};

const input: ProgramInvocation = {
  request: 'conformance',
  checker: 'offline-semgrep',
  tree: 'tree',
  base: 'base',
  root: '/project',
  keys: [{ key: 'k', id: 'domain-imports', params: {}, reach: { places: ['src'] } }],
  sides: [{ side: 'tree', paths: [], files: [] }],
};
const text =
  'rules:\n  - id: domain-imports\n    languages: [python]\n    severity: ERROR\n    message: forbidden import\n    pattern: import billing.api\n';
const unwrap = <A>(result: Result.Result<A, string>): A => {
  if (Result.isFailure(result)) throw new Error(result.failure);
  return result.success;
};
let root: string;
let binary: string;
const run = async (args: readonly string[]) => {
  const child = Bun.spawn([binary, ...args], {
    cwd: root,
    env: {
      ...process.env,
      SEMGREP_ENABLE_VERSION_CHECK: '0',
      SEMGREP_SEND_METRICS: 'off',
      SEMGREP_SETTINGS_FILE: join(root, 'settings.yml'),
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, exitCode };
};
beforeAll(async () => {
  binary = process.env.TAGMA_SEMGREP_BINARY ?? '';
  const hash = process.env.TAGMA_SEMGREP_SHA256 ?? '';
  if (!isAbsolute(binary) || !/^[a-f0-9]{64}$/.test(hash))
    throw new Error(
      'precondition: offline Semgrep with its Python dependencies installed, TAGMA_SEMGREP_BINARY absolute and TAGMA_SEMGREP_SHA256 pinning the launcher; production additionally requires a self-contained native artifact',
    );
  expect(createHash('sha256').update(readFileSync(binary)).digest('hex')).toBe(hash);
  root = realpathSync(mkdtempSync(join(tmpdir(), 'semgrep-conformance-')));
});
if (pinned) beforeEach(() => writeFileSync(join(root, 'rules.yml'), text));
afterAll(() => {
  if (root !== undefined) rmSync(root, { recursive: true, force: true });
});

test('precondition-bound offline Semgrep reads both sides at checkout-equivalent counts, honouring nosemgrep, with error exits', async () => {
  const sides = [
    {
      side: 'tree' as const,
      whole: false,
      files: [
        { path: 'src/domain.py', text: 'import billing.api\nimport billing.api\nimport billing.api # nosemgrep\n' },
        { path: 'src/a%20b.py', text: 'import billing.api\n' },
        { path: 'src/a b.py', text: 'x = 1\n' },
      ],
    },
    { side: 'base' as const, whole: false, files: [{ path: 'src/domain.py', text: 'import billing.api\n' }] },
  ];
  const plan = unwrap(planSemgrep(input, sides, { text, absolute: join(root, 'rules.yml') }));
  for (const file of plan.files) {
    mkdirSync(dirname(join(root, file.path)), { recursive: true });
    writeFileSync(join(root, file.path), file.text);
  }
  const ending = await run(plan.args);
  if (ending.exitCode !== 0 && ending.exitCode !== 1) throw new Error(`${ending.exitCode}: ${ending.stderr}`);
  const decoded = readSemgrep(input, sides, plan, { ...ending, coverage: readFileSync(join(root, SEMGREP_COVERAGE), 'utf8') });
  if (Result.isFailure(decoded)) throw new Error(`${decoded.failure}: ${ending.stdout}`);
  const answer = decoded.success;
  expect(answer.readings.map((reading) => reading.findings.find((one) => one.path === 'src/domain.py')?.value)).toEqual([2, 1]);
  expect(answer.readings[0]!.findings.find((one) => one.path === 'src/a%20b.py')?.value).toBe(1);
});

test('offline Semgrep checkout paths have the same unsuppressed count', async () => {
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src/domain.py'), 'import billing.api\nimport billing.api\n');
  const sides = [{ side: 'tree' as const, whole: false, files: [{ path: 'src/domain.py', text: '' }] }];
  const plan = unwrap(planSemgrep(input, sides, { text, absolute: join(root, 'rules.yml') }));
  const checkout = await run([...plan.args.slice(0, plan.args.indexOf('--') + 1), 'src/domain.py']);
  expect(JSON.parse(checkout.stdout).runs[0].results.length).toBe(2);
});

test('offline Semgrep accepts a complete clean reading and refuses an invalid rule config', async () => {
  const sides = [{ side: 'tree' as const, whole: false, files: [{ path: 'src/clean.py', text: 'x = 1\n' }] }];
  const plan = unwrap(planSemgrep(input, sides, { text, absolute: join(root, 'rules.yml') }));
  mkdirSync(join(root, 'tree/src'), { recursive: true });
  writeFileSync(join(root, 'tree/src/clean.py'), 'x = 1\n');
  const clean = await run(plan.args);
  expect(
    unwrap(readSemgrep(input, sides, plan, { ...clean, coverage: readFileSync(join(root, SEMGREP_COVERAGE), 'utf8') })).readings[0]!
      .findings,
  ).toEqual([]);
  writeFileSync(join(root, 'rules.yml'), 'rules: broken\n');
  const failed = await run(plan.args);
  expect(Result.isFailure(readSemgrep(input, sides, plan, failed))).toBe(true);
});
