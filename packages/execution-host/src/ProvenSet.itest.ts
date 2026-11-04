import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Schedule } from 'effect';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { HOLDER_LIBRARY } from './posix/testing/holder';
import { climb } from '@runlith/executions/stopLadder';
import { loadLibrary } from './posix/Library';
import { processReader } from './composition/testing/native';
import {
  Processes,
  ProcessesUnreadable,
  type ProcessFacts,
  type ProcessIdentity,
  type ProcessReader,
  type ProcessRow,
} from './ProcessReader';
import { type ProcessTables, type ProvenSet, residualStanding, SET_CAP, makeProcessTables, makeProvenSet } from './ProvenSet';
import { killStray } from './strayProcesses';
import { pidStanding } from './posix/testing/processes';
import { processControl } from './posix/control';
import type { ProcessWitness } from '@runlith/executions/protocol/evidence';

const ARTIFACT = HOLDER_LIBRARY;
const LEADER = 100;
const BIRTH = '1000500';
const LEADER_STARTED = 1_000_500;

const row = (pid: number, parent: number, started: number, work = pid, zombie = false): ProcessRow => ({
  pid,
  parent,
  work,
  birth: String(started),
  zombie,
});

type World = {
  table: ProcessRow[];
  identities: Map<number, ProcessIdentity>;
  args: Map<number, string>;
  factsFail: boolean;
  tableFail: boolean;
  onIdentity: (pid: number) => void;
};

const standing = (started: number, work: number, parent = 1, zombie = false): ProcessIdentity => ({
  _tag: 'Read',
  pid: work,
  parent,
  work,
  birth: String(started),
  zombie,
});

const worldOf = (table: ProcessRow[]): World => ({
  table,
  identities: new Map(table.map((entry) => [entry.pid, standing(Number(entry.birth), entry.work, entry.parent, entry.zombie)])),
  args: new Map(),
  factsFail: false,
  tableFail: false,
  onIdentity: () => undefined,
});

const scripted = (world: World): ProcessReader => ({
  members: (work) =>
    Effect.suspend(() =>
      world.tableFail
        ? Effect.fail(new ProcessesUnreadable({ detail: 'refused' }))
        : Effect.succeed(world.table.filter((row) => row.work === work)),
    ),
  table: Effect.suspend(() =>
    world.tableFail ? Effect.fail(new ProcessesUnreadable({ detail: 'refused' })) : Effect.succeed([...world.table]),
  ),
  facts: (pids) =>
    Effect.suspend(() => {
      if (world.factsFail) return Effect.fail(new ProcessesUnreadable({ detail: 'refused' }));
      const byPid = new Map(world.table.map((entry) => [entry.pid, entry]));
      const processes = pids.flatMap((pid): ProcessFacts[] => {
        const found = byPid.get(pid);
        return found === undefined
          ? []
          : [
              {
                pid,
                parent: found.parent,
                work: found.work,
                birth: found.birth,
                args: { _tag: 'Read', value: [world.args.get(pid) ?? `process-${pid}`] },
                executable: { _tag: 'Unreadable' as const, detail: 'denied' },
                folder: { _tag: 'Unreadable' as const, detail: 'denied' },
              },
            ];
      });
      const unread = pids.filter((pid) => !byPid.has(pid)).map((pid) => ({ pid, _tag: 'Gone' as const }));
      return Effect.succeed({ processes, unread });
    }),
  scan() {
    return this.table;
  },
  compareBirth: (left, right) => Number(left) - Number(right),
  bornBetween: () => false,
  resolve: () => 'unknown',
  identity: (pid) => {
    const answer = world.identities.get(pid) ?? { _tag: 'Gone' as const };
    world.onIdentity(pid);
    return answer._tag === 'Read' ? { ...answer, pid } : answer;
  },
});

