import { Data, Clock, Effect, Semaphore, type Scope } from 'effect';
import type { ExecutionId, ExecutionRef } from '@runlith/executions/protocol/execution';
import type { Pace, PaceReport } from '@runlith/executions/protocol/pace';
import type { NativeExecution } from './nativeLaunch';
import { ProcessTempo, type TempoAsk } from './ProcessTempo';
import { sameProcess, type ProcessWitness } from '@runlith/executions/protocol/evidence';
import type { ProcessTables, ProvenSet, TableReading } from './ProvenSet';
import { ExecutionStore } from './store/ExecutionStore';

export class PaceNotRecorded extends Data.TaggedError('PaceNotRecorded')<{ readonly execution: string; readonly cause: string }> {
  override get message(): string {
    return `pace for execution ${this.execution} could not be recorded: ${this.cause}`;
  }
}

type Paced = {
  readonly ref: ExecutionRef;
  readonly initial: Pace;
  readonly leader: ProcessWitness;
  readonly set: ProvenSet;
  target: Pace;
  lowered: boolean;
  reached: Pace | undefined;
  walked: ReadonlySet<string>;
};

type Walked = { readonly reached: number; readonly failed: number };

export type PaceContinuation = { readonly initial: Pace; readonly target: Pace; readonly lowered: boolean };
export type PacingInput = { readonly tables: ProcessTables | undefined };
export type PaceChange = { readonly report: PaceReport; readonly moved: ReadonlyArray<ExecutionId> };

const RANK: Record<Pace, number> = { full: 2, low: 1, lowest: 0 };

export type Pacing = {
  readonly standing: Pace;
  readonly spawning: Pace;
  readonly paceOf: (execution: ExecutionId) => Pace | undefined;
  readonly hold: (
    ref: ExecutionRef,
    native: NativeExecution,
    resumed?: PaceContinuation,
  ) => Effect.Effect<void, PaceNotRecorded, Scope.Scope>;
  readonly change: (pace: Pace) => Effect.Effect<PaceChange>;
  readonly follow: Effect.Effect<void>;
};

