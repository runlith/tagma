import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { HOLDER_BINARY, HOLDER_LIBRARY } from './testing/holder';

const LOGIC = join(import.meta.dir, 'testing/handover.ts');
const HOLDER_PART = 'native/execution-holder';
const state = join(homedir(), '.tagma-tests', `holder-handover-${randomUUID()}`);

type Fact =
  | { readonly phase: 1; readonly pid: number; readonly before: boolean }
  | { readonly phase: 2; readonly pid: number; readonly after: boolean; readonly entered: boolean }
  | { readonly phase?: undefined; readonly failed: string };

let facts: ReadonlyArray<Fact> = [];
let holderExit: number | null = null;
let holderPid = 0;

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

beforeAll(async () => {
  const standing = join(state, 'bundle', HOLDER_PART);
  mkdirSync(dirname(standing), { recursive: true });
  copyFileSync(HOLDER_BINARY, standing);
  const holder = Bun.spawn([standing, state, process.execPath, LOGIC, HOLDER_LIBRARY, state, HOLDER_PART], {
    cwd: state,
    stdin: 'ignore',
    stdout: 'ignore',
    stderr: 'inherit',
  });
  holderPid = holder.pid;
  holderExit = await holder.exited;
  const reported = join(state, 'report.jsonl');
  facts = existsSync(reported)
    ? readFileSync(reported, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as Fact)
    : [];
});

afterAll(() => {
  if (alive(holderPid)) process.kill(holderPid, 'SIGKILL');
  for (const fact of facts) if (fact.phase !== undefined && alive(fact.pid)) process.kill(fact.pid, 'SIGKILL');
  rmSync(state, { recursive: true, force: true });
});

describe('a logic that cannot send ACTIVATE', () => {
  it('permits the standing candidate by its exit status, and the holder starts it over the same children', () => {
    expect(facts.filter((fact) => fact.phase === undefined)).toEqual([]);
    const [first, second] = facts;
    expect(first).toMatchObject({ phase: 1, before: true });
    expect(second).toMatchObject({ phase: 2, after: true, entered: true, pid: first?.phase === 1 ? first.pid : -1 });
    expect(holderExit).toBe(0);
  });
});