const numerically = (pids: Iterable<number>): number[] => [...pids].sort((left, right) => left - right);
const setOver = Effect.fnUntraced(function* (world: World, work: number | undefined) {
  const tables = yield* makeProcessTables({ gapMs: 0 }).pipe(Effect.provideService(Processes, scripted(world)));
  return { tables, set: yield* makeProvenSet({ tables, leader: LEADER, birth: BIRTH, work }) };
});
const round = Effect.fnUntraced(function* ({ tables, set }: { readonly tables: ProcessTables; readonly set: ProvenSet }) {
  const reading = yield* Effect.orDie(tables.read());
  yield* set.grow(reading);
  const due = yield* set.due();
  return due.length === 0
    ? 'read'
    : yield* set.refresh(
        due.map(([pid]) => pid),
        0,
      );
});
const memberPids = (set: ProvenSet) => Effect.map(set.members, (members) => numerically(members.map((member) => member.pid)));
const signalled = (world: World, refuse = false) => {
  const sent: Array<readonly [number, string]> = [];
  const kill = ({ pid }: ProcessWitness, signal: string) =>
    Effect.sync(() => {
      sent.push([pid, signal]);
      if (refuse) return false;
      world.identities.delete(pid);
      world.table = world.table.filter((entry) => entry.pid !== pid);
      return true;
    });
  return { sent, kill };
};

it.live('unreadable birth ordering refuses growth without removing already proven members', () =>
  Effect.gen(function* () {
    const world = worldOf([row(LEADER, 1, LEADER_STARTED), row(101, LEADER, 2_000_000)]);
    let unread = false;
    const reader: ProcessReader = {
      ...scripted(world),
      compareBirth: (left, right) =>
        unread ? new ProcessesUnreadable({ detail: 'birth ordering is unavailable' }) : Number(left) - Number(right),
    };
    const tables = yield* makeProcessTables({ gapMs: 0 }).pipe(Effect.provideService(Processes, reader));
    const set = yield* makeProvenSet({ tables, leader: LEADER, birth: BIRTH, work: undefined });
    yield* round({ tables, set });
    expect(yield* memberPids(set)).toEqual([101]);
    unread = true;
    world.table.push(row(102, LEADER, 3_000_000));
    const reading = yield* Effect.orDie(tables.read());
    expect(yield* set.grow(reading)).toBe(false);
    expect(yield* memberPids(set)).toEqual([101]);
    expect(yield* set.witness(102)).toBeUndefined();
  }),
);

it.live('a member the kernel re-parents stays in the set, and the stop still ends it', () =>
  Effect.gen(function* () {
    const world = worldOf([row(LEADER, 1, LEADER_STARTED), row(101, LEADER, 2_000_000, 101)]);
    const held = yield* setOver(world, undefined);
    expect(yield* round(held)).toBe('read');
    expect(yield* memberPids(held.set)).toEqual([101]);
    world.table = [row(101, 1, 2_000_000, 101)];
    world.identities.delete(LEADER);
    expect(yield* round(held)).toBe('read');
    expect(yield* memberPids(held.set)).toEqual([101]);
    const { sent, kill } = signalled(world);
    const ladder = held.set.ladder(kill);
    const climbed = yield* climb('interrupt', [ladder.aim]);
    const swept = yield* ladder.left;
    expect(sent).toEqual([[101, 'interrupt']]);
    expect(climbed.steps).toEqual(['interrupt']);
    expect(swept.residual).toEqual([]);
    expect(swept.measured).toBe(true);
  }),
);

it.live('a proven pid the kernel hands to another process is never signalled, though the reading still shows the old witness', () =>
  Effect.gen(function* () {
    const world = worldOf([row(LEADER, 1, LEADER_STARTED), row(101, LEADER, 2_000_000, 101)]);
    const held = yield* setOver(world, undefined);
    yield* round(held);
    expect(yield* memberPids(held.set)).toEqual([101]);
    world.identities.delete(LEADER);
    world.identities.set(101, standing(3_000_000, 101));
    world.onIdentity = (pid) => {
      if (pid === 101) world.table = [row(101, 1, 3_000_000, 101)];
    };
    const { sent, kill } = signalled(world);
    const ladder = held.set.ladder(kill);
    yield* climb('interrupt', [ladder.aim]);
    const swept = yield* ladder.left;
    expect(sent).toEqual([]);
    expect(swept.residual).toEqual([]);
    expect(swept.unverifiable).toEqual([]);
  }),
);

