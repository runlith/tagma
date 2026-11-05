import { Context, Effect, Layer } from 'effect';
import type { ThreadRunStoppedBy } from '../ending';
import { mergedStopRequest, type ThreadRunStopRequest } from '../storage/settlement';
import type { ThreadRunStopIntent } from '../storage/runs';
import type { ThreadPortFailure } from '../ThreadBorder';
import { ThreadStore } from '../ThreadPorts';
import type { InterruptReceipt, Transport } from '../transport/contract';
import { Transports } from '../transport/Transports';
import type { ThreadRunRef } from './ThreadRunLedger';

export class RunControl extends Context.Service<
  RunControl,
  {
    drive(run: ThreadRunRef): void;
    launching(run: ThreadRunRef): () => void;
    holds(runId: string): boolean;
    holder(runId: string): Transport | undefined;
    driven(): readonly ThreadRunRef[];
    held(): readonly ThreadRunRef[];
    interrupt(run: ThreadRunRef, by: ThreadRunStoppedBy | null): Effect.Effect<InterruptReceipt, ThreadPortFailure>;
    intend(runId: string, intent: ThreadRunStopIntent, at: Date): void;
    intent(runId: string): ThreadRunStopRequest | undefined;
    launchable(runId: string): boolean;
    ended(runId: string): void;
    size(): number;
    onChange(hook: (count: number) => void): void;
  }
>()('@runlith/agent/RunControl') {}

export const runControlLayer: Layer.Layer<RunControl, never, Transports | ThreadStore> = Layer.effect(
  RunControl,
  Effect.gen(function* () {
    const transports = yield* Transports;
    const store = yield* ThreadStore;
    const going = new Map<string, string>();
    const launching = new Set<string>();
    const intents = new Map<string, ThreadRunStopRequest>();
    const hooks: ((count: number) => void)[] = [];
    const changed = () => {
      for (const hook of hooks) hook(going.size);
    };
    const leave = (runId: string) => {
      if (going.delete(runId)) changed();
    };
    const drive = (run: ThreadRunRef) => {
      if (going.has(run.id)) return;
      going.set(run.id, run.threadId);
      changed();
    };
    const holder = (runId: string): Transport | undefined => transports.all().find((transport) => transport.runs.holds([runId]).length > 0);
    const holds = (runId: string): boolean => launching.has(runId) || holder(runId) !== undefined;
    return RunControl.of({
      drive,
      launching: (run) => {
        launching.add(run.id);
        drive(run);
        return () => {
          launching.delete(run.id);
          if (!holds(run.id)) leave(run.id);
        };
      },
      holds,
      holder,
      driven: () => [...going].map(([id, threadId]) => ({ id, threadId })),
      held: () => {
        for (const runId of [...going.keys()]) if (!holds(runId)) leave(runId);
        return [...going].map(([id, threadId]) => ({ id, threadId }));
      },
      interrupt: (run, by) =>
        Effect.suspend(() => {
          const held = holder(run.id);
          if (held !== undefined) return held.runs.interrupt(run.id, by);
          return Effect.flatMap(store.metadata(run.threadId), (thread) =>
            thread === undefined
              ? Effect.succeed<InterruptReceipt>('no-turn')
              : Effect.matchEffect(transports.of(thread), {
                  onFailure: () => Effect.succeed<InterruptReceipt>('no-turn'),
                  onSuccess: (bound) => bound.runs.interrupt(run.id, by),
                }),
          );
        }),
      intend: (runId, intent, at) => {
        intents.set(runId, mergedStopRequest(intents.get(runId) ?? null, intent, at));
      },
      intent: (runId) => intents.get(runId),
      launchable: (runId) => going.has(runId) && !intents.has(runId),
      ended: (runId) => {
        intents.delete(runId);
        leave(runId);
      },
      size: () => going.size,
      onChange: (hook) => {
        hooks.push(hook);
        hook(going.size);
      },
    });
  }),
);
