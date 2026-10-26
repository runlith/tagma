import { Clock, Context, Effect, Layer } from 'effect';
import type { Usage } from '@runlith/llm/schema/events';
import type { ThreadRunStage } from '../rows';
import type { ThreadTranscript } from '../../transcript/rows';
import type { ThreadRunCharge, ThreadRunStorage } from '../storage/runs';
import type { ThreadPortFailure } from '../ThreadBorder';
import { type ThreadTx, ThreadBudget, ThreadOwner, ThreadRunStoreFactory, ThreadStore } from '../ThreadPorts';

export class ThreadRunAccounting extends Context.Service<
  ThreadRunAccounting,
  {
    progress(runId: string, progress: ThreadRunStage): Effect.Effect<void, ThreadPortFailure>;
    progressIn(runId: string, progress: ThreadRunStage, tx: ThreadTx, durable?: boolean): Effect.Effect<void, ThreadPortFailure>;
    usage(runId: string, usage: Usage | null): Effect.Effect<void, ThreadPortFailure>;
    usageIn(runId: string, usage: Usage | null, tx: ThreadTx): Effect.Effect<void, ThreadPortFailure>;
    chargeIn(runId: string, charge: ThreadRunCharge, tx: ThreadTx): Effect.Effect<void, ThreadPortFailure>;
    streamTailIn(runId: string, tail: ThreadTranscript | null, tx: ThreadTx): Effect.Effect<void, ThreadPortFailure>;
    spentBySpawnRoot(spawnRootId: string, ownerId: string): Effect.Effect<number, ThreadPortFailure>;
  }
>()('@runlith/agent/ThreadRunAccounting') {}

export const threadRunAccountingLayer: Layer.Layer<ThreadRunAccounting, never, ThreadOwner | ThreadRunStoreFactory> = Layer.effect(
  ThreadRunAccounting,
  Effect.gen(function* () {
    const runs: ThreadRunStorage<ThreadTx> = (yield* ThreadRunStoreFactory).create((yield* ThreadOwner).id);
    return ThreadRunAccounting.of({
      progress: (runId, progress) => Effect.flatMap(Clock.currentTimeMillis, (now) => runs.writeProgress(runId, progress, new Date(now))),
      progressIn: (runId, progress, tx, durable) =>
        Effect.flatMap(Clock.currentTimeMillis, (now) => runs.writeProgress(runId, progress, new Date(now), tx, durable)),
      usage: (runId, usage) =>
        usage ? Effect.flatMap(Clock.currentTimeMillis, (now) => runs.addUsage(runId, usage, new Date(now))) : Effect.void,
      usageIn: (runId, usage, tx) =>
        usage ? Effect.flatMap(Clock.currentTimeMillis, (now) => runs.addUsage(runId, usage, new Date(now), tx)) : Effect.void,
      chargeIn: (runId, charge, tx) => (charge.usage === null && charge.cost === null ? Effect.void : runs.charge(runId, charge, tx)),
      streamTailIn: (runId, tail, tx) =>
        Effect.flatMap(Clock.currentTimeMillis, (now) => runs.writeStreamTail(runId, tail, new Date(now), tx)),
      spentBySpawnRoot: (spawnRootId, ownerId) => runs.spentBySpawnRoot(spawnRootId, ownerId),
    });
  }),
);

export const accountedThreadBudgetLayer: Layer.Layer<ThreadBudget, never, ThreadRunAccounting | ThreadStore> = Layer.effect(
  ThreadBudget,
  Effect.gen(function* () {
    const accounting = yield* ThreadRunAccounting;
    const store = yield* ThreadStore;

    return ThreadBudget.of({
      of: Effect.fnUntraced(function* (query) {
        const root = query.root ?? (yield* store.metadata(query.spawnRootId));
        const allowed = root?.budgetTokens ?? null;
        if (allowed === null) return { allowed, spent: 0, remaining: null, unmeasuredCount: 0, unmeasuredSample: [] };
        const spent = yield* accounting.spentBySpawnRoot(query.spawnRootId, query.principal);
        return { allowed, spent, remaining: Math.max(0, allowed - spent), unmeasuredCount: 0, unmeasuredSample: [] };
      }),
    });
  }),
);