it.live('a member whose pid a later round reads with another witness leaves the set', () =>
  Effect.gen(function* () {
    const world = worldOf([row(LEADER, 1, LEADER_STARTED), row(101, LEADER, 2_000_000, 101)]);
    const held = yield* setOver(world, undefined);
    yield* round(held);
    world.table = [row(LEADER, 1, LEADER_STARTED), row(101, 1, 3_000_000, 101)];
    yield* round(held);
    expect(yield* memberPids(held.set)).toEqual([]);
  }),
);

it.live('a leader whose pid carries a witness outside its birth is walked from by nobody', () =>
  Effect.gen(function* () {
    const world = worldOf([row(LEADER, 1, 9_000_000), row(101, LEADER, 9_500_000)]);
    const held = yield* setOver(world, undefined);
    yield* round(held);
    expect(yield* memberPids(held.set)).toEqual([]);
    expect((yield* held.set.reading).leader).toBe('Lost');
  }),
);

it.live('a child joins only when it started at or after the witness of the parent it is listed under', () =>
  Effect.gen(function* () {
    const world = worldOf([
      row(LEADER, 1, LEADER_STARTED),
      row(101, LEADER, 900_000),
      row(102, LEADER, 2_000_000),
      row(103, 102, 3_000_000),
    ]);
    const held = yield* setOver(world, undefined);
    yield* round(held);
    expect(yield* memberPids(held.set)).toEqual([102, 103]);
  }),
);

it.live('at the cap new children stay unproven and are never signalled, and the ending says the set was full', () =>
  Effect.gen(function* () {
    const children = Array.from({ length: SET_CAP + 5 }, (_, index) => row(1_000 + index, LEADER, 2_000_000 + index));
    const world = worldOf([row(LEADER, 1, LEADER_STARTED), ...children]);
    const held = yield* setOver(world, undefined);
    yield* round(held);
    const reading = yield* held.set.reading;
    expect(reading.members).toBe(SET_CAP);
    expect(reading.capped).toBe(true);
    const proven = new Set(yield* memberPids(held.set));
    const unproven = children.map((entry) => entry.pid).filter((pid) => !proven.has(pid));
    expect(unproven.length).toBe(5);
    world.identities.delete(LEADER);
    world.table = world.table.filter((entry) => entry.pid !== LEADER);
    const { sent, kill } = signalled(world);
    const ladder = held.set.ladder(kill);
    yield* climb('interrupt', [ladder.aim]);
    const swept = yield* ladder.left;
    const reached = new Set(sent.map(([pid]) => pid));
    expect(unproven.filter((pid) => reached.has(pid))).toEqual([]);
    expect(reached.size).toBe(SET_CAP);
    expect(swept.unverifiable.length).toBe(1);
    expect(swept.measured).toBe(false);
  }),
);

it.live('a refresh whose reading fails leaves the members fields as they stood and counts a failure', () =>
  Effect.gen(function* () {
    const world = worldOf([row(LEADER, 1, LEADER_STARTED), row(101, LEADER, 2_000_000)]);
    const held = yield* setOver(world, undefined);
    yield* round(held);
    world.args.set(101, 'exec-ed');
    world.factsFail = true;
    expect(yield* round(held)).toBe('failed');
    const [member] = yield* held.set.members;
    expect(member?.facts?.args).toEqual({ _tag: 'Read', value: ['process-101'] });
    expect((yield* held.set.reading).failures).toBe(1);
  }),
);

