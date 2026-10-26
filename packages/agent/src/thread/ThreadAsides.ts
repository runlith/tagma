import { Clock, Effect, Fiber } from 'effect';
import type { LLMError } from '@runlith/llm/schema/errors';
import { AgentAsideBinding, type AgentAside, type AgentAsideAnswer, type AgentAsideCalledTool } from '../agent/AgentAside';
type Held = {
  readonly aside: AgentAside;
  readonly expiry: Fiber.Fiber<void> | undefined;
};
export type ThreadAsideWatcher = {
  opened(threadId: string, runId: string, keepWarm: boolean): Effect.Effect<void>;
  settled(threadId: string, aside: AgentAside): Effect.Effect<void>;
  forgotten(threadId: string): Effect.Effect<void>;
};
export type ThreadAsides = Effect.Success<typeof makeThreadAsides>;
export const makeThreadAsides = Effect.gen(function* () {
  const scope = yield* Effect.scope;
  const held = new Map<string, Held>();
  const asking = new Map<string, Set<Fiber.Fiber<AgentAsideAnswer, LLMError | AgentAsideCalledTool>>>();
  const watchers = new Set<ThreadAsideWatcher>();
  const drop = (threadId: string): Effect.Effect<void> => {
    const entry = held.get(threadId);
    held.delete(threadId);
    return entry?.expiry ? Effect.asVoid(Fiber.interrupt(entry.expiry)) : Effect.void;
  };
  return {
    hold: Effect.fnUntraced(function* (threadId: string, aside: AgentAside) {
      yield* drop(threadId);
      const ms = aside.expiresAt === null ? undefined : aside.expiresAt - (yield* Clock.currentTimeMillis);
      if (ms !== undefined && ms <= 0) return;
      const expiry =
        ms === undefined
          ? undefined
          : yield* Effect.forkIn(
              Effect.andThen(
                Effect.sleep(ms),
                Effect.sync(() => {
                  if (held.get(threadId)?.aside === aside) held.delete(threadId);
                }),
              ),
              scope,
            );
      held.set(threadId, { aside, expiry });
    }),
    of: (threadId: string, binding?: AgentAsideBinding): AgentAside | undefined => {
      const entry = held.get(threadId);
      if (entry === undefined) return undefined;
      if (binding !== undefined && !AgentAsideBinding.same(entry.aside.binding, binding)) return undefined;
      return entry.aside;
    },
    ask: (
      threadId: string,
      aside: AgentAside,
      question: {
        readonly instruction: string;
      },
    ): Effect.Effect<AgentAsideAnswer, LLMError | AgentAsideCalledTool> =>
      Effect.uninterruptibleMask(
        Effect.fnUntraced(function* (restore) {
          const fiber = yield* Effect.forkIn(aside.ask({ instruction: question.instruction }), scope);
          const open = asking.get(threadId) ?? new Set();
          open.add(fiber);
          asking.set(threadId, open);
          return yield* restore(Fiber.join(fiber)).pipe(
            Effect.onInterrupt(() => Fiber.interrupt(fiber)),
            Effect.ensuring(
              Effect.sync(() => {
                open.delete(fiber);
                if (open.size === 0 && asking.get(threadId) === open) asking.delete(threadId);
              }),
            ),
          );
        }),
      ),
    watch: (watcher: ThreadAsideWatcher): (() => void) => {
      watchers.add(watcher);
      return () => {
        watchers.delete(watcher);
      };
    },
    opened: (threadId: string, runId: string, keepWarm: boolean): Effect.Effect<void> =>
      Effect.suspend(() => Effect.forEach([...watchers], (watcher) => watcher.opened(threadId, runId, keepWarm), { discard: true })),
    settled: (threadId: string, runId: string): Effect.Effect<void> =>
      Effect.suspend(() => {
        const entry = held.get(threadId);
        if (entry === undefined || entry.aside.runId !== runId) return Effect.void;
        return Effect.andThen(
          Effect.forEach([...watchers], (watcher) => watcher.settled(threadId, entry.aside), { discard: true }),
          Effect.sync(() => {
            if (entry.expiry === undefined && held.get(threadId) === entry) held.delete(threadId);
          }),
        );
      }),
    forget: (threadId: string): Effect.Effect<void> =>
      Effect.andThen(
        drop(threadId),
        Effect.andThen(
          Effect.suspend(() => {
            const open = [...(asking.get(threadId) ?? [])];
            asking.delete(threadId);
            return Fiber.interruptAll(open);
          }),
          Effect.forEach([...watchers], (watcher) => watcher.forgotten(threadId), { discard: true }),
        ),
      ),
    clear: (): Effect.Effect<void> =>
      Effect.suspend(() => {
        held.clear();
        const open = [...asking.values()].flatMap((fibers) => [...fibers]);
        asking.clear();
        return Fiber.interruptAll(open);
      }),
  };
});
