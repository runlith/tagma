import { expect, test } from 'bun:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const SETUP = join(import.meta.dir, 'vitest', 'setup.ts');
const GLOBAL = join(import.meta.dir, 'vitest', 'global.ts');
const VITEST = join(dirname(Bun.resolveSync('vitest/package.json', import.meta.dir)), 'vitest.mjs');

const CALLS: Readonly<Record<string, { readonly kind: string; readonly imports: string; readonly call: string }>> = {
  write: { kind: 'write', imports: "import { writeFileSync } from 'node:fs';", call: "writeFileSync(process.env.TMPDIR + '/w', 'x')" },
  spawn: { kind: 'process', imports: "import { spawnSync } from 'node:child_process';", call: "spawnSync('true')" },
  server: { kind: 'socket', imports: "import { createServer } from 'node:net';", call: 'createServer().close()' },
  sqlite: { kind: 'sqlite', imports: "import { DatabaseSync } from 'node:sqlite';", call: "new DatabaseSync(':memory:').close()" },
};

type Row = {
  readonly type: string;
  readonly file: string;
  readonly resource?: string;
  readonly outcome?: string;
  readonly residue?: number;
};

const vitest = async (runtime: 'node' | 'bun', extra: Readonly<Record<string, string>>) => {
  const root = join(process.env['TMPDIR']!, `vitest-${runtime}-${crypto.randomUUID()}`);
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, 'vitest.config.mjs'),
    `export default { test: { globals: true, include: ['*.test.ts', '*.itest.ts'], setupFiles: [${JSON.stringify(SETUP)}], globalSetup: [${JSON.stringify(GLOBAL)}] } };\n`,
  );
  for (const [name, { imports, call }] of Object.entries(CALLS))
    writeFileSync(join(root, `${name}.test.ts`), `${imports}\ntest('${name}', () => { ${call}; });\n`);
  writeFileSync(
    join(root, 'resource.itest.ts'),
    `${Object.values(CALLS)
      .map(({ imports }) => imports)
      .join('\n')}\ntest('resources', () => { ${Object.values(CALLS)
      .map(({ call }) => `${call};`)
      .join(' ')} });\n`,
  );
  writeFileSync(join(root, 'expected.test.ts'), "test.fails('fails as declared', () => { throw new Error('declared'); });\n");
  for (const [name, body] of Object.entries(extra)) writeFileSync(join(root, name), body);
  const report = join(root, 'report.jsonl');
  const command = runtime === 'node' ? ['node', VITEST] : ['bun', '--bun', VITEST];
  const child = Bun.spawn([...command, 'run', '--root', root, '--no-color', '--maxWorkers=1', '--no-file-parallelism'], {
    cwd: root,
    env: { ...process.env, RUNLITH_TEST_REPORT: report },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  const rows = readFileSync(report, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as Row);
  return { output: stdout + stderr, code, rows };
};

const expectGuards = (rows: readonly Row[], output: string): void => {
  const refused = Object.entries(CALLS).map(([name, { kind }]) => ({
    name,
    refused: rows.some((row) => row.type === 'refusal' && row.file.endsWith(`/${name}.test.ts`) && row.resource === kind),
    failed: rows.some((row) => row.type === 'test' && row.file.endsWith(`/${name}.test.ts`) && row.outcome === 'fail'),
  }));
  expect(refused, output).toEqual(Object.keys(CALLS).map((name) => ({ name, refused: true, failed: true })));
  const resource = rows.filter((row) => row.file.endsWith('/resource.itest.ts'));
  expect(
    resource.map((row) => [row.type, row.outcome ?? row.residue]),
    output,
  ).toEqual([
    ['test', 'pass'],
    ['file', 0],
  ]);
  expect(rows.find((row) => row.type === 'test' && row.file.endsWith('/expected.test.ts'))?.outcome, output).toBe('pass');
};

test('under Node, a unit file is refused at the call with its name and the kind, and a resource file runs', async () => {
  const { output, code, rows } = await vitest('node', {});
  expect(code).toBe(1);
  expectGuards(rows, output);
});

test('under Bun, the same holds, and a process a test leaves behind fails its file', async () => {
  const { output, code, rows } = await vitest('bun', {
    'leaves.itest.ts':
      "import { spawn } from 'node:child_process';\ntest('leaves', () => { spawn('sleep', ['311'], { stdio: 'ignore' }).unref(); });\n",
  });
  expect(code).toBe(1);
  expectGuards(rows, output);
  expect(rows.find((row) => row.type === 'file' && row.file.endsWith('/leaves.itest.ts'))?.residue).toBe(1);
  expect(output).toContain('sleep 311');
});