it.live('a member leaving the work after a step began gets that step from the work alone and its own signal at the next step', () =>
  Effect.gen(function* () {
    const world = worldOf([row(LEADER, 1, LEADER_STARTED, LEADER), row(101, LEADER, 2_000_000, LEADER)]);
    const held = yield* setOver(world, LEADER);
    yield* round(held);
    const { sent, kill } = signalled(world);
    const ladder = held.set.ladder(kill);
    expect(yield* ladder.aim.gone).toBe(false);
    world.table = [row(LEADER, 1, LEADER_STARTED, LEADER), row(101, LEADER, 2_000_000, 101), row(102, 101, 2_100_000, 101)];
    world.identities.set(101, standing(2_000_000, 101, LEADER));
    world.identities.set(102, standing(2_100_000, 101, 101));
    yield* ladder.aim.send('interrupt');
    expect(sent).toEqual([]);
    expect(yield* ladder.aim.gone).toBe(false);
    yield* ladder.aim.send('terminate');
    expect(numerically(sent.map(([pid]) => pid))).toEqual([101, 102]);
    expect(sent.every(([, signal]) => signal === 'terminate')).toBe(true);
    expect(yield* ladder.aim.gone).toBe(false);
    world.identities.delete(LEADER);
    world.table = [];
    expect(yield* ladder.aim.gone).toBe(true);
  }),
);

it.live('a zombie member is never signalled and counts as gone', () =>
  Effect.gen(function* () {
    const world = worldOf([row(LEADER, 1, LEADER_STARTED), row(101, LEADER, 2_000_000)]);
    const held = yield* setOver(world, undefined);
    yield* round(held);
    world.table = [row(101, 1, 2_000_000, 101, true)];
    world.identities.delete(LEADER);
    world.identities.set(101, standing(2_000_000, 101, 1, true));
    const { sent, kill } = signalled(world);
    const ladder = held.set.ladder(kill);
    expect(yield* ladder.aim.gone).toBe(true);
    yield* ladder.aim.send('interrupt');
    expect(sent).toEqual([]);
  }),
);

it.live('a table that cannot be read still lets the stop reach proven members, and the ending names the gap', () =>
  Effect.gen(function* () {
    const world = worldOf([row(LEADER, 1, LEADER_STARTED), row(101, LEADER, 2_000_000)]);
    const held = yield* setOver(world, undefined);
    yield* round(held);
    world.tableFail = true;
    world.identities.delete(LEADER);
    const { sent, kill } = signalled(world);
    const ladder = held.set.ladder(kill);
    yield* climb('interrupt', [ladder.aim]);
    const swept = yield* ladder.left;
    expect(sent).toEqual([[101, 'interrupt']]);
    expect(swept.unverifiable.length).toBe(1);
    expect(swept.measured).toBe(false);
  }),
);

it.live('a member still standing outside the work is residual ancestry, and the ended set keeps only its witness for the sweep', () =>
  Effect.gen(function* () {
    const world = worldOf([row(LEADER, 1, LEADER_STARTED, LEADER), row(101, LEADER, 2_000_000, 101), row(102, LEADER, 2_000_001, LEADER)]);
    const held = yield* setOver(world, LEADER);
    yield* round(held);
    const { sent, kill } = signalled(world, true);
    const ladder = held.set.ladder(kill);
    expect(yield* ladder.aim.gone).toBe(false);
    yield* ladder.aim.send('interrupt');
    const swept = yield* ladder.left;
    expect(sent).toEqual([[101, 'interrupt']]);
    expect(swept.residual.map((resource) => [resource.pid, resource.relation])).toEqual([[101, 'ancestry']]);
    expect((yield* held.set.members).map((member) => [member.pid, member.birth, member.facts])).toEqual([
      [101, '2000000', undefined],
      [102, '2000001', undefined],
    ]);
    expect((yield* held.set.reading).watched).toBe(false);
    const swept101 = signalled(world);
    const aim = yield* held.set.residualAim(101, swept101.kill);
    expect(aim).toBeDefined();
    expect(yield* held.set.residualAim(102, swept101.kill)).toBeDefined();
    expect(yield* residualStanding(held.set, 101)).toBe('standing');
    world.identities.set(101, standing(9_000_000, 101));
    yield* aim!.send('terminate');
    expect(swept101.sent).toEqual([]);
    expect(yield* aim!.gone).toBe(true);
    expect(yield* residualStanding(held.set, 101)).toBe('gone');
  }),
);

it.live('a residual pid no witness proves is never standing, whether or not a set holds the execution', () =>
  Effect.gen(function* () {
    const world = worldOf([row(LEADER, 1, LEADER_STARTED)]);
    const held = yield* setOver(world, undefined);
    yield* round(held);
    expect(yield* residualStanding(held.set, globalThis.process.pid)).toBe('unwitnessed');
    expect(yield* residualStanding(undefined, globalThis.process.pid)).toBe('unwitnessed');
    expect(yield* held.set.residualAim(globalThis.process.pid, killStray(undefined))).toBeUndefined();
  }),
);

