import { Duration, Effect, Stream } from 'effect';
import type { AgentCalls } from '@runlith/agent/AgentCalls';
import { callEnded } from '@runlith/agent/callProgress';
import type { CallAddress, CallEvent, CallRecord } from '@runlith/agent/callProgress';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { refusing } from '../../platform/contract/service/body.js';
import { CallActivity, type CallScope } from '../contract/service/calls.js';

export const unknownInvocation = (address: CallAddress): GateRefusal<'unknown-invocation'> =>
  new GateRefusal(
    'unknown-invocation',
    `This project holds no invocation under run ${address.runId} and tool call ${address.toolCallId} that this caller may reach.`,
    [
      'read_calls — read the invocations this project is holding now, and address one of those; a call that already left the record is over, and its transcript entry is what it did.',
    ],
  );

export function callActivity(deps: {
  readonly calls: AgentCalls;
  readonly projectOf: (threadId: string) => Effect.Effect<number | undefined, StoreFailure>;
}): CallActivity['Service'] {
  const resolved = new Map<string, number>();
  const projectOfThread = (threadId: string): Effect.Effect<number | undefined, StoreFailure> =>
    Effect.suspend(() => {
      const held = resolved.get(threadId);
      if (held !== undefined) return Effect.succeed(held);
      return Effect.map(deps.projectOf(threadId), (projectId) => {
        if (projectId !== undefined) resolved.set(threadId, projectId);
        return projectId;
      });
    });

  const mine = (scope: CallScope, record: CallRecord): Effect.Effect<boolean, StoreFailure> => {
    if (scope.threadId !== undefined) {
      if (record.threadId !== scope.threadId) return Effect.succeed(false);
      return Effect.map(projectOfThread(scope.threadId), (projectId) => projectId === scope.projectId);
    }
    if (record.threadId === null) return Effect.succeed(false);
    return Effect.map(projectOfThread(record.threadId), (projectId) => projectId === scope.projectId);
  };

  const carried = Effect.fnUntraced(function* (
    scope: CallScope,
    ended: number | undefined,
    held: readonly CallRecord[],
  ): Effect.fn.Return<readonly CallRecord[], StoreFailure> {
    const taken: CallRecord[] = [];
    let over = 0;
    for (const record of held) {
      if (!(yield* mine(scope, record))) continue;
      if (callEnded(record)) {
        if (ended !== undefined && over >= ended) continue;
        over += 1;
      }
      taken.push(record);
    }
    return taken;
  });

  return CallActivity.of({
    snapshot: (scope, ended) => carried(scope, ended, deps.calls.snapshot()),

    held: (scope) => carried(scope, undefined, deps.calls.snapshot()),

    feed: (scope, ended) =>
      deps.calls.events().pipe(
        Stream.mapEffect((event): Effect.Effect<CallEvent | null, StoreFailure> => {
          if (event.type === 'snapshot') {
            return Effect.map(carried(scope, ended, event.calls), (calls): CallEvent => ({ type: 'snapshot', calls: [...calls] }));
          }
          return Effect.map(mine(scope, event.call), (covered) => (covered ? event : null));
        }),
        Stream.filter((frame): frame is CallEvent => frame !== null),
        Stream.catch((failure: StoreFailure) => Stream.fromEffect(refusing(Effect.fail(failure)))),
      ),

    control: Effect.fnUntraced(function* (scope, address, control) {
      const held = deps.calls.get(address);
      if (held === undefined) return yield* Effect.fail(unknownInvocation(address));
      if (!(yield* mine(scope, held.record))) return yield* Effect.fail(unknownInvocation(address));
      return yield* deps.calls.control(address, control, scope.threadId === undefined ? 'operator' : 'agent');
    }),

    settled: Effect.fnUntraced(function* (scope, address, waitMs) {
      const held = deps.calls.get(address);
      if (held === undefined) return null;
      if (!(yield* mine(scope, held.record))) return yield* Effect.fail(unknownInvocation(address));
      yield* Effect.timeoutOption(held.settled, Duration.millis(waitMs));
      return held.record;
    }),
  });
}
