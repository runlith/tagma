import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { HOLDER_LIBRARY } from './testing/holder';

const RELEASE = resolve(import.meta.dir, '../../native/target/release');
const HOLDER = join(RELEASE, 'execution-holder');
const LIBRARY = HOLDER_LIBRARY;
const LOGIC = join(import.meta.dir, 'testing/departing.ts');
const state = join(homedir(), '.tagma-tests', `holder-departure-${randomUUID()}`);

type Fact =
  | {
      readonly phase: 2;
      readonly logic: number;
      readonly first: number;
      readonly firstAlive: boolean;
      readonly waited: number;
      readonly held: ReadonlyArray<number>;
      readonly child: number;
    }
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
  mkdirSync(state, { recursive: true });
  const holder = Bun.spawn([HOLDER, state, process.execPath, LOGIC, LIBRARY, state], {
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
  const departed = join(state, 'departed');
  if (existsSync(departed)) {
    const { logic, child } = JSON.parse(readFileSync(departed, 'utf8')) as { logic: number; child: number };
    for (const pid of [logic, child]) if (alive(pid)) process.kill(pid, 'SIGKILL');
  }
  rmSync(state, { recursive: true, force: true });
});

describe('a holder whose logic closed its channel and stays', () => {
  it('ends that logic by its deadline and starts the next one only after reaping it, with the table whole', () => {
    expect(facts.filter((fact) => fact.phase === undefined)).toEqual([]);
    const next = facts.find((fact) => fact.phase === 2);
    if (next?.phase !== 2) throw new Error(`the next logic reported nothing: ${JSON.stringify(facts)}`);
    expect(next.logic).not.toBe(next.first);
    expect(next.firstAlive).toBe(false);
    expect(next.waited).toBeGreaterThanOrEqual(9_500);
    expect(next.waited).toBeLessThan(15_000);
    expect(next.held).toEqual([next.child]);
    expect(holderExit).toBe(0);
  });
});