it.live('a process still in the work that no round proved is named beside the work, and a member or the leader is not', () =>
  Effect.gen(function* () {
    const world = worldOf([row(LEADER, 1, LEADER_STARTED, LEADER), row(101, LEADER, 2_000_000, LEADER)]);
    const held = yield* setOver(world, LEADER);
    yield* round(held);
    world.table = [...world.table, row(300, 1, 2_500_000, LEADER)];
    const ladder = held.set.ladder(signalled(world, true).kill);
    const swept = yield* ladder.left;
    expect(swept.unproven.length).toBe(1);
    expect(swept.residual).toEqual([]);
  }),
);

const killed = (pid: number | undefined) => {
  if (pid === undefined) return;
  try {
    globalThis.process.kill(pid, 'SIGKILL');
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error;
  }
};

const descendantsOf = (table: ReadonlyArray<ProcessRow>, root: number): number[] => {
  const children = new Map<number, number[]>();
  for (const entry of table) {
    const siblings = children.get(entry.parent);
    if (siblings === undefined) children.set(entry.parent, [entry.pid]);
    else siblings.push(entry.pid);
  }
  const found = [root];
  for (let index = 0; index < found.length; index += 1) found.push(...(children.get(found[index]!) ?? []));
  return found.slice(1);
};

it.live('a setsid escapee a round proved is ended through the set after its leader is gone', () =>
  Effect.gen(function* () {
    const library = yield* loadLibrary(ARTIFACT);
    const reader = yield* processReader(library);
    const leader = yield* Effect.acquireRelease(
      Effect.sync(() =>
        Bun.spawn(['/bin/sh', '-c', '/usr/bin/perl -e "use POSIX; POSIX::setsid(); sleep while 1" & /usr/bin/perl -e "sleep while 1"'], {
          stdout: 'ignore',
          stderr: 'ignore',
          detached: true,
        }),
      ),
      (child) =>
        Effect.andThen(
          Effect.sync(() => killed(-child.pid)),
          Effect.promise(() => child.exited),
        ),
    );
    let escapee: number | undefined;
    let strays: number[] = [];
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        killed(escapee);
        for (const pid of strays) killed(pid);
      }),
    );
    const identity = reader.identity(leader.pid);
    if (identity._tag !== 'Read') return yield* Effect.die(new Error('the leader birth could not be read'));
    const tables = yield* makeProcessTables({ gapMs: 0 }).pipe(Effect.provideService(Processes, reader));
    const set = yield* makeProvenSet({ tables, leader: leader.pid, birth: identity.birth, work: undefined });
    yield* Effect.gen(function* () {
      const reading = yield* Effect.orDie(tables.read());
      strays = descendantsOf(reading.rows, leader.pid);
      yield* set.grow(reading);
      const due = yield* set.due();
      yield* set.refresh(
        due.map(([pid]) => pid),
        0,
      );
      const members = yield* set.members;
      escapee = members.find(
        (member) =>
          member.facts?.args._tag === 'Read' &&
          member.facts.args.value.includes('use POSIX; POSIX::setsid(); sleep while 1') &&
          member.work === member.pid,
      )?.pid;
      return escapee;
    }).pipe(Effect.repeat({ schedule: Schedule.spaced(50), until: (pid) => pid !== undefined }));
    expect(escapee).toBeDefined();
    leader.kill('SIGKILL');
    yield* Effect.promise(() => leader.exited);
    const ladder = set.ladder(killStray(processControl(reader)));
    const climbed = yield* climb('interrupt', [ladder.aim]);
    const swept = yield* ladder.left;
    expect(yield* pidStanding(escapee ?? 0)).toBe('gone');
    expect(climbed.steps[0]).toBe('interrupt');
    expect(swept.residual).toEqual([]);
    expect(swept.measured).toBe(true);
  }).pipe(Effect.provide(BunFileSystem.layer)),
);
