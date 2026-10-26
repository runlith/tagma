import { Clock, Effect, Option, Ref, Schema, Semaphore } from 'effect';
import { ProcessControl } from './ProcessControl';
import { sameProcess, type ProcessWitness } from '@runlith/executions/protocol/evidence';
import type { StopStep } from '@runlith/executions/protocol/call';
import type { ResidualResource, UnverifiableResource } from '@runlith/executions/protocol/stop';
import type { LadderAim } from '@runlith/executions/stopLadder';
import {
  Processes,
  type BirthOrder,
  type ProcessesUnreadable,
  type ProcessFacts,
  type ProcessIdentity,
  type ProcessReader,
  type ProcessReading,
  type ProcessRow,
} from './ProcessReader';

export const ROUND_PERIOD_MS = 1_000;
const TABLE_P95_MICROS = 2_030;
const MEMBER_P95_MICROS = 104;
export const ROUND_BUDGET = Math.floor(((ROUND_PERIOD_MS * 1_000) / 2 - TABLE_P95_MICROS) / MEMBER_P95_MICROS);
export const SET_CAP = ROUND_BUDGET;
export const FACTS_CHUNK = 64;
export const TABLE_GAP_MS = 50;

export type TableReading = {
  readonly rows: ReadonlyArray<ProcessRow>;
  readonly byPid: ReadonlyMap<number, ProcessRow>;
  readonly children: ReadonlyMap<number, ReadonlyArray<ProcessRow>>;
  readonly atNanos: bigint;
};

export const indexed = (rows: ReadonlyArray<ProcessRow>, atNanos: bigint): TableReading => {
  const byPid = new Map<number, ProcessRow>();
  const children = new Map<number, ProcessRow[]>();
  for (const row of rows) {
    byPid.set(row.pid, row);
    const kin = children.get(row.parent);
    if (kin === undefined) children.set(row.parent, [row]);
    else kin.push(row);
  }
  return { rows, byPid, children, atNanos };
};

export type ProcessTables = {
  readonly reader: ProcessReader;
  readonly control: ProcessControl['Service'] | undefined;
  readonly read: (notBefore?: bigint) => Effect.Effect<TableReading, ProcessesUnreadable>;
};

export const makeProcessTables = Effect.fnUntraced(function* ({ gapMs = TABLE_GAP_MS }: { readonly gapMs?: number } = {}) {
  const reader = yield* Processes;
  const control = Option.getOrUndefined(yield* Effect.serviceOption(ProcessControl));
  const gapNanos = BigInt(gapMs) * 1_000_000n;
  const lastRef = yield* Ref.make<TableReading | undefined>(undefined);
  const permit = yield* Semaphore.make(1);
  const read = Effect.fnUntraced(function* (notBefore: bigint = 0n) {
    const now = yield* Clock.monotonicTimeNanos;
    const last = yield* Ref.get(lastRef);
    if (last !== undefined && last.atNanos >= notBefore && now - last.atNanos < gapNanos) return last;
    const reading = indexed(yield* reader.table, now);
    yield* Ref.set(lastRef, reading);
    return reading;
  }, permit.withPermits(1));

  return { reader, control, read } satisfies ProcessTables;
});

export type Member = {
  readonly pid: number;
  readonly birth: string;
  readonly parent: number;
  readonly work: number;
  readonly zombie: boolean;
  readonly facts: ProcessFacts | undefined;
  readonly unread: string | undefined;
  readonly lineage: ReadonlyArray<ProcessWitness>;
};

export const Descendant = Schema.Struct({
  pid: Schema.Int,
  birth: Schema.String,
  work: Schema.Int,
  lineage: Schema.Array(Schema.Struct({ pid: Schema.Int, birth: Schema.String })),
});
export type Descendant = typeof Descendant.Type;

type Leader =
  | { readonly _tag: 'Pending' }
  | { readonly _tag: 'Proven'; readonly birth: string }
  | { readonly _tag: 'Lost'; readonly reason: 'gone' | 'stranger' };

export type SetState = {
  readonly leader: Leader;
  readonly members: ReadonlyMap<number, Member>;
  readonly refreshed: ReadonlyMap<number, number>;
  readonly capped: boolean;
  readonly refused: number;
  readonly readings: number;
  readonly failures: number;
  readonly taken: boolean;
  readonly lastReading: bigint | undefined;
};

