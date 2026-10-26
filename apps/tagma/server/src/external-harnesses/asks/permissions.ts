import { HarnessPermissions, type HarnessJudging } from '../contract/service/permissions.js';
import type { TerminalAsks } from './terminal.js';

export const terminalPermissions = (judging: HarnessJudging, asks: TerminalAsks): HarnessPermissions['Service'] =>
  HarnessPermissions.of({
    ...judging,
    judge: (threadId, call) => asks.judge(threadId, call),
    outcome: (threadId, requestId, withinMs) => asks.outcome(threadId, requestId, withinMs),
    ended: (threadId, callId) => asks.callEnded(threadId, callId),
  });
