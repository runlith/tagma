import { afterAll, beforeAll, describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Context, Effect, Exit, FileSystem, Layer, PlatformError } from 'effect';
import { Holder } from '../holder/Holder';
import * as BunServices from '@effect/platform-bun/BunServices';
import { testHolder } from './testing/holder';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { NativeExit, ProcessCost } from '@runlith/executions/protocol/execution';

const RELEASE = resolve(import.meta.dir, '../../native/target/release');
const HOLDER = join(RELEASE, 'execution-holder');
const LIBRARY = join(RELEASE, 'libexecution_platform.dylib');
const LOGIC = join(import.meta.dir, 'testing/logic.ts');
const state = join(homedir(), '.tagma-tests', `holder-${randomUUID()}`);

type Pids = { readonly stream: number; readonly group: number; readonly terminal: number };
type Reap = { readonly exit: NativeExit; readonly cost: ProcessCost };
type Arrival = {
  readonly phase: 1;
  readonly generation: number;
  readonly refusedGeneration: string;
  readonly logic: number;
  readonly holder: number;
  readonly pids: Pids;
  readonly groups: Pids;
};
type Return = {
  readonly phase: 2;
  readonly generation: number;
  readonly logic: number;
  readonly holder: number;
  readonly paused: number;
  readonly restarted: number;
  readonly secondHolder: number;
  readonly pids: Pids;
  readonly groups: Pids;
  readonly parentage: Readonly<Record<string, { readonly ppid: number; readonly pgid: number; readonly stat: string }>>;
  readonly group: { readonly exit: NativeExit; readonly reaped: boolean };
  readonly input: string;
  readonly terminal: { readonly rows: number; readonly cols: number; readonly foreground: number; readonly sid: number };
};
type Ending = {
  readonly phase: 3;
  readonly stream: { readonly errors: string; readonly exit: NativeExit; readonly reap: Reap };
  readonly group: { readonly memberBefore: boolean; readonly memberAfter: boolean; readonly reap: Reap; readonly afterReap: string };
  readonly terminal: { readonly answered: boolean; readonly rows: number; readonly cols: number; readonly exit: NativeExit };
};
type Failure = { readonly phase?: undefined; readonly failed: string };
type Fact = (Arrival & { readonly member: number; readonly answered: boolean }) | Return | Ending | Failure;

const STREAM = `${Array.from({ length: 20_000 }, (_, index) => `${index + 1}\n`).join('')}tail\n`;

let facts: ReadonlyArray<Fact> = [];
let holderExit: number | null = null;
let holderPid = 0;