export type SetReading = {
  readonly leader: Leader['_tag'];
  readonly members: number;
  readonly capped: boolean;
  readonly readings: number;
  readonly failures: number;
  readonly watched: boolean;
};

export type RefreshStatus = 'read' | 'failed';

export type SetSweep = {
  readonly residual: ReadonlyArray<ResidualResource>;
  readonly unverifiable: ReadonlyArray<UnverifiableResource>;
  readonly measured: boolean;
  readonly unproven: ReadonlyArray<string>;
};

export type SetLadder = {
  readonly aim: LadderAim;
  readonly left: Effect.Effect<SetSweep>;
};

type Proof =
  | { readonly _tag: 'Standing'; readonly work: number }
  | { readonly _tag: 'Ended' }
  | { readonly _tag: 'Left' }
  | { readonly _tag: 'Unreadable'; readonly detail: string };

export const proofOf = (read: ProcessIdentity, witness: ProcessWitness): Proof =>
  read._tag === 'Gone'
    ? { _tag: 'Left' }
    : read._tag === 'Unreadable'
      ? { _tag: 'Unreadable', detail: read.detail }
      : !sameProcess(read, witness)
        ? { _tag: 'Left' }
        : read.zombie
          ? { _tag: 'Ended' }
          : { _tag: 'Standing', work: read.work };

export type SetGrowth = { readonly state: SetState; readonly joined: readonly number[]; readonly unread: ProcessesUnreadable | undefined };

export const grown = (
  state: SetState,
  table: TableReading,
  leader: ProcessWitness,
  compareBirth: BirthOrder,
  cap: number = SET_CAP,
): SetGrowth => {
  const { byPid, children } = table;
  const own = byPid.get(leader.pid);
  const standing =
    state.leader._tag !== 'Pending'
      ? state.leader
      : own === undefined
        ? ({ _tag: 'Lost', reason: 'gone' } as const)
        : sameProcess(leader, own)
          ? ({ _tag: 'Proven', birth: own.birth } as const)
          : ({ _tag: 'Lost', reason: 'stranger' } as const);
  const members = new Map<number, Member>();
  for (const member of state.members.values()) {
    const row = byPid.get(member.pid);
    if (row === undefined || !sameProcess(row, member)) continue;
    members.set(member.pid, { ...member, parent: row.parent, work: row.work, zombie: row.zombie });
  }
  const roots: Array<readonly [number, string, Member['lineage']]> = [];
  if (standing._tag === 'Proven' && own !== undefined && sameProcess(own, { pid: leader.pid, birth: standing.birth }))
    roots.push([own.pid, own.birth, []]);
  for (const member of members.values()) roots.push([member.pid, member.birth, member.lineage]);
  const joined: number[] = [];
  let refused = 0;
  for (let index = 0; index < roots.length; index += 1) {
    const [pid, birth, above] = roots[index]!;
    const lineage = [...above, { pid, birth }];
    for (const child of children.get(pid) ?? []) {
      if (members.has(child.pid)) continue;
      const order = compareBirth(child.birth, birth);
      if (typeof order !== 'number') return { state: { ...state, failures: state.failures + 1 }, joined: [], unread: order };
      if (order < 0) continue;
      if (members.size >= cap) {
        refused += 1;
        continue;
      }
      members.set(child.pid, {
        pid: child.pid,
        birth: child.birth,
        parent: child.parent,
        work: child.work,
        zombie: child.zombie,
        facts: undefined,
        unread: undefined,
        lineage,
      });
      joined.push(child.pid);
      roots.push([child.pid, child.birth, lineage]);
    }
  }
  return {
    state: {
      ...state,
      leader: standing,
      members,
      refreshed: new Map([...state.refreshed].filter(([pid]) => members.has(pid))),
      capped: state.capped || refused > 0,
      refused,
      readings: state.readings + 1,
      lastReading: table.atNanos,
    },
    joined,
    unread: undefined,
  };
};

