import type { Caller } from '../../../platform/contract/wire/caller.js';
import { executionActorOf } from '../../../executions/terminals/principals.js';
import { TerminalRefused } from '../../../executions/contract/wire/refusals.js';
import type { TerminalActor } from '../../../executions/contract/wire/terminals.js';

export const requesterOf = (caller: Caller, projectId: number): TerminalActor | undefined => {
  const actor = executionActorOf(caller.actor, projectId);
  return actor instanceof TerminalRefused ? undefined : actor;
};
