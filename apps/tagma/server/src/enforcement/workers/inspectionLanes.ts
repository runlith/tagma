import { sliceable, type PackId } from '@tagma/inspection/builtins';
import type { Verdict } from '@tagma/inspection/verdict';
import type { Footprint } from '@tagma/inspection/node/reading';
import { rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { availableParallelism, totalmem } from 'node:os';
import { Cause, Context, Data, Effect, Exit, Layer, Option, type Tracer } from 'effect';
import { WorkerUnavailable, eventReason, workerGone } from '@runlith/utils/worker';
import type { InspectionFailure } from '../contract/wire/enforcement.js';
import type { ProgramFacts } from '@tagma/inspection/program';
import type {
  FactsAsk,
  HistoryAsk,
  HistoryPage,
  HistoryQuery,
  InspectionRequest,
  InspectionAnswer,
  JudgeLane,
  JudgeRequest,
  LostExit,
  PhaseEvent,
  Posted,
  ReachRequest,
  Spawned,
  StateAnswer,
  StateAsk,
  WorkerAsk,
  WorkerState,
} from './asks.js';
import { PhaseMirror } from './phases.js';
import { type Answered, slicedJudge, slicedReach } from './slicing.js';
import { Turns } from './turns.js';
import { makeTraffic } from './traffic.js';
import { FactCache } from '../contract/service/factCache.js';
import { InspectionCode } from '../contract/service/inspectionCode.js';

export class InspectionFailed extends Data.TaggedError('InspectionFailed')<{
  readonly cause: InspectionFailure;
  readonly reason: string;
  readonly ways?: readonly string[];
  readonly split?: true;
  readonly unprepared?: boolean;
  readonly worker?: WorkerUnavailable;
}> {}

export type Inspected = {
  readonly verdict: Verdict;
  readonly read: readonly string[];
  readonly ms: number;
  readonly footprint?: Footprint;
};

export class Inspections extends Context.Service<
  Inspections,
  {
    readonly code?: string;
    history<A, E, R>(
      query: HistoryQuery,
      use: (next: Effect.Effect<HistoryPage, InspectionFailed>) => Effect.Effect<A, E, R>,
    ): Effect.Effect<A, E | InspectionFailed, R>;
    reach(ask: Omit<ReachRequest, 'kind'>, priority?: 'foreground' | 'background'): Effect.Effect<Inspected, InspectionFailed>;
    judge(ask: Omit<JudgeRequest, 'kind'>): Effect.Effect<Inspected, InspectionFailed>;
    packs(ask: { readonly root: string; readonly commit: string }): Effect.Effect<readonly PackId[], InspectionFailed>;
    facts(
      ask: Omit<FactsAsk, 'kind'> & { readonly lane: JudgeLane },
    ): Effect.Effect<{ readonly facts: ProgramFacts; readonly hits: number }, InspectionFailed>;
  }
>()('tagma/enforcement/Inspections') {}

const failed = (cause: InspectionFailure, reason: string): InspectionFailed => new InspectionFailed({ cause, reason });

type Asking = (ask: WorkerAsk) => Effect.Effect<Answered, InspectionFailed>;

export const INSPECTION_IDLE_MS = 60_000;

const INSPECTION_LOOK_MS = 15_000;

const AFFINE_KEPT = 64;

export const RULES_AT_ONCE = 3;

export class WorkerStuck extends Data.TaggedError('WorkerStuck')<{ readonly reason: string }> {}

type LaneOptions = { readonly idleMs?: number; readonly lookMs?: number; readonly cacheRoot?: string };

type Waiting = {
  readonly id: number;
  readonly posted: Posted;
  readonly worker: Worker;
  readonly since: number;
  readonly phases: PhaseMirror | undefined;
  readonly settle: (reply: InspectionAnswer | WorkerUnavailable | WorkerStuck) => void;
  look: ReturnType<typeof setTimeout> | undefined;
  looks: number;
  heard: number;
  reposted: number;
  last: WorkerState | undefined;
  reported: number | undefined;
  busy: number | undefined;
};

type Watched = { readonly context: Context.Context<never>; readonly parent: Tracer.Span };

const builtinOf = (ask: WorkerAsk): string | undefined => ('inspection' in ask ? ask.inspection.builtin : undefined);

const askedOf = (ask: WorkerAsk): Record<string, string | number | undefined> => {
  const builtin = builtinOf(ask);
  return {
    'inspection.kind': ask.kind,
    'inspection.builtin': builtin,
    files: 'paths' in ask ? ask.paths?.length : undefined,
  };
};

const lost = (one: Spawned): boolean => one.running === true && (one.system === 'zombie' || one.system === 'gone');

const lostExits = (before: WorkerState, now: WorkerState): readonly Spawned[] => {
  if (before.moves !== now.moves) return [];
  const earlier = new Set(before.spawned.filter(lost).map((one) => one.pid));
  return now.spawned.filter((one) => lost(one) && earlier.has(one.pid));
};

const journalOf = (state: WorkerState): string => {
  const spawned = state.spawned.map(
    (one) =>
      `${one.command} (pid ${one.pid}, ${Math.round(one.ms / 1000)} s, ${typeof one.running === 'object' ? `exit unread: ${one.running.unread}` : one.running ? 'exit unseen' : 'exited'}${one.released ? ', released' : ''}${one.system === null ? '' : `, system: ${one.system}`})`,
  );
  const phases = state.phases.map((phase) => `${phase.name} (${Math.round(phase.ms / 1000)} s)`);
  const parts = [...phases, ...spawned];
  return `${parts.length === 0 ? 'nothing it waits on is recorded' : parts.join('; ')}${state.unread === undefined ? '' : `; system state unread: ${state.unread}`}`;
};

const warned = (message: string): void => {
  Effect.runFork(Effect.logWarning(message));
};

const seat = (entry: URL, name: string, options: LaneOptions) => {
  const lookMs = options.lookMs ?? INSPECTION_LOOK_MS;
  let thread: Worker | undefined;
  let waiting: Waiting | undefined;
  let nextId = 0;

  const stop = (worker: Worker) => {
    if (thread === worker) thread = undefined;
    worker.terminate();
  };

  const retire = Effect.fnUntraced(function* (wanted: () => boolean) {
    const worker = thread;
    if (worker === undefined || waiting !== undefined || wanted()) return;
    const ended = yield* Effect.exit(once({ kind: 'rest' }));
    if (Exit.isFailure(ended)) {
      const failure = Cause.findErrorOption(ended.cause);
      if (Option.isNone(failure) || !(failure.value instanceof WorkerUnavailable))
        yield* Effect.logWarning(`the ${name} could not keep its state before stopping`, { cause: ended.cause });
    } else if (!ended.value.answered) {
      yield* Effect.logWarning(`the ${name} could not keep its state before stopping`, { reason: ended.value.reason });
    }
    if (thread === worker && waiting === undefined && !wanted()) stop(worker);
  });

  const started = (): Worker => {
    if (thread !== undefined) return thread;
    const worker = new Worker(entry, { type: 'module' });
    const ended = (reason: string) => {
      if (thread !== worker) return;
      stop(worker);
      const gone = workerGone(name, reason);
      const held = waiting;
      waiting = undefined;
      held?.settle(gone);
    };
    worker.addEventListener('message', (event: MessageEvent<InspectionAnswer | StateAnswer | PhaseEvent | LostExit>) => {
      const held = waiting;
      const reply = event.data;
      if ('lost' in reply) {
        if (held !== undefined && held.worker === worker) stuckOn(held, reply.spawned, 'the system reaped it');
        else if (thread === worker) {
          warned(
            `the ${name} never saw the exit of ${reply.spawned.map((one) => `${one.command} (pid ${one.pid})`).join(', ')}, which the system reaped; it is stopped while idle`,
          );
          stop(worker);
        }
        return;
      }
      if (held === undefined || held.worker !== worker) return;
      if ('phase' in reply) {
        held.phases?.take(reply);
        return;
      }
      if ('state' in reply) {
        if (reply.about === held.id) probed(held, reply);
        return;
      }
      if (held.id === reply.id) answered(held, reply);
    });
    worker.addEventListener('error', (event: ErrorEvent) => ended(eventReason(event, 'the worker failed')));
    worker.addEventListener('messageerror', () => ended('an answer could not be read'));
    worker.addEventListener('close', () => ended('the worker closed'));
    worker.unref();
    thread = worker;
    return worker;
  };

  const answered = (held: Waiting, reply: InspectionAnswer) => {
    waiting = undefined;
    held.worker.unref();
    held.settle(reply);
  };

  const posting = (held: Waiting, message: Posted | StateAsk): boolean => {
    try {
      held.worker.postMessage(message);
      return true;
    } catch (error) {
      waiting = undefined;
      stop(held.worker);
      held.settle(workerGone(name, `it took no message: ${String(error)}`));
      return false;
    }
  };

  const askedSaid = (held: Waiting): string => {
    const builtin = builtinOf(held.posted);
    return `${held.posted.kind} ask ${held.id}${builtin === undefined ? '' : ` (${builtin})`}, unanswered for ${Math.round((Date.now() - held.since) / 1000)} s`;
  };

  const silent = (held: Waiting) => {
    if (held.looks - held.heard < 2) return;
    const phase = held.phases?.innermost();
    const key = phase?.id ?? 0;
    if (held.busy === key) return;
    held.busy = key;
    warned(
      phase === undefined
        ? `the ${name} does not answer about its state on its ${askedSaid(held)}, and no phase of its work is known`
        : `the ${name} has been in ${phase.name} for ${Math.round((Date.now() - phase.since) / 1000)} s on its ${askedSaid(held)} and does not answer about its state while it works`,
    );
  };

  const look = (held: Waiting) => {
    if (waiting !== held) return;
    silent(held);
    held.looks += 1;
    if (posting(held, { kind: 'state', about: held.id, look: held.looks })) held.look = setTimeout(() => look(held), lookMs);
  };

  const stuckOn = (held: Waiting, stuck: readonly Spawned[], said: string) => {
    waiting = undefined;
    stop(held.worker);
    held.settle(
      new WorkerStuck({
        reason: `the ${name} is stuck on its ${askedSaid(held)}: it never saw the exit of ${stuck.map((one) => `${one.command} (pid ${one.pid}, system: ${one.system})`).join(', ')}; ${said}`,
      }),
    );
  };

  const probed = (held: Waiting, reply: StateAnswer) => {
    const { state } = reply;
    held.heard = Math.max(held.heard, reply.look);
    const asked = askedSaid(held);
    if (state.answer !== undefined) {
      warned(`the ${name} answered its ${asked}, and the answer never arrived; it is taken from the worker's state`);
      answered(held, state.answer);
      return;
    }
    if (state.received !== held.id) {
      if (reply.look <= held.reposted) return;
      warned(`the ${name} never received its ${asked}; it is posted again`);
      held.reposted = held.looks;
      held.last = undefined;
      posting(held, held.posted);
      return;
    }
    const before = held.last;
    held.last = state;
    const stuck = before === undefined ? [] : lostExits(before, state);
    if (stuck.length > 0) {
      stuckOn(held, stuck, `it waits on ${journalOf(state)}`);
      return;
    }
    if (before !== undefined && before.moves === state.moves && held.reported !== state.moves) {
      held.reported = state.moves;
      warned(`the ${name} made no progress on its ${asked}: ${journalOf(state)}`);
    }
  };

  const once = (ask: WorkerAsk, watched?: Watched) =>
    Effect.callback<InspectionAnswer, WorkerUnavailable | WorkerStuck>((resume) => {
      let worker: Worker;
      try {
        worker = started();
      } catch (error) {
        resume(Effect.fail(workerGone(name, `it could not start: ${String(error)}`)));
        return;
      }
      const id = ++nextId;
      const posted: Posted = { ...ask, id, cacheRoot: options.cacheRoot };
      const held: Waiting = {
        id,
        posted,
        worker,
        since: Date.now(),
        phases: watched === undefined ? undefined : new PhaseMirror(watched.context, watched.parent, id),
        settle: (reply) => {
          clearTimeout(held.look);
          held.phases?.close();
          resume(reply instanceof WorkerUnavailable || reply instanceof WorkerStuck ? Effect.fail(reply) : Effect.succeed(reply));
        },
        look: undefined,
        looks: 0,
        heard: 0,
        reposted: 0,
        last: undefined,
        reported: undefined,
        busy: undefined,
      };
      waiting = held;
      worker.ref();
      if (!posting(held, posted)) return;
      held.look = setTimeout(() => look(held), lookMs);
      return Effect.sync(() => {
        clearTimeout(held.look);
        held.phases?.close();
        if (waiting !== held) return;
        waiting = undefined;
        stop(worker);
      });
    });

  const worked = (message: WorkerAsk) =>
    Effect.useSpan('inspection.worker', { attributes: { 'inspection.lane': name } }, (parent) =>
      Effect.flatMap(Effect.context<never>(), (context) => once(message, { context, parent })),
    );

  const answer = (message: WorkerAsk): Effect.Effect<Answered, InspectionFailed> =>
    worked(message).pipe(
      Effect.catchTag('WorkerStuck', (stuck) =>
        Effect.logWarning(`${stuck.reason}; the ask goes to a fresh worker`).pipe(Effect.andThen(worked(message))),
      ),
      Effect.mapError((failure) =>
        failure instanceof WorkerStuck
          ? new InspectionFailed({ cause: 'worker', reason: failure.reason })
          : new InspectionFailed({ cause: 'worker', reason: failure.message, worker: failure }),
      ),
      Effect.flatMap((reply) =>
        reply.answered
          ? Effect.succeed(reply)
          : Effect.fail(new InspectionFailed({ cause: reply.cause, reason: reply.reason, split: reply.split })),
      ),
    );

  return {
    name,
    answer,
    retire,
    close: () => {
      if (thread !== undefined) stop(thread);
      const held = waiting;
      waiting = undefined;
      held?.settle(new WorkerUnavailable(name, 'the inspection lane closed'));
    },
  };
};

type Seat = ReturnType<typeof seat>;

type Aim = { readonly seat: number } | { readonly warm?: string };

export type Pool = {
  readonly answer: (message: WorkerAsk, aim?: Aim) => Effect.Effect<Answered, InspectionFailed>;
  readonly ask: (message: InspectionRequest, aim?: Aim) => Effect.Effect<Inspected, InspectionFailed>;
  readonly job: <A, E, R>(warm: string | undefined, use: (answer: Asking) => Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
  readonly close: () => void;
};

export const pool = (entry: URL, names: readonly string[], options: LaneOptions = {}): Pool => {
  const idleMs = options.idleMs ?? INSPECTION_IDLE_MS;
  const seats: readonly Seat[] = names.map((name) => seat(entry, name, options));
  const turns = new Turns(seats.length);
  const idle = seats.map((): ReturnType<typeof setTimeout> | undefined => undefined);
  const affine = new Map<string, number>();

  const remember = (warm: string | undefined, at: number) => {
    if (warm === undefined) return;
    affine.delete(warm);
    affine.set(warm, at);
    if (affine.size > AFFINE_KEPT) affine.delete(affine.keys().next().value as string);
  };

  const woken = (at: number) => {
    clearTimeout(idle[at]);
    idle[at] = undefined;
  };

  const rested = (at: number) => {
    woken(at);
    const timer = setTimeout(() => {
      idle[at] = undefined;
      Effect.runFork(turns.within({ seat: at }, () => seats[at]!.retire(() => turns.wanted(at))));
    }, idleMs);
    timer.unref();
    idle[at] = timer;
  };

  const answer = (message: WorkerAsk, aim: Aim = {}): Effect.Effect<Answered, InspectionFailed> =>
    Effect.suspend(() => {
      const asked = performance.now();
      const warm = 'warm' in aim ? aim.warm : undefined;
      const want = 'seat' in aim ? aim : { prefer: warm === undefined ? undefined : affine.get(warm) };
      return turns
        .within(want, (at) =>
          Effect.gen(function* () {
            woken(at);
            remember(warm, at);
            yield* Effect.annotateCurrentSpan('inspection.lane', seats[at]!.name);
            yield* Effect.annotateCurrentSpan('queue.ms', Math.round(performance.now() - asked));
            return yield* seats[at]!.answer(message);
          }).pipe(Effect.ensuring(Effect.sync(() => rested(at)))),
        )
        .pipe(Effect.withSpan('inspection.ask', { attributes: askedOf(message) }));
    });

  return {
    answer,
    ask: (message, aim) => answer(message, aim).pipe(Effect.flatMap(inspected)),
    job: (warm, use) =>
      Effect.suspend(() => {
        const at = turns.least(warm === undefined ? undefined : affine.get(warm));
        remember(warm, at);
        const release = turns.hold(at);
        return use((message) => answer(message, { seat: at })).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              release();
              rested(at);
            }),
          ),
        );
      }),
    close: () => {
      for (const at of seats.keys()) woken(at);
      for (const one of seats) one.close();
    },
  };
};