export const withFacts = (state: SetState, reading: ProcessReading, atMs: number): SetState => {
  const members = new Map(state.members);
  const refreshed = new Map(state.refreshed);
  for (const facts of reading.processes) {
    const member = members.get(facts.pid);
    if (member === undefined) continue;
    if (!sameProcess(facts, member)) {
      members.delete(facts.pid);
      refreshed.delete(facts.pid);
      continue;
    }
    members.set(facts.pid, { ...member, parent: facts.parent, work: facts.work, facts, unread: undefined });
    refreshed.set(facts.pid, atMs);
  }
  for (const refused of reading.unread) {
    const pid = refused.pid;
    const member = members.get(pid);
    if (member === undefined) continue;
    if (refused._tag === 'Gone') {
      members.delete(pid);
      refreshed.delete(pid);
      continue;
    }
    members.set(pid, { ...member, unread: refused.detail });
    refreshed.set(pid, atMs);
  }
  return { ...state, members, refreshed };
};

export const namedOf = (pid: number, facts: ProcessFacts | undefined): string => {
  if (facts?.args._tag === 'Read' && facts.args.value.some((word) => word.length > 0)) return `pid ${pid} (${facts.args.value.join(' ')})`;
  if (facts?.executable._tag === 'Read') return `pid ${pid} (${facts.executable.value})`;
  return `pid ${pid}`;
};

type Status =
  | { readonly _tag: 'Standing'; readonly member: Member; readonly work: number }
  | { readonly _tag: 'Unreadable'; readonly member: Member; readonly detail: string };

type Look = {
  readonly standing: ReadonlyArray<Status>;
  readonly leader: boolean;
  readonly table: TableReading | undefined;
};
type LookFailure = { readonly failed: string; readonly look: Look };

export type ResidualState = 'standing' | 'gone' | 'unwitnessed' | 'unreadable';

const nanosToMs = (nanos: bigint): number => Number(nanos / 1_000_000n);

const unwitnessed: Effect.Effect<ResidualState> = Effect.succeed('unwitnessed');

export const residualStanding = (proven: ProvenSet | undefined, pid: number): Effect.Effect<ResidualState> =>
  proven === undefined ? unwitnessed : proven.standingOf(pid);

export type ProvenSet = {
  readonly leader: number;
  readonly work: number | undefined;
  readonly control: ProcessControl['Service'] | undefined;
  readonly reading: Effect.Effect<SetReading>;
  readonly members: Effect.Effect<ReadonlyArray<Member>>;
  readonly descendants: Effect.Effect<ReadonlyArray<Descendant>>;
  readonly inWork: (work: number) => Effect.Effect<ReadonlyArray<ProcessWitness>>;
  readonly taken: Effect.Effect<boolean>;
  readonly take: () => Effect.Effect<void>;
  readonly close: () => Effect.Effect<void>;
  readonly witness: (pid: number) => Effect.Effect<ProcessWitness | undefined>;
  readonly grow: (table: TableReading) => Effect.Effect<boolean>;
  readonly due: () => Effect.Effect<ReadonlyArray<readonly [number, number]>>;
  readonly refresh: (pids: ReadonlyArray<number>, atMs: number) => Effect.Effect<RefreshStatus>;
  readonly failed: () => Effect.Effect<void>;
  readonly standingOf: (pid: number) => Effect.Effect<ResidualState>;
  readonly residualAim: (
    pid: number,
    kill: (witness: ProcessWitness, step: StopStep) => Effect.Effect<boolean>,
  ) => Effect.Effect<LadderAim | undefined>;
  readonly ladder: (kill: (witness: ProcessWitness, step: StopStep) => Effect.Effect<boolean>) => SetLadder;
};

