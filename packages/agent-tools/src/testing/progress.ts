import { Deferred, Effect } from 'effect';
import type { CallControlResult, CallProgress } from '@runlith/agent/callProgress';
import { CallCancellation } from '@runlith/executions/protocol/call';

export type StoppableProgress = CallProgress & { readonly stop: (reason: string) => void };

export function stoppableProgress(
  handOff: () => Effect.Effect<CallControlResult> = () => Effect.succeed({ status: 'unavailable', detail: null }),
): StoppableProgress {
  const said = Deferred.makeUnsafe<CallCancellation>();
  let cancellation: CallCancellation | null = null;
  return {
    link: () => () => {},
    stage: () => {},
    watch: () => {},
    handOff,
    stopped: () => cancellation,
    stopping: Deferred.await(said),
    stop: (reason) => {
      if (cancellation !== null) return;
      cancellation = new CallCancellation('run-abort', reason);
      Deferred.doneUnsafe(said, Effect.succeed(cancellation));
    },
  };
}