const inspected = (reply: Answered): Effect.Effect<Inspected, InspectionFailed> =>
  'verdict' in reply
    ? Effect.succeed({ verdict: reply.verdict, read: reply.read, ms: reply.ms, footprint: reply.footprint })
    : Effect.fail(new InspectionFailed({ cause: 'worker', reason: 'the inspection worker answered a verdict ask with a slice or a plan' }));

export type InspectionEntries = { readonly judging?: URL; readonly reach?: URL; readonly code?: string } & LaneOptions;

export const inspections = (options: InspectionEntries = {}): Inspections['Service'] & { readonly close: () => void } => {
  const judging = options.judging ?? new URL('./judge.worker.ts', import.meta.url);
  const idle: LaneOptions = {
    idleMs: options.idleMs,
    lookMs: options.lookMs,
    cacheRoot: options.cacheRoot,
  };
  const parallel = availableParallelism() >= 4 && totalmem() >= 8 * 1024 * 1024 * 1024 ? 2 : 1;
  const numbered = (kind: string) => Array.from({ length: parallel }, (_, at) => `${kind} inspection worker ${at + 1}`);
  const landings = pool(judging, numbered('landing'), idle);
  const merge = pool(judging, ['merge inspection worker'], idle);
  const reaches = pool(options.reach ?? new URL('./reach.worker.ts', import.meta.url), numbered('reach'), idle);
  const traffic = makeTraffic();
  return {
    code: options.code,
    history: (query, use) =>
      reaches.job(undefined, (answer) => {
        const job = randomUUID();
        const read = (ask: HistoryAsk) =>
          traffic
            .idle(answer(ask))
            .pipe(
              Effect.flatMap((reply) =>
                'history' in reply
                  ? Effect.succeed(reply.history)
                  : Effect.fail(failed('worker', 'the inspection worker answered a history ask without history')),
              ),
            );
        return Effect.acquireUseRelease(
          read({ kind: 'history', phase: 'start', job, query }),
          (first) => {
            let queued: HistoryPage | undefined = first;
            return use(
              Effect.suspend(() => {
                const page = queued;
                queued = undefined;
                return page === undefined ? read({ kind: 'history', phase: 'next', job }) : Effect.succeed(page);
              }),
            );
          },
          () => read({ kind: 'history', phase: 'close', job }),
        );
      }),
    reach: (ask, priority = 'foreground') => {
      if (priority === 'background')
        return sliceable(ask.inspection)
          ? reaches.job(undefined, (answer) => slicedReach((message) => traffic.idle(answer(message)), ask, failed))
          : traffic.idle(reaches.ask({ ...ask, kind: 'reach' }));
      return traffic.run(
        sliceable(ask.inspection)
          ? reaches.job(undefined, (answer) => slicedReach(answer, ask, failed))
          : reaches.ask({ ...ask, kind: 'reach' }),
      );
    },
    judge: (ask) => {
      const on = ask.lane === 'merge' ? merge : landings;
      const warm = JSON.stringify(ask.inspection);
      return traffic.run(
        sliceable(ask.inspection)
          ? on.job(warm, (answer) => slicedJudge(answer, ask, failed))
          : on.ask({ ...ask, kind: 'judge' }, { warm }),
      );
    },
    packs: (ask) =>
      traffic.run(
        reaches
          .answer({ ...ask, kind: 'packs' })
          .pipe(
            Effect.flatMap((reply) =>
              'packs' in reply
                ? Effect.succeed(reply.packs)
                : Effect.fail(failed('worker', 'the inspection worker answered a pack-use ask without packs')),
            ),
          ),
      ),
    facts: ({ lane: on, ...ask }) =>
      traffic.run(
        (on === 'merge' ? merge : landings)
          .answer({ ...ask, kind: 'facts' })
          .pipe(
            Effect.flatMap((reply) =>
              'facts' in reply
                ? Effect.succeed({ facts: reply.facts, hits: reply.hits })
                : Effect.fail(failed('worker', 'the inspection worker answered a facts ask without facts')),
            ),
          ),
      ),
    close: () => {
      for (const one of [landings, merge, reaches]) one.close();
    },
  };
};

export const inspectionsLayer: Layer.Layer<Inspections, never, FactCache> = Layer.effect(
  Inspections,
  Effect.gen(function* () {
    const { root } = yield* FactCache;
    const code = yield* InspectionCode;
    const held = yield* Effect.acquireRelease(
      Effect.sync(() => {
        if (root !== undefined) rmSync(root, { recursive: true, force: true });
        return inspections({ cacheRoot: root, code: code ?? undefined });
      }),
      (held) => Effect.sync(held.close),
    );
    const { reach, judge, packs, facts, history } = held;
    return Inspections.of({ reach, judge, packs, facts, history, code: code ?? undefined });
  }),
);
