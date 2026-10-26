import { Duration, Effect } from 'effect';
import type { ChildProcessHandle } from 'effect/process/ChildProcessSpawner';
import { STOP_LADDER, STOP_LADDER_MS, type StopStep } from '@runlith/executions/protocol/call';
import { climb } from '@runlith/executions/stopLadder';
import { processGroup } from '@runlith/executions/bunSpawner';

export const LOCAL_LADDER_MS = STOP_LADDER_MS;

export const WIN32_ESCALATION_MS = 3_000;

const SIGNALS: Readonly<Record<StopStep, NodeJS.Signals>> = {
  'hang-up': 'SIGHUP',
  interrupt: 'SIGINT',
  terminate: 'SIGTERM',
  kill: 'SIGKILL',
};

const endOnWindows = (handle: ChildProcessHandle): Effect.Effect<void> =>
  handle
    .kill({ forceKillAfter: Duration.millis(WIN32_ESCALATION_MS) })
    .pipe(Effect.timeoutOption(Duration.millis(2 * WIN32_ESCALATION_MS)), Effect.ignore);

export const endLocally = (handle: ChildProcessHandle, platform: string): Effect.Effect<void> => {
  if (platform === 'win32') return endOnWindows(handle);
  const group = processGroup(handle);
  if (group !== undefined) {
    return Effect.asVoid(
      climb('interrupt', [
        {
          send: (step) => Effect.sync(() => group.signal(SIGNALS[step])),
          gone: Effect.sync(() => !group.standing()),
        },
      ]),
    );
  }
  return Effect.gen(function* () {
    const interrupted = yield* Effect.result(
      handle.kill({ killSignal: 'SIGINT' }).pipe(Effect.timeoutOption(Duration.millis(STOP_LADDER.terminateAtMs))),
    );
    if (interrupted._tag === 'Failure') {
      yield* Effect.logWarning('Interrupting the child failed; escalating its release', interrupted.failure);
    } else if (interrupted.success._tag === 'Some') return;
    const forceAfter = STOP_LADDER.killAtMs - STOP_LADDER.terminateAtMs;
    yield* handle
      .kill({ killSignal: 'SIGTERM', forceKillAfter: Duration.millis(forceAfter) })
      .pipe(Effect.timeoutOption(Duration.millis(forceAfter + STOP_LADDER.reapMs)), Effect.ignore);
  });
};
