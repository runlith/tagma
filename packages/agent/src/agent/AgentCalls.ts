import { Clock, Effect, type Exit, FiberSet, Queue, Stream } from 'effect';
import type { DeclaredCancellationCause } from '@runlith/executions/protocol/call';
import type { AgentHostFailed, AgentToolFailure } from './AgentFailure';
import type { AgentCallQuestion, AgentCallVerdict, AgentToolOutcome } from './door/types';
import { makeAgentCall, type AgentCall, type Arrival } from './AgentCall';
import { makeThreadClaims } from './door/CallOrder';
import {
  CALL_ENVELOPE_MS,
  LONGEST_ACT_MS,
  callEnded,
  type CallAddress,
  type CallRecord,
  type CallEvent,
  type CallControl,
  type CallControlResult,
} from './callProgress';
import type { CallAuthority } from './callProgress';
import type { RunStop } from './RunStop';
export type CallHooks = {
  readonly retain: () => Effect.Effect<
    {
      readonly release: Effect.Effect<void>;
    },
    AgentHostFailed
  >;
  readonly detaching?: (call: CallRecord) => Effect.Effect<void, AgentHostFailed>;
  readonly began?: (call: CallRecord) => Effect.Effect<void, AgentHostFailed>;
  readonly asking?: (call: CallRecord, question: AgentCallQuestion) => Effect.Effect<AgentCallVerdict, AgentHostFailed>;
  readonly completed: (call: CallRecord, exit: Exit.Exit<AgentToolOutcome, AgentToolFailure>) => Effect.Effect<void>;
};
const keyOf = (address: CallAddress): string => JSON.stringify([address.runId, address.toolCallId]);
const stopReason = (call: AgentCall, authority: CallAuthority): string =>
  call.watching
    ? authority === 'operator'
      ? 'The operator ended this wait.'
      : 'The agent ended this wait.'
    : authority === 'operator'
      ? 'Stopped by the operator.'
      : 'Stopped by the agent.';
export type AgentCalls = Effect.Success<ReturnType<typeof makeAgentCalls>>;
export const makeAgentCalls = Effect.fnUntraced(function* ({
  history,
  envelopeMs = CALL_ENVELOPE_MS,
}: {
  readonly history: number;
  readonly envelopeMs?: number;
}) {
  const scope = yield* Effect.scope;
  const clock = yield* Clock.Clock;
  const runCallback = yield* FiberSet.makeRuntime<never, void, never>();
  const calls = new Map<string, AgentCall>();
  const listeners = new Set<(event: CallEvent) => void>();
  const arrivals = new Map<string, () => Arrival | null>();
  const stops = new Map<string, RunStop>();
  const publish = (call: CallRecord): void => {
    const key = keyOf(call);
    const held = calls.get(key);
    if (held !== undefined) {
      calls.delete(key);
      calls.set(key, held);
    }
    for (const listener of listeners) listener({ type: 'updated', call });
    if (!callEnded(call)) return;
    const ended = [...calls.entries()].reverse().filter(([, entry]) => callEnded(entry.record));
    ended.sort(([, a], [, b]) => (b.record.endedAt ?? 0) - (a.record.endedAt ?? 0));
    for (const [key] of ended.slice(history)) calls.delete(key);
  };
  const standing = (runId: string): readonly AgentCall[] =>
    [...calls.values()].filter((call) => call.record.runId === runId && call.record.mode === 'foreground' && !callEnded(call.record));
  const halt = (runId: string, reason: string): void => {
    const declared = standing(runId).map((call) => call.declare(reason, 'run-abort'));
    for (const interrupt of declared) interrupt?.();
  };
  const get = (address: CallAddress): AgentCall | undefined => calls.get(keyOf(address));
  const snapshot = (): readonly CallRecord[] =>
    [...calls.values()]
      .reverse()
      .map((call) => call.record)
      .sort((a, b) => {
        if (callEnded(a) !== callEnded(b)) return callEnded(a) ? 1 : -1;
        return (b.endedAt ?? b.startedAt) - (a.endedAt ?? a.startedAt);
      });
  return {
    claims: makeThreadClaims(),
    open: (
      input: CallAddress & {
        threadId?: string;
        name: string;
        input: unknown;
      },
    ): AgentCall => {
      const key = keyOf(input);
      const held = calls.get(key);
      if (held !== undefined) return held;
      const call = makeAgentCall(
        {
          runId: input.runId,
          toolCallId: input.toolCallId,
          threadId: input.threadId ?? null,
          name: input.name,
          input: input.input,
          phase: 'preparing',
          mode: 'foreground',
          detachable: false,
          startedAt: clock.currentTimeMillisUnsafe(),
          admittedAt: null,
          endedAt: null,
          expiresAt: null,
          expiresBy: null,
          limitCeilingMs: LONGEST_ACT_MS,
          detail: null,
          executions: [],
        },
        { scope, clock, runCallback, publish, envelopeMs, unread: () => arrivals.get(input.runId)?.() ?? null },
      );
      calls.set(key, call);
      publish(call.record);
      const stop = stops.get(input.runId);
      if (stop?.stopped === true) call.stop(stop.message, 'run-abort');
      return call;
    },
    bind: (runId: string, stop: RunStop): (() => void) => {
      stops.set(runId, stop);
      const unlisten = stop.listen(() => halt(runId, stop.message));
      return () => {
        unlisten();
        if (stops.get(runId) === stop) stops.delete(runId);
      };
    },
    listen: (runId: string, unread: () => Arrival | null): (() => void) => {
      arrivals.set(runId, unread);
      return () => {
        if (arrivals.get(runId) === unread) arrivals.delete(runId);
      };
    },
    giveWay: (runId: string, arrival: Arrival): void => {
      for (const call of standing(runId)) call.askWay(arrival);
    },
    get,
    snapshot,
    events: (): Stream.Stream<CallEvent> =>
      Stream.callback((queue) =>
        Effect.acquireRelease(
          Effect.sync(() => {
            const listener = (event: CallEvent) => {
              Queue.offerUnsafe(queue, event);
            };
            listeners.add(listener);
            Queue.offerUnsafe(queue, { type: 'snapshot', calls: snapshot() });
            return listener;
          }),
          (listener) =>
            Effect.sync(() => {
              listeners.delete(listener);
            }),
        ),
      ),
    control: (address: CallAddress, control: CallControl, authority: CallAuthority = 'operator'): Effect.Effect<CallControlResult> =>
      Effect.suspend(() => {
        const call = get(address);
        if (call === undefined) return Effect.succeed({ status: 'missing', detail: 'This runtime does not hold that invocation.' });
        if (callEnded(call.record)) return Effect.succeed({ status: 'ended', detail: null });
        switch (control.action) {
          case 'stop':
            call.stop(stopReason(call, authority));
            break;
          case 'background':
            return call.handOff(authority);
          case 'limit':
            return call.limit(control.milliseconds, authority);
        }
        return Effect.succeed({ status: 'changed', detail: null });
      }),
    end: Effect.fnUntraced(function* (threadIds: readonly string[], cause: DeclaredCancellationCause, run?: string) {
      const threads = new Set(threadIds);
      const held = [...calls.values()].filter(
        (call) =>
          call.record.threadId !== null &&
          threads.has(call.record.threadId) &&
          (run === undefined || (call.record.runId === run && call.record.mode === 'foreground')) &&
          !callEnded(call.record),
      );
      for (const call of held) call.stop('The thread owning this invocation is ending.', cause);
      yield* Effect.all(
        held.map((call) => call.settled),
        { concurrency: 'unbounded', discard: true },
      );
      return held.map((call) => call.record);
    }),
  };
});
