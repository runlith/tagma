import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runJobs } from './schedule.ts';

test('an output consumer failure stops the running job before returning its original failure', async () => {
  const root = mkdtempSync(join(tmpdir(), 'schedule-output-'));
  const failure = new Error('output destination failed');
  let pid: number | undefined;
  let output = '';
  const alive = () => {
    if (pid === undefined) return false;
    try {
      return process.kill(pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
      throw error;
    }
  };
  try {
    await expect(
      runJobs(
        [
          {
            id: 'held',
            cwd: root,
            stages: [
              [
                process.execPath,
                '-e',
                "require('node:fs').watch(process.cwd(), () => {}); process.stdout.write(String(process.pid) + '\\n')",
              ],
            ],
            need: 1,
            env: process.env,
          },
        ],
        {
          budget: 1,
          serial: true,
          output: (_job, chunk) => {
            output += new TextDecoder().decode(chunk);
            if (!output.includes('\n')) return;
            pid = Number(output.trim());
            throw failure;
          },
          ended: () => {},
        },
      ),
    ).rejects.toBe(failure);
    expect(pid).toBeDefined();
    expect(alive()).toBe(false);
  } finally {
    if (alive()) process.kill(pid!, 'SIGKILL');
    while (alive()) await new Promise<void>((resolve) => setImmediate(resolve));
    rmSync(root, { recursive: true, force: true });
  }
});
