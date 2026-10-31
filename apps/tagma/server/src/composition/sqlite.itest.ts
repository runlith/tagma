import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOURCE_ID } from '@runlith/sqlite-process/engine';

test('runtime preparation selects SQLite before telemetry workers and retains activity writes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sqlite-startup-'));
  try {
    const child = Bun.spawn([process.execPath, 'run', fileURLToPath(new URL('./testing/sqliteStartup.ts', import.meta.url)), root], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect(code, `${stdout}\n${stderr}`).toBe(0);
    expect(JSON.parse(stdout.trim().split('\n').at(-1)!)).toEqual({ source: SOURCE_ID, health: 'live', rows: [{ thread: 'thread' }] });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
