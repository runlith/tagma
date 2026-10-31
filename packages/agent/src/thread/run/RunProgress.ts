import { Clock, Context, Effect, FiberMap, Layer } from 'effect';
import type { AgentPhase, AgentWaiting } from '../../agent/AgentPhase';
import type { ThreadContextEstimate, ThreadLiveProgress } from '../../transcript/live';
import type { ThreadPortFailure } from '../ThreadBorder';
import { ThreadFeed, ThreadOwner, ThreadRunStoreFactory, ThreadStreamRhythm, type ThreadWriteTx } from '../ThreadPorts';
import type { ThreadRunRef } from './ThreadRunLedger';

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

export const runProgressLayer: Layer.Layer<RunProgress, never, ThreadFeed | ThreadStreamRhythm | ThreadRunStoreFactory | ThreadOwner> =
  Layer.effect(
    RunProgress,
    Effect.gen(function* () {
      const feed = yield* ThreadFeed;
      const rhythm = yield* ThreadStreamRhythm;
      const runs = (yield* ThreadRunStoreFactory).create((yield* ThreadOwner).id);
      const held = new Map<string, Held>();
      const ticks = yield* FiberMap.make<string, void, ThreadPortFailure>();
      const heldOf = (runId: string): Held => {
        const standing = held.get(runId);
        if (standing !== undefined) return standing;
        const fresh: Held = { shown: { phase: null, estimate: null }, unwritten: false };
        held.set(runId, fresh);
        return fresh;
      };
      const pending = (runId: string): boolean => held.get(runId)?.unwritten === true;
      const durable = Effect.fn('RunProgress.durable')(function* (runId: string) {
        const standing = held.get(runId);
        if (standing === undefined || !standing.unwritten) return;
        const phase = standing.shown.phase;
        yield* runs.writePhase(runId, phase);
        if (standing.shown.phase === phase) standing.unwritten = false;
      });
      const tick = (runId: string): Effect.Effect<void> =>
        Effect.asVoid(
          FiberMap.run(
            ticks,
            runId,
            Effect.andThen(Effect.sleep(rhythm.flushIntervalMs), durable(runId)).pipe(
              Effect.repeat({ while: () => pending(runId) }),
              Effect.tapError((failure) => Effect.logWarning('the phase of a run was not written', { runId, failure })),
            ),
            { onlyIfMissing: true },
          ),
        );
      const shown = (run: ThreadRunRef, standing: Held, next: ThreadLiveProgress): void => {
        standing.shown = next;
        feed.progress(run.threadId, run.id, next);
      };
      return RunProgress.of({
        enter: (run, phase, entry = {}) =>
          Effect.flatMap(Clock.currentTimeMillis, (now) =>
            Effect.suspend(() => {
              const standing = heldOf(run.id);
              const next = entered(standing.shown.phase, phase, entry, now);
              if (samePhase(standing.shown.phase, next)) return Effect.void;
              shown(run, standing, { phase: next, estimate: standing.shown.estimate });
              standing.unwritten = true;
              return tick(run.id);
            }),
          ),
        estimate: (run, estimate) =>
          Effect.sync(() => {
            const standing = heldOf(run.id);
            shown(run, standing, { phase: standing.shown.phase, estimate });
          }),
        written: (run, tx) =>
          Effect.suspend(() => {
            const standing = held.get(run.id);
            if (standing === undefined || !standing.unwritten) return Effect.void;
            const phase = standing.shown.phase;
            return Effect.andThen(
              runs.writePhase(run.id, phase, tx),
              tx.afterCommit(
                Effect.sync(() => {
                  if (standing.shown.phase === phase) standing.unwritten = false;
                }),
              ),
            );
          }),
        end: (runId) =>
          Effect.suspend(() => {
            held.delete(runId);
            return FiberMap.remove(ticks, runId);
          }),
      });
    }),
  );
