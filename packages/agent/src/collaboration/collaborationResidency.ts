import { Context, Effect, Layer } from 'effect';
import type { ThreadMetadataRow } from '../thread/rows';
import { ThreadCallBroke } from '../thread/ThreadBorder';
import { ThreadResidency } from '../thread/ThreadPorts';
import { DeclaredCollaboration } from './CollaborationConfig';

export class SpawnSeats extends Context.Service<
  SpawnSeats,
  {
    resident(): number;
    seat(threadId: string): void;
    unseat(threadId: string): void;
    admit(thread: ThreadMetadataRow): Effect.Effect<void, ThreadCallBroke>;
    bind(threadId: string, runId: string): void;
    ended(runId: string): void;
  }
>()('@runlith/agent/SpawnSeats') {}

export const spawnSeatsLayer: Layer.Layer<SpawnSeats, never, DeclaredCollaboration> = Layer.effect(
  SpawnSeats,
  Effect.map(DeclaredCollaboration, (collaboration) => {
    const pending = new Set<string>();
    const live = new Map<string, Set<string>>();
    const threadOf = new Map<string, string>();
    const seated = (threadId: string) => pending.has(threadId) || live.has(threadId);
    const resident = () => new Set([...pending, ...live.keys()]).size;
    const seat = (threadId: string) => {
      pending.add(threadId);
    };
    return SpawnSeats.of({
      resident,
      seat,
      unseat: (threadId) => {
        pending.delete(threadId);
      },
      admit: (thread) =>
        Effect.suspend(() => {
          if (!thread.parentThreadId) return Effect.void;
          const slots = collaboration?.spawnSlots;
          if (slots !== undefined && !seated(thread.id) && resident() >= slots) {
            return new ThreadCallBroke({
              cause: new Error(`This host runs ${slots} spawned agents at once and all ${slots} are working.`),
            });
          }
          seat(thread.id);
          return Effect.void;
        }),
      bind: (threadId, runId) => {
        if (!seated(threadId)) return;
        pending.delete(threadId);
        const runs = live.get(threadId) ?? new Set<string>();
        runs.add(runId);
        live.set(threadId, runs);
        threadOf.set(runId, threadId);
      },
      ended: (runId) => {
        const threadId = threadOf.get(runId);
        if (threadId === undefined) return;
        threadOf.delete(runId);
        const runs = live.get(threadId);
        runs?.delete(runId);
        if (runs !== undefined && runs.size === 0) live.delete(threadId);
      },
    });
  }),
);

export const collaborationResidencyLayer: Layer.Layer<ThreadResidency, never, SpawnSeats> = Layer.effect(
  ThreadResidency,
  Effect.map(SpawnSeats, (seats) => ({
    admit: (thread) => seats.admit(thread),
    release: (threadId) => Effect.sync(() => seats.unseat(threadId)),
    bind: (threadId, runId) => Effect.sync(() => seats.bind(threadId, runId)),
    ended: (runId) => Effect.sync(() => seats.ended(runId)),
  })),
);
