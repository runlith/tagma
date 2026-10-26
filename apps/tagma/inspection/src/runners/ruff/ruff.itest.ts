import { afterAll as bunAfterAll, beforeAll as bunBeforeAll, expect, test as bunTest } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { Result } from 'effect';
import type { ProgramInvocation } from '../../core/program.js';
import { RUFF_VERSION, planRuff, readRuff } from './adapter.js';

const pinned = process.env.TAGMA_RUFF_BINARY !== undefined;
const test = bunTest.skipIf(!pinned);
const beforeAll = (hook: Parameters<typeof bunBeforeAll>[0]): void => {
  if (pinned) bunBeforeAll(hook);
};
const afterAll = (hook: Parameters<typeof bunAfterAll>[0]): void => {
  if (pinned) bunAfterAll(hook);
};

const input: ProgramInvocation = {
  request: 'conformance',
  checker: 'pinned-ruff',
  tree: 'tree',
  base: 'base',
  root: '/project',
  keys: [{ key: 'k', id: 'F401', params: {}, reach: { places: ['src'] } }],
  sides: [{ side: 'tree', paths: [], files: [] }],
};
const text = '[lint]\nselect = ["F401"]\n';
const unwrap = <A>(result: Result.Result<A, string>): A => {
  if (Result.isFailure(result)) throw new Error(result.failure);
  return result.success;
};
let root: string;
let binary: string;
const run = async (args: readonly string[]) => {
  const child = Bun.spawn([binary, ...args], {
    cwd: root,
    env: { ...process.env, RAYON_NUM_THREADS: '1' },
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
  binary = process.env.TAGMA_RUFF_BINARY ?? '';
  const sha256 = process.env.TAGMA_RUFF_SHA256 ?? '';
  if (!isAbsolute(binary) || !/^[a-f0-9]{64}$/.test(sha256))
    throw new Error('precondition: TAGMA_RUFF_BINARY is an absolute offline Ruff 0.13.3 artifact; TAGMA_RUFF_SHA256 pins its bytes');
  expect(createHash('sha256').update(readFileSync(binary)).digest('hex')).toBe(sha256);
  root = realpathSync(mkdtempSync(join(tmpdir(), 'ruff-conformance-')));
  writeFileSync(join(root, 'ruff.toml'), text);
  expect((await run(['--version'])).stdout.trim()).toBe(`ruff ${RUFF_VERSION}`);
});
afterAll(() => {
  if (root !== undefined) rmSync(root, { recursive: true, force: true });
});

test('precondition-bound Ruff reads both sides at checkout-equivalent counts, honouring noqa, with error exits offline', async () => {
  const sides = [
    { side: 'tree' as const, whole: false, files: [{ path: 'src/domain.py', text: 'import os\nimport sys\nimport re  # noqa: F401\n' }] },
    { side: 'base' as const, whole: false, files: [{ path: 'src/domain.py', text: 'import os\n' }] },
  ];
  const plan = unwrap(planRuff(input, sides, { text, absolute: join(root, 'ruff.toml') }));
  for (const file of plan.files) {
    mkdirSync(dirname(join(root, file.path)), { recursive: true });
    writeFileSync(join(root, file.path), file.text);
  }
  const ending = await run(plan.args);
  const answer = unwrap(readRuff(input, sides, plan, ending, root));
  expect(answer.readings.map((reading) => reading.findings.map((one) => [one.fingerprint, one.value]))).toEqual([
    [['src/domain.py', 2]],
    [['src/domain.py', 1]],
  ]);
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src/domain.py'), 'import os\nimport sys\n');
  const checkout = await run([...plan.args.slice(0, plan.args.indexOf('--') + 1), 'src/domain.py']);
  expect(JSON.parse(checkout.stdout).map((one: { code: string }) => one.code)).toEqual(['F401', 'F401']);
  writeFileSync(join(root, 'tree/src/domain.py'), 'x = 1\n');
  writeFileSync(join(root, 'base/src/domain.py'), 'x = 1\n');
  expect((await run(plan.args)).exitCode).toBe(0);
  writeFileSync(join(root, 'ruff.toml'), 'extend = "missing.toml"\n');
  const failed = await run(plan.args);
  expect(Result.isFailure(readRuff(input, sides, plan, failed, root))).toBe(true);
});
