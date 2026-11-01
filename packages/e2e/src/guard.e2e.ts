import { expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { HANG_MS } from '@runlith/testbed/kinds';

test('a hung browser records evidence before its processes are released', async () => {
  const root = mkdtempSync(join(process.env.TMPDIR!, 'e2e-guard-'));
  const file = join(root, 'hung.e2e.ts');
  const report = join(root, 'run.jsonl');
  writeFileSync(
    file,
    `import { jest, onTestFinished } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { e2e } from ${JSON.stringify(join(import.meta.dir, 'browser.ts'))};
import { onFailure } from ${JSON.stringify(join(import.meta.dir, 'artifacts.ts'))};
const required = createRequire(import.meta.url)('bun:test');
jest.useFakeTimers();
e2e('a hanging page', async ({ page }) => {
  const child = Bun.spawn(['/bin/sleep', '600'], { stdout: 'ignore', stderr: 'ignore' });
  onTestFinished(async () => { child.kill(); await child.exited; });
  required.onTestFinished((done) => { writeFile(${JSON.stringify(join(root, 'finished'))}, 'finished').then(() => done(), done); });
  onFailure((directory) => writeFile(join(directory, 'process.json'), JSON.stringify({ alive: child.exitCode === null })));
  await page.setContent('<!doctype html><title>Guard evidence</title><p>Browser still alive</p>');
  queueMicrotask(() => { jest.advanceTimersByTime(${HANG_MS}); jest.useRealTimers(); });
  await new Promise(() => {});
});`,
  );
  const child = Bun.spawn([process.execPath, resolve(import.meta.dir, '../../../node_modules/.bin/testbed'), 'e2e', file], {
    cwd: root,
    env: { ...process.env, RUNLITH_TEST_REPORT: report },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const collect = async (stream: ReadableStream<Uint8Array>, output: NodeJS.WriteStream) => {
    const chunks: Uint8Array[] = [];
    for await (const chunk of stream) {
      output.write(chunk);
      chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString();
  };
  const [stdout, stderr, code] = await Promise.all([
    collect(child.stdout, process.stdout),
    collect(child.stderr, process.stderr),
    child.exited,
  ]);
  const output = stdout + stderr;
  expect(code, output).toBe(1);
  const directory = /Artifacts: (\S+)/.exec(output)?.[1];
  expect(directory).toBeDefined();
  for (const name of ['screenshot.png', 'trace.zip', 'console.log', 'process.json'])
    expect(existsSync(join(directory!, name)), `${name}: ${output}`).toBe(true);
  expect(statSync(join(directory!, 'screenshot.png')).size).toBeGreaterThan(0);
  expect(statSync(join(directory!, 'trace.zip')).size).toBeGreaterThan(0);
  expect(JSON.parse(readFileSync(join(directory!, 'process.json'), 'utf8'))).toEqual({ alive: true });
  expect(readFileSync(join(root, 'finished'), 'utf8')).toBe('finished');
  const rows = readFileSync(report, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as { type: string; outcome?: string });
  expect(rows.filter((row) => row.type === 'outcome').map((row) => row.outcome)).toEqual(['fail']);
});
