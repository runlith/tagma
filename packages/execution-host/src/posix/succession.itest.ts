import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { HOLDER_LIBRARY } from './testing/holder';
import type { NativeExit } from '@runlith/executions/protocol/execution';

const RELEASE = resolve(import.meta.dir, '../../native/target/release');
const HOLDER = join(RELEASE, 'execution-holder');
const LIBRARY = HOLDER_LIBRARY;
const LOGIC = join(import.meta.dir, 'testing/succession.ts');
const HOLDER_PART = 'native/execution-holder';
const state = join(homedir(), '.tagma-tests', `holder-succession-${randomUUID()}`);
const STANDING_HOLDER = join(state, 'holder-standing');

type Pids = { readonly terminal: number; readonly stream: number };
type Exchanged = { readonly terminal: boolean; readonly stream: boolean };
type Fact =
  | {
      readonly phase: 1;
      readonly holder: number;
      readonly pids: Pids & { readonly leaving: number };
      readonly before: Exchanged;
      readonly prepared: Exchanged;
      readonly flagsBefore: Readonly<Record<string, number>>;
      readonly flagsAfter: Readonly<Record<string, number>>;
    }
  | {
      readonly phase: 2;
      readonly holder: number;
      readonly command: string;
      readonly logic: string;
      readonly pids: Pids;
      readonly leaving: { readonly exit: NativeExit; readonly unreaped: boolean; readonly reap: NativeExit };
      readonly exchanged: Exchanged;
      readonly refused: string;
      readonly stale: string;
      readonly misstarted: string;
    }
  | {
      readonly phase: 3;
      readonly holder: number;
      readonly command: string;
      readonly logic: string;
      readonly pids: Pids;
      readonly exchanged: Exchanged;
      readonly restored: { readonly standing: boolean; readonly candidate: boolean };
      readonly hung: { readonly reason: string; readonly waited: number; readonly kept: Exchanged & { readonly held: number } };
      readonly inputEnded: { readonly verifying: boolean; readonly exit: NativeExit };
    }
  | {
      readonly phase: 4;
      readonly holder: number;
      readonly command: string;
      readonly logic: string;
      readonly pids: Pids;
      readonly exchanged: Exchanged;
      readonly streamExit: NativeExit;
      readonly entered: boolean;
      readonly stale: boolean;
    }
  | { readonly phase?: undefined; readonly failed: string };

let facts: ReadonlyArray<Fact> = [];
let holderExit: number | null = null;
let diagnostics = '';
let holderPid = 0;

const phase = <N extends 1 | 2 | 3 | 4>(number: N): Extract<Fact, { readonly phase: N }> => {
  const found = facts.find((fact): fact is Extract<Fact, { readonly phase: N }> => fact.phase === number);
  if (found === undefined) throw new Error(`no phase ${number} was reported: ${JSON.stringify(facts)}`);
  return found;
};

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const place = (path: string) => {
  mkdirSync(dirname(path), { recursive: true });
  copyFileSync(HOLDER, path);
};

beforeAll(async () => {
  place(STANDING_HOLDER);
  place(join(state, 'bundle', HOLDER_PART));
  place(join(state, 'bundle.next', HOLDER_PART));
  const signed = Bun.spawnSync([
    '/usr/bin/codesign',
    '--force',
    '-s',
    '-',
    '-i',
    'tagma.holder.next',
    join(state, 'bundle.next', HOLDER_PART),
  ]);
  if (signed.exitCode !== 0) throw new Error(`the next holder could not be signed: ${signed.stderr.toString()}`);
  const holder = Bun.spawn(
    [join(state, 'bundle', HOLDER_PART), state, process.execPath, LOGIC, LIBRARY, state, HOLDER_PART, STANDING_HOLDER],
    {
      cwd: state,
      stdin: 'pipe',
      stdout: 'ignore',
      stderr: 'pipe',
    },
  );
  holderPid = holder.pid;
  const said = (async () => {
    for await (const chunk of holder.stderr) {
      process.stderr.write(chunk);
      diagnostics += new TextDecoder().decode(chunk);
    }
  })();
  holderExit = await holder.exited;
  await holder.stdin.end();
  await said;
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
  const first = facts.find((fact) => fact.phase === 1);
  if (first?.phase === 1) for (const pid of Object.values(first.pids)) if (alive(pid)) process.kill(pid, 'SIGKILL');
  rmSync(state, { recursive: true, force: true });
});