const phase = <N extends 1 | 2 | 3>(number: N): Extract<Fact, { readonly phase: N }> => {
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

beforeAll(async () => {
  mkdirSync(state, { recursive: true });
  const holder = Bun.spawn([HOLDER, state, process.execPath, LOGIC, LIBRARY, state, HOLDER], {
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
  for (const fact of facts) {
    if (fact.phase !== 1) continue;
    for (const pid of [...Object.values(fact.pids), fact.member]) if (alive(pid)) process.kill(pid, 'SIGKILL');
  }
  rmSync(state, { recursive: true, force: true });
});

describe('the POSIX holder and its client', () => {
  it.live('refuses an unavailable holder binary without retaining either control descriptor', () =>
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const directory = yield* files.makeTempDirectoryScoped({ prefix: 'holder-refused-' });
      const before = yield* files.readDirectory('/dev/fd');
      const refused = yield* Effect.scoped(Layer.build(testHolder(directory, LIBRARY, join(directory, 'missing')))).pipe(Effect.exit);
      expect(Exit.isFailure(refused)).toBe(true);
      expect((yield* files.readDirectory('/dev/fd')).sort()).toEqual(before.sort());
    }).pipe(Effect.provide(BunServices.layer)),
  );

  it.live('refuses EPERM on a PATH candidate instead of choosing a later executable', () =>
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const directory = yield* files.makeTempDirectoryScoped({ prefix: 'holder-path-refused-' });
      const blocked = join(directory, 'blocked', 'true');
      const provided = FileSystem.FileSystem.of({
        ...files,
        stat: (path) =>
          path === blocked
            ? PlatformError.systemError({
                _tag: 'PermissionDenied',
                module: 'FileSystem',
                method: 'stat',
                pathOrDescriptor: path,
                cause: Object.assign(new Error('the candidate is denied'), { code: 'EPERM' }),
              })
            : files.stat(path),
      });
      const context = yield* Layer.build(testHolder(directory)).pipe(Effect.provideService(FileSystem.FileSystem, provided));
      const holder = Context.get(context, Holder);
      const refused = yield* Effect.result(
        holder.launch({
          id: 'path-permission',
          path: 'true',
          argv: ['true'],
          env: [{ name: 'PATH', value: `${join(directory, 'blocked')}:/usr/bin` }],
          cwd: directory,
          transport: { _tag: 'pipes', stdin: 'ignore' },
          pace: 'full',
        }),
      );
      expect(refused).toMatchObject({ _tag: 'Failure', failure: { _tag: 'HolderRefused', reason: 'denied' } });
    }).pipe(Effect.provide(BunServices.layer)),
  );

  it('keeps its set-once generation across logic processes and refuses rebinding it', () => {
    expect(phase(1).generation).toBe(37);
    expect(phase(2).generation).toBe(37);
    expect(phase(1).refusedGeneration).toBe('changed');
  });
  it('restarts a logic that left without vacating, pausing once it fails fast, and leaves once the logic vacated with nothing held', () => {
    expect(facts.filter((fact) => fact.phase === undefined)).toEqual([]);
    expect(phase(1).logic).not.toBe(phase(2).logic);
    expect(phase(2).paused).toBeGreaterThanOrEqual(250);
    expect(holderExit).toBe(0);
  });

  it('restarts a logic that reached ready at once, whatever crashed before it', () => {
    expect(phase(2).restarted).toBeLessThan(250);
  });

  it('leads its own group, and a second holder of the same state is refused by the writer claim', () => {
    expect(phase(2).parentage[String(holderPid)]?.pgid).toBe(holderPid);
    expect(phase(2).secondHolder).toBe(2);
  });

  it('starts children on a terminal and on pipes, each leading its own group under the holder', () => {
    const pids = phase(1).pids;
    expect(phase(1).groups).toEqual(pids);
    expect(phase(2).groups).toEqual(pids);
    expect(phase(1).answered).toBe(true);
    for (const pid of Object.values(pids)) expect(phase(2).parentage[String(pid)]).toMatchObject({ ppid: holderPid, pgid: pid });
    expect(phase(2).terminal).toEqual({ rows: 24, cols: 80, foreground: pids.terminal, sid: pids.terminal });
  });

  it('hands the next logic the same descriptors, so it reads on from the byte the last one stopped at', () => {
    expect(phase(2).holder).toBe(phase(1).holder);
    expect(phase(2).pids).toEqual(phase(1).pids);
    const before = readFileSync(join(state, 'stream.1'), 'latin1');
    const after = readFileSync(join(state, 'stream.2'), 'latin1');
    expect(before.length).toBeGreaterThanOrEqual(40_000);
    expect(after.length).toBeGreaterThan(0);
    expect(before + after).toBe(STREAM);
  });

  it('closes the input in both processes, so the child reads its input to the end', () => {
    expect(phase(2).input).toBe('open');
    expect(phase(3).stream).toMatchObject({ errors: 'err\n', exit: { _tag: 'Code', code: 0 }, reap: { exit: { _tag: 'Code', code: 0 } } });
  });

  it('observes a leader exit without reaping it, signals its group until the reap and refuses after', () => {
    const leader = phase(1).pids.group;
    expect(phase(2).group).toEqual({ exit: { _tag: 'Code', code: 7 }, reaped: false });
    expect(phase(2).parentage[String(leader)]?.stat).toStartWith('Z');
    const signalled = phase(3).group;
    expect(signalled.memberBefore).toBe(true);
    expect(signalled.memberAfter).toBe(false);
    expect(signalled.reap.exit).toEqual({ _tag: 'Code', code: 7 });
    expect(signalled.reap.cost).toMatchObject({ _tag: 'Measured' });
    expect(signalled.reap.cost._tag === 'Measured' && signalled.reap.cost.peakRssBytes > 0).toBe(true);
    expect(signalled.afterReap).toBe('reaped');
  });

  it('carries input and a resize to the terminal for the next logic', () => {
    expect(phase(3).terminal).toEqual({ answered: true, rows: 30, cols: 100, exit: { _tag: 'Signal', signal: 'SIGKILL' } });
  });
});
