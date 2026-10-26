import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';
import type { ThreadOpenInputHold } from '@runlith/agent/thread/toolOutputs';
import { toolOutputStore } from './outputStore.js';

const flushBytes = 4 * 1024;
const sizes = [256 * 1024, 1024 * 1024];

const stream = async (bytes: number) => {
  const root = mkdtempSync(join(tmpdir(), 'tagma-open-input-bench-'));
  const scope = toolOutputStore(root).scope({ threadId: 't-1', ownerId: 'owner', runId: 'run-1' });
  const text = `{"filePath":"/tmp/a.ts","content":"${'x'.repeat(bytes)}`;
  const started = performance.now();
  const cpu = process.cpuUsage();
  let flushes = 0;
  let held: ThreadOpenInputHold | null = null;
  for (let end = flushBytes; end < text.length + flushBytes; end += flushBytes) {
    const upTo = Math.min(end, text.length);
    const answered: ThreadOpenInputHold = await Effect.runPromise(
      scope.retainOpen({ toolCallId: 'call-1', toolName: 'write', text: text.slice(0, upTo), held }),
    );
    held = answered;
    flushes += 1;
  }
  const used = process.cpuUsage(cpu);
  const wallMs = performance.now() - started;
  const directory = join(root, 't-1');
  const files = readdirSync(directory);
  const diskBytes = files.reduce((total, name) => total + statSync(join(directory, name)).size, 0);
  rmSync(root, { recursive: true, force: true });
  return {
    inputBytes: bytes,
    flushes,
    wallMs: Math.round(wallMs),
    cpuMs: Math.round((used.user + used.system) / 1000),
    files: files.length,
    diskBytes,
  };
};

const rows = [];
for (const bytes of sizes) rows.push(await stream(bytes));
console.log(JSON.stringify({ flushBytes, rows }, null, 2));
