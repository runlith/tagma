import { Effect } from 'effect';
import type { ThreadRunRow } from '../../rows';
import type { ThreadRunStorage } from '../../storage/runs';
import { seedThreadNotification } from '../../storage/settlement';
import type { ThreadTx, ThreadToolOutputScopeFaces } from '../../ThreadPorts';

const unread = () => Effect.die(new Error('This test does not use this run storage operation.'));

export const unreadRuns: ThreadRunStorage<ThreadTx> = {
  ownerId: 'test-owner',
  createRun: unread,
  runByStartKey: unread,
  runById: unread,
  resumeAwaitingRun: unread,
  parkRun: unread,
  settleRun: unread,
  stopRun: unread,
  withdrawRun: unread,
  markStatus: unread,
  latestRun: unread,
  runsOf: unread,
  latestRuns: unread,
  runningOf: unread,
  spentBySpawnRoot: unread,
  isRunning: unread,
  runningHere: unread,
  writeProgress: unread,
  writePhase: unread,
  addUsage: unread,
  charge: unread,
  writeHeartbeats: unread,
  requestStop: unread,
  writeStreamTail: unread,
  reapableRuns: unread,
  reapRun: unread,
  handOverRuns: unread,
  cutRun: unread,
  adoptRun: unread,
  claimSettledForNotification: unread,
  writeSettledNotification: unread,
  markSettledNotified: unread,
  heartbeatSettledClaim: unread,
  redeliverSettled: unread,
  settledRuns: unread,
  newestSettled: unread,
};

export const emptyToolOutputs: ThreadToolOutputScopeFaces = {
  tools: {},
  project: ({ output, modelOutput }) => Effect.succeed({ output, modelOutput }),
  projectMessages: (messages) => Effect.succeed(messages),
  retainInterrupted: ({ text, complete }) => Effect.succeed({ kind: 'text', text, complete }),
  retainOpen: ({ text }) => Effect.succeed({ input: { kind: 'text', text, complete: false }, chars: text.length }),
  commitReferenced: () => Effect.void,
  dispose: () => Effect.void,
};

export function runRow(id: string, patch: Partial<ThreadRunRow> = {}): ThreadRunRow {
  const at = new Date(0);
  return {
    id,
    threadId: 'thread-1',
    kind: 'turn',
    origin: 'core',
    status: 'running',
    ownerId: 'test-owner',
    account: null,
    provider: null,
    model: null,
    reasoning: null,
    switches: {},
    approvalMode: 'trust',
    interactive: false,
    progress: { stage: 'running', message: null },
    usage: null,
    cost: null,
    streamTail: null,
    resumes: 0,
    failureReason: null,
    failure: null,
    createdAt: at,
    startedAt: at,
    heartbeatAt: at,
    handedOverAt: null,
    finishedAt: null,
    settledNotifiedAt: null,
    settledNotifyAttempts: 0,
    settledBy: null,
    stopRequest: null,
    withdrawnWords: null,
    settledNotification: seedThreadNotification(id, at, null),
    updatedAt: at,
    ...patch,
  };
}
