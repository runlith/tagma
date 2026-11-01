import { Clock, Context, Effect, FiberMap, Layer, References, Tracer } from 'effect';
import { CurrentCost } from '@runlith/performance/CostLedger';
import type { AgentPhase, AgentWaiting } from '../../agent/AgentPhase';
import type { ThreadContextEstimate, ThreadLiveProgress } from '../../transcript/live';
import type { ThreadPortFailure } from '../ThreadBorder';
import {
  ThreadFeed,
  ThreadOwner,
  ThreadRunStoreFactory,
  ThreadStore,
  ThreadStreamRhythm,
  ThreadTransitions,
  type ThreadWriteTx,
} from '../ThreadPorts';
import type { ThreadRunRef } from './ThreadRunLedger';
import { changeUnit, ThreadChanges } from './ThreadChanges';
import { ThreadJournalLane } from '../transition/lane';
import { ThreadStorageFailed } from '../persisted';

export type PhaseEntry = {
  readonly waiting?: AgentWaiting;
  readonly since?: number;
};

export class RunProgress extends Context.Service<
  RunProgress,
  {
    enter(run: ThreadRunRef, phase: AgentPhase['phase'] | null, entry?: PhaseEntry): Effect.Effect<void>;
    estimate(run: ThreadRunRef, estimate: ThreadContextEstimate): Effect.Effect<void>;
    written(run: ThreadRunRef, tx: ThreadWriteTx): Effect.Effect<void, ThreadPortFailure>;
    end(runId: string): Effect.Effect<void>;
  }
>()('@runlith/agent/RunProgress') {}

type Held = {
  readonly run: ThreadRunRef;
  shown: ThreadLiveProgress;
  unwritten: boolean;
};

const THINKING: ReadonlySet<AgentPhase['phase']> = new Set(['preparing', 'calling', 'reasoning']);

const spellOf = (phase: AgentPhase['phase']): string => (THINKING.has(phase) ? 'thinking' : phase);

const sameWaiting = (held: AgentWaiting | undefined, next: AgentWaiting | undefined): boolean =>
  held?.reason === next?.reason && held?.place === next?.place;

const entered = (held: AgentPhase | null, phase: AgentPhase['phase'] | null, entry: PhaseEntry, now: number): AgentPhase | null => {
  if (phase === null) return null;
  const kept = held !== null && spellOf(held.phase) === spellOf(phase) && sameWaiting(held.waiting, entry.waiting);
  const since = entry.since ?? (kept ? held.since : now);
  return entry.waiting === undefined ? { phase, since } : { phase, since, waiting: entry.waiting };
};

const samePhase = (held: AgentPhase | null, next: AgentPhase | null): boolean =>
  held === next ||
  (held !== null && next !== null && held.phase === next.phase && held.since === next.since && sameWaiting(held.waiting, next.waiting));

export const runProgressLayer: Layer.Layer<
  RunProgress,
  never,
  ThreadFeed | ThreadStreamRhythm | ThreadRunStoreFactory | ThreadOwner | ThreadChanges | ThreadStore | ThreadTransitions
> = Layer.effect(
  RunProgress,
  Effect.gen(function* () {
    const feed = yield* ThreadFeed;
    const changes = yield* ThreadChanges;
    const store = yield* ThreadStore;
    const transitions = yield* ThreadTransitions;
    const journal = yield* ThreadJournalLane;
    const rhythm = yield* ThreadStreamRhythm;
    const runs = (yield* ThreadRunStoreFactory).create((yield* ThreadOwner).id);
    const held = new Map<string, Held>();
    const ticks = yield* FiberMap.make<string, void, ThreadPortFailure>();
    const lifetime = Context.omit(Tracer.ParentSpan, References.CurrentStackFrame)(yield* Effect.context<never>());
    const heldOf = (run: ThreadRunRef): Held => {
      const standing = held.get(run.id);
      if (standing !== undefined) return standing;
      const fresh: Held = { run: { id: run.id, threadId: run.threadId }, shown: { phase: null, estimate: null }, unwritten: false };
      held.set(run.id, fresh);
      return fresh;
    };
    const pending = (runId: string): boolean => held.get(runId)?.unwritten === true;
    const written = Effect.fnUntraced(function* (run: ThreadRunRef, unit: ThreadWriteTx) {
      const standing = held.get(run.id);
      if (standing === undefined || !standing.unwritten) return;
      const phase = standing.shown.phase;
      const changed = yield* runs.writePhase(run.id, phase, unit);
      yield* unit.afterCommit(
        Effect.sync(() => {
          for (const { threadId, ...patch } of changed) changes.note(threadId, unit, { kind: 'run', run: patch });
          if (standing.shown.phase === phase) standing.unwritten = false;
        }),
      );
    });
    const durable = Effect.fn('RunProgress.durable')(function* (runId: string) {
      const standing = held.get(runId);
      if (standing === undefined || !standing.unwritten) return;
      const admitted = yield* journal.enter(
        standing.run.threadId,
        journal.place(),
        Effect.suspend(() =>
          pending(runId)
            ? changeUnit({ store, transitions, changes }, [standing.run.threadId], `phase:${runId}`, (unit) => written(standing.run, unit))
            : Effect.void,
        ),
      );
      if ('ran' in admitted) return;
      return yield* new ThreadStorageFailed({
        call: 'phase-order',
        cause: new Error(
          admitted.stalled === 'none'
            ? 'The journal lane did not start the phase flush.'
            : 'The journal lane cut the phase flush; whether it committed is unknown.',
        ),
      });
    });
    const tick = Effect.fnUntraced(function* (runId: string) {
      const started = FiberMap.run(
        ticks,
        runId,
        Effect.andThen(Effect.sleep(rhythm.flushIntervalMs), durable(runId)).pipe(
          Effect.repeat({ while: () => pending(runId) }),
          Effect.tapError((failure) => Effect.logWarning('the phase of a run could not be confirmed', { runId, failure })),
        ),
        { onlyIfMissing: true },
      );
      yield* Effect.updateContext(started, (context: Context.Context<never>) =>
        Context.add(lifetime, CurrentCost, Context.get(context, CurrentCost)),
      );
    });
    const shown = (run: ThreadRunRef, standing: Held, next: ThreadLiveProgress): void => {
      standing.shown = next;
      feed.progress(run.threadId, run.id, next);
    };
    return RunProgress.of({
      enter: (run, phase, entry = {}) =>
        Effect.flatMap(Clock.currentTimeMillis, (now) =>
          Effect.suspend(() => {
            const standing = heldOf(run);
            const next = entered(standing.shown.phase, phase, entry, now);
            if (samePhase(standing.shown.phase, next)) return Effect.void;
            shown(run, standing, { phase: next, estimate: standing.shown.estimate });
            standing.unwritten = true;
            return tick(run.id);
          }),
        ),
      estimate: (run, estimate) =>
        Effect.sync(() => {
          const standing = heldOf(run);
          shown(run, standing, { phase: standing.shown.phase, estimate });
        }),
      written,
      end: (runId) =>
        Effect.suspend(() => {
          held.delete(runId);
          return FiberMap.remove(ticks, runId);
        }),
    });
  }),
);
