import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Cause, Effect, Exit } from 'effect';
import type { AgentToolOutcome } from '@runlith/agent/door/types';
import { AgentHostFailed } from '@runlith/agent/AgentFailure';
import type { CallRecord } from '@runlith/agent/callProgress';
import { type CallEnding, OwedCalls } from '../../threads/contract/service/owedCalls.js';
import { makeCallDelivery } from './delivery.js';

const owedInto = (ended: CallEnding[]): OwedCalls['Service'] => ({
  owe: () => Effect.void,
  began: () => Effect.die('No call begins in this scenario.'),
  end: (_call, ending) =>
    Effect.sync(() => {
      ended.push(ending);
    }),
  owed: () => Effect.succeed([]),
  detached: (_call, work) => work,
});

const call = { threadId: 'thread-1', runId: 'run-1', toolCallId: 'call-1', name: 'bash', phase: 'running' } as CallRecord;
const answer = {
  modelOutput: { type: 'text', value: 'command finished' },
  verdict: { kind: 'answered' },
  display: { form: 'none', reference: { kind: 'agent', address: 'review', id: 'child-1' } },
} as AgentToolOutcome;

it.effect(
  'a detached call ends owed with its words and the threads it names, a cut one ends interrupted, and leaves its ending to the command owner when that owner owes it',
  () =>
    Effect.gen(function* () {
      const ended: CallEnding[] = [];
      const delivery = yield* makeCallDelivery.pipe(Effect.provideService(OwedCalls, owedInto(ended)));

      yield* delivery.completed(call, Exit.succeed({ ...answer, completion: 'command' }));
      yield* delivery.completed(call, Exit.succeed(answer));
      yield* delivery.completed({ ...call, phase: 'stopping' }, Exit.succeed(answer));
      yield* delivery.completed(call, Exit.failCause(Cause.fail(new AgentHostFailed({ port: 'tools', cause: new Error('gone') }))));
      yield* delivery.completed(call, Exit.failCause(Cause.interrupt(7)));
      yield* delivery.completed({ ...call, phase: 'stopping' }, Exit.failCause(Cause.interrupt(7)));

      expect(ended.map((ending) => ending.outcome)).toEqual(['elsewhere', 'completed', 'stopped', 'failed', 'interrupted', 'stopped']);
      expect(ended[1]).toEqual({ outcome: 'completed', result: 'command finished', threads: [{ threadId: 'child-1', name: 'review' }] });
    }),
);
