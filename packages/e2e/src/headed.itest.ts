import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { NotRunRow } from '@runlith/testbed/ledger';

test('headed scenarios are reported without launching until explicitly selected', async () => {
  const root = mkdtempSync(join(process.env.TMPDIR!, 'headed-'));
  const file = join(root, 'desktop.e2e.ts');
  writeFileSync(
    file,
    `import { e2e } from ${JSON.stringify(join(import.meta.dir, 'browser.ts'))};
e2e('desktop answer', async () => {}, {
  lanes: ['electron'],
  headed: true,
  electron: () => { throw new Error('desktop prerequisite unavailable'); },
});`,
  );
  const run = async (headed: boolean) => {
    const report = join(root, headed ? 'headed.jsonl' : 'headless.jsonl');
    const child = Bun.spawn(
      [process.execPath, resolve(import.meta.dir, '../../../node_modules/.bin/testbed'), 'e2e', ...(headed ? ['--headed'] : []), file],
      {
        cwd: root,
        env: { ...process.env, E2E_LANES: 'electron', RUNLITH_TEST_REPORT: report },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    const rows = readFileSync(report, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as NotRunRow);
    return { code, output: stdout + stderr, notRun: rows.filter((row) => row.type === 'not-run') };
  };
  const headless = await run(false);
  expect(headless.code, headless.output).toBe(0);
  expect(headless.notRun).toEqual([expect.objectContaining({ name: 'desktop answer [electron]', reason: 'headed' })]);
  expect(headless.output).toContain('headed, not run: desktop answer [electron]');
  const headed = await run(true);
  expect(headed.code, headed.output).toBe(1);
  expect(headed.notRun).toEqual([]);
  expect(headed.output).toContain('desktop prerequisite unavailable');
});