export const makePacing = Effect.fnUntraced(function* ({ tables }: PacingInput) {
  const permit = yield* Semaphore.make(1);
  const tempo = yield* ProcessTempo;
  const store = yield* ExecutionStore;
  const held = new Map<ExecutionId, Paced>();
  let currentPace: Pace = 'full';
  const follow: Effect.Effect<void> = Effect.suspend(() =>
    permit.withPermits(1)(
      Effect.gen(function* () {
        yield* walkPaced(held.values(), true);
      }),
    ),
  );
  function readStanding(): Pace {
    return currentPace;
  }

  function readSpawning(): Pace {
    return tables === undefined ? 'full' : currentPace;
  }

  function paceOf(execution: ExecutionId): Pace | undefined {
    const entry = held.get(execution);
    return entry === undefined ? undefined : (entry.reached ?? entry.initial);
  }

  function supports(entry: Paced, pace: Pace): boolean {
    return entry.target === pace || tempo.directions(entry.initial).some(({ from, to }) => from === entry.target && to === pace);
  }

  function nearest(entry: Paced, pace: Pace): Pace {
    if (supports(entry, pace)) return pace;
    let best = entry.target;
    for (const { from, to } of tempo.directions(entry.initial)) {
      if (from === entry.target && Math.abs(RANK[to] - RANK[pace]) < Math.abs(RANK[best] - RANK[pace])) best = to;
    }
    return best;
  }

  function record(entry: Paced): Effect.Effect<void, PaceNotRecorded> {
    return store
      .recordPace({ execution: entry.ref, initial: entry.initial, target: entry.target, lowered: entry.lowered })
      .pipe(Effect.mapError((failure) => new PaceNotRecorded({ execution: entry.ref.execution, cause: failure._tag })));
  }

  function hold(ref: ExecutionRef, native: NativeExecution, resumed?: PaceContinuation): Effect.Effect<void, PaceNotRecorded, Scope.Scope> {
    const set = native.proven;
    if (set === undefined || tables === undefined) return Effect.void;
    const execution = ref.execution;
    const entry: Paced = {
      ref,
      initial: resumed?.initial ?? native.pace,
      leader: { pid: native.held.pid, birth: native.held.birth },
      set,
      target: resumed?.target ?? native.pace,
      lowered: resumed?.lowered ?? false,
      reached: undefined,
      walked: new Set(),
    };
    return Effect.asVoid(
      Effect.acquireRelease(
        permit.withPermits(1)(
          Effect.gen(function* () {
            if (resumed === undefined && supports(entry, currentPace)) entry.target = currentPace;
            entry.lowered ||= entry.initial === 'lowest' || entry.target === 'lowest';
            yield* record(entry);
            yield* walkPaced([entry]);
            held.set(execution, entry);
          }),
        ),
        () => permit.withPermits(1)(Effect.sync(() => void held.delete(execution))),
      ),
    );
  }

  function change(pace: Pace): Effect.Effect<PaceChange> {
    return permit.withPermits(1)(
      Effect.gen(function* () {
        if (tables === undefined) {
          return {
            report: { _tag: 'Unavailable', pace, reason: 'this host reads no process table, so it can move no running process' },
            moved: [],
          } satisfies PaceChange;
        }
        const entries: Paced[] = [];
        for (const entry of held.values()) if (!(yield* entry.set.taken)) entries.push(entry);
        return yield* tables.read(yield* Clock.monotonicTimeNanos).pipe(
          Effect.matchEffect({
            onFailure: (failure) =>
              Effect.succeed<PaceChange>({ report: { _tag: 'Unavailable', pace, reason: failure.detail }, moved: [] }),
            onSuccess: Effect.fnUntraced(function* (table: TableReading) {
              currentPace = pace;
              const was = new Map(entries.map((entry) => [entry, entry.reached ?? entry.initial] as const));
              const arriving: Paced[] = [];
              const nearer: Paced[] = [];
              const short: Paced[] = [];
              for (const entry of entries) {
                yield* entry.set.grow(table);
                const next = nearest(entry, pace);
                if (next === pace) arriving.push(entry);
                else short.push(entry);
                if (next !== pace && next !== entry.target) nearer.push(entry);
                entry.target = next;
                entry.lowered ||= next === 'lowest';
              }
              const walked = yield* walkPaced(arriving);
              let failed = walked.failed + (yield* walkPaced(nearer)).failed;
              for (const entry of [...arriving, ...nearer])
                failed += yield* record(entry).pipe(Effect.match({ onFailure: () => 1, onSuccess: () => 0 }));
              let kept = 0;
              for (const entry of short) {
                const leader = table.byPid.get(entry.leader.pid);
                const standing = leader !== undefined && sameProcess(leader, entry.leader) && !leader.zombie ? 1 : 0;
                kept += standing + (yield* entry.set.members).filter((member) => !member.zombie).length;
              }
              return {
                report: { _tag: 'Applied', pace, reached: walked.reached, kept, failed },
                moved: entries.filter((entry) => (entry.reached ?? entry.initial) !== was.get(entry)).map((entry) => entry.ref.execution),
              } satisfies PaceChange;
            }),
          }),
        );
      }),
    );
  }

  function walkPaced(entries: Iterable<Paced>, fresh = false): Effect.Effect<Walked> {
    return walk(tempo, entries, fresh);
  }

  return {
    get standing() {
      return readStanding();
    },
    get spawning() {
      return readSpawning();
    },
    paceOf: paceOf,
    hold: hold,
    change: change,
    follow,
  } satisfies Pacing;
});

const walk = Effect.fnUntraced(function* (tempo: ProcessTempo['Service'], entries: Iterable<Paced>, fresh: boolean) {
  const asks: TempoAsk[] = [];
  const owners: Paced[] = [];
  for (const entry of entries) {
    if (yield* entry.set.taken) continue;
    const kept = fresh && entry.target !== 'lowest';
    if (kept && !entry.lowered) continue;
    const walked = new Set<string>();
    const members = (yield* entry.set.members).filter((member) => !member.zombie);
    for (const witness of [entry.leader, ...members.map(({ pid, birth }): ProcessWitness => ({ pid, birth }))]) {
      const key = `${witness.pid}:${witness.birth}`;
      walked.add(key);
      if (kept && entry.walked.has(key)) continue;
      asks.push({ witness, initial: entry.initial, pace: entry.target });
      owners.push(entry);
    }
    entry.walked = walked;
  }
  if (asks.length === 0) return { reached: 0, failed: 0 } satisfies Walked;
  const kept = yield* tempo.apply(asks);
  let reached = 0;
  let failed = 0;
  kept.forEach((outcome, index) => {
    const owner = owners[index]!;
    if (outcome._tag === 'Held' || outcome._tag === 'Moved') {
      reached++;
      if (asks[index]!.witness === owner.leader) owner.reached = owner.target;
    } else if (outcome.reason !== 'gone' && outcome.reason !== 'changed') failed++;
  });
  return { reached, failed } satisfies Walked;
});
