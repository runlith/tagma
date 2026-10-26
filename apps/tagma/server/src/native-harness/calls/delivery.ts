import { agentToolOutputText } from '@runlith/agent/ToolOutput';
import { AgentHostFailed, type AgentToolFailure } from '@runlith/agent/AgentFailure';
import type { AgentToolOutcome } from '@runlith/agent/door/types';
import { toolOutcomeFailed } from '@runlith/agent/tool';
import { referencedThreads } from '@runlith/agent/tool/display';
import type { CallRecord } from '@runlith/agent/callProgress';
import { Cause, Effect, Exit } from 'effect';
import { type CallEnding, OwedCalls } from '../../threads/contract/service/owedCalls.js';

const endingOf = (call: CallRecord, exit: Exit.Exit<AgentToolOutcome, AgentToolFailure>): CallEnding => {
  if (Exit.isFailure(exit)) {
    if (call.phase === 'stopping') return { outcome: 'stopped', result: Cause.pretty(exit.cause) };
    return Cause.hasInterruptsOnly(exit.cause) ? { outcome: 'interrupted' } : { outcome: 'failed', result: Cause.pretty(exit.cause) };
  }
  if (exit.value.completion === 'command') return { outcome: 'elsewhere' };
  const result = agentToolOutputText(exit.value.modelOutput);
  const kind = exit.value.verdict.kind;
  return {
    outcome: call.phase === 'stopping' || kind === 'denied' ? 'stopped' : toolOutcomeFailed(kind) ? 'failed' : 'completed',
    result,
    threads: referencedThreads(exit.value.display.reference),
  };
};

export const makeCallDelivery = Effect.gen(function* () {
  const owed = yield* OwedCalls;
  return {
    detaching: (call: CallRecord) => Effect.mapError(owed.owe(call), (cause) => new AgentHostFailed({ port: 'tools', cause })),
    began: (call: CallRecord) => Effect.mapError(owed.began(call), (cause) => new AgentHostFailed({ port: 'tools', cause })),
    completed: (call: CallRecord, exit: Exit.Exit<AgentToolOutcome, AgentToolFailure>) =>
      owed.end(call, endingOf(call, exit)).pipe(Effect.orDie),
  };
});
