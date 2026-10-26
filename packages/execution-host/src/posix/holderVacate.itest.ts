import { afterAll, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const RELEASE = resolve(import.meta.dir, '../../native/target/release');
const HOLDER = join(RELEASE, 'execution-holder');
const LIBRARY = join(RELEASE, 'libexecution_platform.dylib');
const LOGIC = join(import.meta.dir, 'testing/vacating.ts');
const state = join(homedir(), '.tagma-tests', `holder-vacate-${randomUUID()}`);
const LEAVE_MS = 5_000;

type Fact = { readonly leader?: number; readonly member?: number; readonly relaunched?: number; readonly failed?: string };

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const facts = (): ReadonlyArray<Fact> => {
  const reported = join(state, 'report.jsonl');
  return existsSync(reported)
    ? readFileSync(reported, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as Fact)
    : [];
};

const started: number[] = [];

afterAll(() => {
  for (const pid of started) if (alive(pid)) process.kill(pid, 'SIGKILL');
  rmSync(state, { recursive: true, force: true });
});

test.skipIf(!existsSync(LIBRARY))(
  'a logic that vacates and leaves with work still held ends that work, and the holder leaves instead of starting another logic',
  async () => {
    mkdirSync(state, { recursive: true });
    const holder = Bun.spawn([HOLDER, state, process.execPath, LOGIC, LIBRARY, state], {
      cwd: state,
      stdin: 'ignore',
      stdout: 'ignore',
      stderr: 'inherit',
    });
    started.push(holder.pid);
    const exit = await Promise.race([holder.exited, Bun.sleep(LEAVE_MS).then(() => 'stayed' as const)]);
    const reported = facts();
    const held = reported.find((fact) => fact.leader !== undefined);
    if (held?.leader !== undefined) started.push(held.leader, held.member ?? held.leader);
    expect(reported.filter((fact) => fact.failed !== undefined || fact.relaunched !== undefined)).toEqual([]);
    expect(exit).toBe(0);
    expect([held?.leader, held?.member].map((pid) => pid !== undefined && alive(pid))).toEqual([false, false]);
  },
  10_000,
);
