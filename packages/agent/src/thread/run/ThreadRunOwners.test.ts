import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import type { ThreadRunStorage } from '../storage/runs';
import { mergedStopRequest } from '../storage/settlement';
import type { ThreadTx } from '../ThreadPorts';
import type { ThreadRunSettled } from './ThreadRunLedger';
import { runRow, unreadRuns } from '../conformance/runCycle/runDoubles';
import { runWorld } from '../conformance/runCycle/runWorld';
it.effect(
  'a stop is persisted and the aborted run and its notification name the actor',
  Effect.fnUntraced(function* () {
    let row = runRow('run-1');
    const runs: ThreadRunStorage<ThreadTx> = {
      ...unreadRuns,
      runById: () => Effect.sync(() => row),
      latestRun: () => Effect.sync(() => (row.status === 'running' ? row : null)),
      requestStop: (_id, intent, at) =>
        Effect.sync(() => {
          const stopRequest = mergedStopRequest(row.stopRequest, intent, at);
          row = { ...row, stopRequest };
          return stopRequest;
        }),
      settleRun: (_id, patch) =>
        Effect.sync(() => {
          row = { ...row, ...patch };
          return row;
        }),
      markStatus: () => Effect.void,
      writeSettledNotification: () => Effect.succeed(true),
      markSettledNotified: () => Effect.succeed(true),
      heartbeatSettledClaim: () => Effect.void,
      handOverRuns: () => Effect.void,
    };
    const { execution, settlements } = yield* runWorld(runs);
    const endings: ThreadRunSettled[] = [];
    yield* settlements.subscribe({
      name: 'suite',
      handle: (event) =>
        Effect.sync(() => {
          endings.push(event);
        }),
    });
    yield* execution.track(row, { work: Effect.void });
    expect(yield* execution.stop(row, { marker: true, by: 'reader', awaitSettled: true })).toBe('stopped');
    expect(yield* runs.runById(row.id)).toMatchObject({
      status: 'aborted',
      settledBy: 'reader',
      stopRequest: { by: 'reader', marker: true, withdraw: false },
    });
    expect(endings).toMatchObject([{ runId: row.id, status: 'aborted', stoppedBy: 'reader' }]);
  }),
);