export const makeProvenSet = Effect.fnUntraced(function* ({
  tables,
  leader: leaderPid,
  birth: leaderBirth,
  work: workGroup,
  remembered = [],
}: {
  readonly tables: ProcessTables;
  readonly leader: number;
  readonly birth: string;
  readonly work: number | undefined;
  readonly remembered?: ReadonlyArray<Descendant>;
}) {
  const state = yield* Ref.make<SetState>({
    leader: { _tag: 'Pending' },
    members: new Map(
      remembered.map((member) => [
        member.pid,
        { ...member, parent: 0, zombie: false, facts: undefined, unread: undefined } satisfies Member,
      ]),
    ),
    refreshed: new Map(),
    capped: false,
    refused: 0,
    readings: 0,
    failures: 0,
    taken: false,
    lastReading: undefined,
  });
  const bornNanos = yield* Clock.monotonicTimeNanos;
  const permit = yield* Semaphore.make(1);

  function readReading(): Effect.Effect<SetReading> {
    return Effect.map(Ref.get(state), (held) => ({
      leader: held.leader._tag,
      members: held.members.size,
      capped: held.capped,
      readings: held.readings,
      failures: held.failures,
      watched: !held.taken,
    }));
  }

  function readMembers(): Effect.Effect<ReadonlyArray<Member>> {
    return Effect.map(Ref.get(state), (held) => [...held.members.values()]);
  }

  function readDescendants(): Effect.Effect<ReadonlyArray<Descendant>> {
    return Effect.map(Ref.get(state), (held) =>
      [...held.members.values()].map(({ pid, birth, work, lineage }) => ({ pid, birth, work, lineage })),
    );
  }

  const inWork = Effect.fnUntraced(function* (work: number) {
    const found: ProcessWitness[] = [];
    for (const member of yield* readMembers()) {
      const proof = yield* proofStep(member.pid, member.birth);
      if ((proof._tag === 'Standing' && proof.work === work) || (proof._tag === 'Unreadable' && member.work === work))
        found.push({ pid: member.pid, birth: member.birth });
    }
    return found;
  });

  function readTaken(): Effect.Effect<boolean> {
    return Effect.map(Ref.get(state), (held) => held.taken);
  }

  function take(): Effect.Effect<void> {
    return Ref.update(state, (held) => ({ ...held, taken: true }));
  }

  function close(): Effect.Effect<void> {
    return permit.withPermits(1)(Ref.update(state, (held) => ({ ...held, taken: true, members: new Map(), refreshed: new Map() })));
  }

  function witnessStep(pid: number): Effect.Effect<ProcessWitness | undefined> {
    return Effect.map(Ref.get(state), (held) => {
      const birth = pid === leaderPid && held.leader._tag === 'Proven' ? held.leader.birth : held.members.get(pid)?.birth;
      return birth === undefined ? undefined : { pid, birth };
    });
  }

  const grow = Effect.fnUntraced(function* (table: TableReading) {
    const held = yield* Ref.get(state);
    if (held.taken || table.atNanos < bornNanos) return false;
    if (held.lastReading === table.atNanos) return true;
    const growth = grown(held, table, { pid: leaderPid, birth: leaderBirth }, tables.reader.compareBirth);
    yield* Ref.set(state, growth.state);
    return growth.unread === undefined;
  }, permit.withPermits(1));

  function due(): Effect.Effect<ReadonlyArray<readonly [number, number]>> {
    return Effect.map(Ref.get(state), (held) =>
      [...held.members.values()].map(
        (member) =>
          [
            member.pid,
            member.facts === undefined && member.unread === undefined ? -Infinity : (held.refreshed.get(member.pid) ?? -Infinity),
          ] as const,
      ),
    );
  }

  const refresh = Effect.fnUntraced(function* (pids: ReadonlyArray<number>, atMs: number): Effect.fn.Return<RefreshStatus> {
    const held = yield* Ref.get(state);
    if (held.taken) return 'read';
    return yield* tables.reader.facts(pids).pipe(
      Effect.matchEffect({
        onFailure: () => Effect.as(Ref.set(state, { ...held, failures: held.failures + 1 }), 'failed' as const),
        onSuccess: (read) => Effect.as(Ref.set(state, withFacts(held, read, atMs)), 'read' as const),
      }),
    );
  }, permit.withPermits(1));

  function failed(): Effect.Effect<void> {
    return Ref.update(state, (held) => (held.taken ? held : { ...held, failures: held.failures + 1 }));
  }

  const standingOf = Effect.fnUntraced(function* (pid: number): Effect.fn.Return<ResidualState> {
    const witness = yield* witnessStep(pid);
    if (witness === undefined) return yield* unwitnessed;
    const proof = yield* proofStep(pid, witness.birth);
    return proof._tag === 'Standing' ? 'standing' : proof._tag === 'Unreadable' ? 'unreadable' : 'gone';
  });

  function residualAim(
    pid: number,
    kill: (witness: ProcessWitness, step: StopStep) => Effect.Effect<boolean>,
  ): Effect.Effect<LadderAim | undefined> {
    return Effect.map(witnessStep(pid), (witness) =>
      witness === undefined
        ? undefined
        : {
            send: (signal) =>
              Effect.flatMap(proofStep(pid, witness.birth), (proof) =>
                proof._tag === 'Standing' ? Effect.asVoid(kill(witness, signal)) : Effect.void,
              ),
            gone: Effect.map(proofStep(pid, witness.birth), (proof) => proof._tag === 'Left' || proof._tag === 'Ended'),
          },
    );
  }

  function proofStep(pid: number, birth: string): Effect.Effect<Proof> {
    return Effect.sync(() => proofOf(tables.reader.identity(pid), { pid, birth }));
  }

  const look = (notBefore: bigint): Effect.Effect<Look | LookFailure> =>
    tables.read(notBefore > bornNanos ? notBefore : bornNanos).pipe(
      Effect.matchEffect({
        onFailure: (failure) =>
          Effect.map(lookByWitness(), (look): LookFailure => ({
            failed: `the process table could not be read: ${failure.detail}`,
            look,
          })),
        onSuccess: Effect.fnUntraced(function* (table: TableReading) {
          const held = yield* Ref.get(state);
          let next = held;
          if (held.lastReading !== table.atNanos) {
            const growth = grown(held, table, { pid: leaderPid, birth: leaderBirth }, tables.reader.compareBirth);
            next = growth.state;
            if (growth.unread !== undefined) {
              yield* Ref.set(state, next);
              return { failed: growth.unread.detail, look: yield* lookByWitness() } satisfies LookFailure;
            }
            if (growth.joined.length > 0) {
              next = yield* tables.reader.facts(growth.joined).pipe(
                Effect.match({
                  onFailure: () => next,
                  onSuccess: (facts) => withFacts(next, facts, nanosToMs(table.atNanos)),
                }),
              );
            }
            yield* Ref.set(state, next);
          }
          const own = table.byPid.get(leaderPid);
          return {
            standing: [...next.members.values()]
              .filter((member) => !member.zombie)
              .map((member) => ({ _tag: 'Standing', member, work: member.work }) as const),
            leader:
              next.leader._tag === 'Proven' &&
              own !== undefined &&
              sameProcess(own, { pid: leaderPid, birth: next.leader.birth }) &&
              !own.zombie,
            table,
          } satisfies Look;
        }),
      }),
    );

  const lookByWitness = Effect.fnUntraced(function* (): Effect.fn.Return<Look> {
    const standing: Status[] = [];
    for (const member of yield* readMembers()) {
      const proof = yield* proofStep(member.pid, member.birth);
      if (proof._tag === 'Left') yield* forget(member.pid);
      else if (proof._tag === 'Standing') standing.push({ _tag: 'Standing', member, work: proof.work });
      else if (proof._tag === 'Unreadable') standing.push({ _tag: 'Unreadable', member, detail: proof.detail });
    }
    const held = yield* Ref.get(state);
    const leader = held.leader._tag === 'Proven' ? yield* proofStep(leaderPid, held.leader.birth) : undefined;
    return { standing, leader: leader !== undefined && (leader._tag === 'Standing' || leader._tag === 'Unreadable'), table: undefined };
  });

  function forget(pid: number): Effect.Effect<void> {
    return Ref.update(state, (held) => {
      const members = new Map(held.members);
      members.delete(pid);
      return { ...held, members };
    });
  }

  function outside(status: Status): boolean {
    return status._tag === 'Standing' && (workGroup === undefined || status.work !== workGroup);
  }

  function ladder(kill: (witness: ProcessWitness, step: StopStep) => Effect.Effect<boolean>): SetLadder {
    let blind: string | undefined;
    let chosen: ReadonlyArray<Member> | undefined;
    const reached = new Map<number, StopStep[]>();
    const looked = (notBefore: bigint) =>
      Effect.map(look(notBefore), (answered): Look => {
        if (!('failed' in answered)) return answered;
        blind ??= answered.failed;
        return answered.look;
      });
    const aim: LadderAim = {
      send: (signal) =>
        permit.withPermits(1)(
          Effect.gen(function* () {
            const targets = chosen ?? (yield* looked(0n)).standing.filter((status) => outside(status)).map((status) => status.member);
            chosen = undefined;
            for (const member of targets) {
              const proof = yield* proofStep(member.pid, member.birth);
              if (proof._tag === 'Left') {
                yield* forget(member.pid);
                continue;
              }
              if (proof._tag !== 'Standing') continue;
              yield* kill({ pid: member.pid, birth: member.birth }, signal);
              reached.set(member.pid, [...(reached.get(member.pid) ?? []), signal]);
            }
          }),
        ),
      gone: permit.withPermits(1)(
        Effect.gen(function* () {
          const seen = yield* looked(0n);
          chosen = seen.standing.filter((status) => outside(status)).map((status) => status.member);
          return seen.standing.length === 0 && !seen.leader;
        }),
      ),
    };
    const left: Effect.Effect<SetSweep> = Effect.suspend(() =>
      permit.withPermits(1)(
        Effect.gen(function* () {
          const seen = yield* looked(yield* Clock.monotonicTimeNanos);
          const residual: ResidualResource[] = [];
          const unverifiable: UnverifiableResource[] =
            blind === undefined
              ? []
              : [{ kind: 'process', detail: blind, reason: 'the processes this execution started could not all be read' }];
          const kept = new Map<number, Member>();
          for (const status of seen.standing) {
            const member = status.member;
            const named = namedOf(member.pid, member.facts);
            if (status._tag === 'Unreadable') {
              unverifiable.push({
                kind: 'process',
                detail: named,
                reason: `its birth witness could not be read (${status.detail}), so whether it still stands is unknown`,
              });
              continue;
            }
            kept.set(member.pid, { ...member, facts: undefined, lineage: [] });
            if (!outside(status)) continue;
            const signals = reached.get(member.pid) ?? [];
            residual.push({
              kind: 'process',
              detail: signals.length > 0 ? `${named} survived ${signals.join(' then ')}` : `${named} still stands; no step was aimed at it`,
              pid: member.pid,
              relation: 'ancestry',
            });
            kept.set(member.pid, { ...member, facts: undefined, lineage: [] });
          }
          const held = yield* Ref.get(state);
          if (held.capped) {
            unverifiable.push({
              kind: 'process',
              detail: `processes past the proven set's cap of ${SET_CAP}`,
              reason: 'the set stood full when they appeared, so they were never proven and never signalled',
            });
          }
          const unproven = workGroup === undefined ? [] : yield* unprovenInWork(workGroup, held);
          yield* Ref.set(state, { ...held, taken: true, members: kept, refreshed: new Map() });
          return {
            residual,
            unverifiable,
            measured: held.leader._tag === 'Proven' && unverifiable.length === 0,
            unproven,
          } satisfies SetSweep;
        }),
      ),
    );
    return { aim, left };
  }

  const unprovenInWork = (work: number, held: SetState): Effect.Effect<readonly string[]> =>
    tables.reader.members(work).pipe(
      Effect.matchEffect({
        onFailure: (failure) => Effect.succeed([`unreadable work ${work}: ${failure.detail}`]),
        onSuccess: (reading) => {
          const leader = held.leader._tag === 'Proven' ? { pid: leaderPid, birth: held.leader.birth } : undefined;
          const strangers = reading.filter((row) => {
            const member = held.members.get(row.pid);
            return (
              !row.zombie && (member === undefined || !sameProcess(row, member)) && (leader === undefined || !sameProcess(row, leader))
            );
          });
          if (strangers.length === 0) return Effect.succeed([]);
          return tables.reader.facts(strangers.map((row) => row.pid)).pipe(
            Effect.match({
              onFailure: () => strangers.map((row) => namedOf(row.pid, undefined)),
              onSuccess: (read) => {
                const facts = new Map(read.processes.map((row) => [row.pid, row]));
                return strangers.map((row) => {
                  const found = facts.get(row.pid);
                  return namedOf(row.pid, found !== undefined && sameProcess(found, row) ? found : undefined);
                });
              },
            }),
          );
        },
      }),
    );

  return {
    leader: leaderPid,
    work: workGroup,
    control: tables.control,
    get reading() {
      return readReading();
    },
    get members() {
      return readMembers();
    },
    get descendants() {
      return readDescendants();
    },
    inWork,
    get taken() {
      return readTaken();
    },
    take,
    close,
    witness: witnessStep,
    grow,
    due: due,
    refresh: refresh,
    failed: failed,
    standingOf,
    residualAim,
    ladder,
  } satisfies ProvenSet;
});