describe('a holder that replaces its own image', () => {
  it('reports every phase without failure and leaves once the last logic vacated', () => {
    expect(facts.filter((fact) => fact.phase === undefined)).toEqual([]);
    expect(holderExit).toBe(0);
  });

  it('prepares a different holder over its table without changing a flag of the descriptors it shares', () => {
    const first = phase(1);
    const shared = Object.keys(first.flagsBefore).filter((fd) => fd in first.flagsAfter);
    expect(shared.length).toBeGreaterThan(0);
    expect(Object.fromEntries(shared.map((fd) => [fd, first.flagsAfter[fd]]))).toEqual(
      Object.fromEntries(shared.map((fd) => [fd, first.flagsBefore[fd]])),
    );
    expect(first.prepared).toEqual({ terminal: true, stream: true });
  });

  it('keeps its pid and its children across the exec, and hands over the exit of a child that left meanwhile', () => {
    const first = phase(1);
    const second = phase(2);
    expect(first.holder).toBe(holderPid);
    expect(second.holder).toBe(holderPid);
    expect(second.command).toContain('--successor');
    expect(second.pids).toEqual({ terminal: first.pids.terminal, stream: first.pids.stream });
    expect(second.leaving).toEqual({ exit: { _tag: 'Code', code: 7 }, unreaped: true, reap: { _tag: 'Code', code: 7 } });
    expect(second.exchanged).toEqual({ terminal: true, stream: true });
  });

  it('forgets a preparation once its bundle is active, so an activation needs a new one', () => {
    expect(phase(2).stale).toBe('invalid');
  });

  it('starts the logic of the activated bundle by the runtime and host its preparation named', () => {
    for (const logic of [phase(2).logic, phase(3).logic, phase(4).logic]) {
      expect(logic).toStartWith(`${join(state, 'bundle', 'runtime/bun')} ${join(state, 'bundle', 'host/entry.ts')} `);
    }
  });

  it('ends a preparation the next holder does not answer in its time, leaving the table and the children untouched', () => {
    const hung = phase(3).hung;
    expect(hung.reason).toBe('timeout');
    expect(hung.waited).toBeGreaterThanOrEqual(9_500);
    expect(hung.kept).toEqual({ held: 2, terminal: true, stream: true });
  });

  it('lets an input end reach its child while the next holder verifies the table', () => {
    const ended = phase(3).inputEnded;
    expect(ended.verifying).toBe(true);
    expect(ended.exit).toEqual({ _tag: 'Code', code: 5 });
  });

  it('refuses to prepare a holder it cannot start, and returns to the prior holder when the successor cannot start its logic', () => {
    expect(phase(2).refused).toBe('denied');
    const third = phase(3);
    expect(third.holder).toBe(holderPid);
    expect(third.command).toContain('--returned');
    expect(third.pids).toEqual(phase(2).pids);
    expect(third.exchanged).toEqual({ terminal: true, stream: true });
    expect(third.restored).toEqual({ standing: false, candidate: true });
  });

  it('refuses on preparation a candidate that would fail to start as a successor', () => {
    expect(phase(2).misstarted).toBe('invalid');
  });

  it('returns to the prior holder when the successor dies of a fatal signal before its logic starts, its children alive', () => {
    expect(diagnostics.split('the successor crashed before its logic started').length - 1).toBe(1);
    expect(phase(4).pids).toEqual(phase(3).pids);
    expect(phase(4).exchanged).toEqual({ terminal: true, stream: true });
  });

  it('activates the bundle named by an exit permission using its current entry rather than an earlier preparation', () => {
    const fourth = phase(4);
    expect(fourth.holder).toBe(holderPid);
    expect(fourth.command).toContain('--successor');
    expect(fourth.entered).toBe(true);
    expect(fourth.stale).toBe(false);
    expect(fourth.pids).toEqual(phase(3).pids);
    expect(fourth.exchanged).toEqual({ terminal: true, stream: true });
    expect(fourth.streamExit).toEqual({ _tag: 'Code', code: 0 });
    expect(existsSync(join(state, 'bundle.prior', HOLDER_PART))).toBe(true);
  });
});
