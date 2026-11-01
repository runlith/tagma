import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { callerInThread, unthreadedCaller } from '../testing/caller';
import { builtinMode } from '../testing/modes';
import { Cause, Deferred, Effect, Exit, Fiber, Schema, Scope, Stream } from 'effect';
import { type AgentCalls, makeAgentCalls, type CallHooks } from '../AgentCalls';
import { RUN_STOPPED, WORDS_ENDED_WAIT } from '../AgentCall';
import { RunStop } from '../RunStop';
import { agentSpan } from '../spans';
import { type CallAdmission, type CallControl, type CallRecord, CallExecution, callEnded, LONGEST_ACT_MS } from '../callProgress';
import type { AgentToolDoor } from './AgentToolDoor';
import { openToolDoor, ToolJudge } from './openToolDoor';
import type { AgentCallQuestion, AgentCallVerdict, AgentToolOutcome } from './types';
import { AgentHostFailed, AgentToolFailed, type AgentToolFailure } from '../AgentFailure';
import { type AgentToolOutputs, boundAgentToolOutput, inspectAgentToolOutput } from '../ToolOutput';
import { TOOL_OUTPUT_MAX_BYTES } from '../ToolOutputSpool';
import { type Claim, Tool, type ToolOutputSource } from '../tool';
import { makeCallSettlements, ToolSettlements, type CallSettlements } from '../ToolSettlements';
import type { ToolDisplay } from '../../tool/display';
import { ASKS_IN_REVIEW, ASKS_NEVER } from '../../permissions/vocabulary';
type Ctx = Record<string, never>;
const running = (started: Deferred.Deferred<void>, held: Deferred.Deferred<void>) =>
  Effect.andThen(Deferred.succeed(started, undefined), Deferred.await(held)).pipe(Effect.as({ done: true }));
const makeCalls = Effect.fnUntraced(function* (envelopeMs?: number) {
  return yield* makeAgentCalls({ history: 1, envelopeMs });
});
const stopRun = (calls: AgentCalls, reason?: string): void => {
  const stop = new RunStop();
  calls.bind('run-1', stop);
  stop.stop(reason === undefined ? undefined : new Error(reason));
};
function doorOver(
  input: {
    calls?: AgentCalls;
    hooks?: CallHooks;
    outputs?: AgentToolOutputs;
    mode?: 'trust' | 'review';
    settlements?: CallSettlements;
  } = {},
) {
  const hooks = input.hooks;
  return openToolDoor<Ctx>(
    'run-1',
    input.calls === undefined ? unthreadedCaller : callerInThread('thread-1', 'run-1'),
    {},
    new ToolJudge(builtinMode(input.mode ?? 'trust')),
    undefined,
    undefined,
    undefined,
    input.outputs,
    input.calls,
    hooks === undefined ? undefined : () => hooks,
    undefined,
    undefined,
    0,
    false,
    [],
    input.settlements,
  );
}
const threadDoor = (calls: AgentCalls, hooks: CallHooks, runId: string) =>
  openToolDoor<Ctx>(
    runId,
    callerInThread('thread-1', runId),
    {},
    new ToolJudge(builtinMode('review')),
    undefined,
    undefined,
    undefined,
    undefined,
    calls,
    () => hooks,
  );
const settle = (door: AgentToolDoor<Ctx>, tool: Tool.Tool, toolCallId = 'call-1') =>
  door.settle({ name: 'slow', tool, input: {}, options: { toolCallId, messages: [] } });
const failing = (door: AgentToolDoor<Ctx>, tool: Tool.Tool) => Effect.flip(settle(door, tool));
const address = { runId: 'run-1', toolCallId: 'call-1' };
const NOTES = '/work/notes/today.md';
const NOTES_WRITE = { on: { kind: 'file', path: NOTES }, access: 'write' } as const satisfies Claim;
const awaitPhase = (calls: AgentCalls, phase: CallRecord['phase']) =>
  calls.events().pipe(
    Stream.filter((event) =>
      event.type === 'snapshot'
        ? event.calls.some((call) => call.toolCallId === address.toolCallId && call.phase === phase)
        : event.call.toolCallId === address.toolCallId && event.call.phase === phase,
    ),
    Stream.take(1),
    Stream.runDrain,
  );
describe('the door under the run’s call owner', () => {
  it.effect(
    'a call of a run already halted neither prepares nor runs, and fails with the stop',
    Effect.fnUntraced(function* () {
      const calls = yield* makeCalls();
      let prepared = false;
      let ran = false;
      const writing = Tool.make({
        display: () => ({ form: 'none' }),
        approval: ASKS_NEVER,
        description: 'Change a file.',
        parameters: Schema.Struct({}),
        prepare: () =>
          Effect.sync(() => {
            prepared = true;
            return { subjects: [] };
          }),
        execute: () =>
          Effect.sync(() => {
            ran = true;
            return 'wrote it';
          }),
      });
      stopRun(calls);
      const failure = yield* failing(doorOver({ calls }), writing);
      expect({ prepared, ran }).toEqual({ prepared: false, ran: false });
      expect(failure).toMatchObject({ _tag: 'AgentToolFailed', cause: { _tag: 'Tool.Failed', reason: RUN_STOPPED } });
      expect(calls.snapshot()[0]).toMatchObject({ phase: 'stopped' });
    }),
  );
  it.effect(
    'halting the run interrupts a call mid-body and answers it as stopped: unknown effect for a tool that changes things, cancelled for one that only reads',
    Effect.fnUntraced(function* () {
      for (const [mutates, kind] of [
        [true, 'unknown'],
        [false, 'cancelled'],
      ] as const) {
        const calls = yield* makeCalls();
        const started = yield* Deferred.make<void>();
        let cleaned = false;
        const slow = Tool.make({
          display: () => ({ form: 'none' }),
          approval: ASKS_NEVER,
          description: 'Run until stopped.',
          parameters: Schema.Struct({}),
          mutates,
          execute: () =>
            Deferred.succeed(started, undefined).pipe(
              Effect.andThen(Effect.never),
              Effect.ensuring(
                Effect.sync(() => {
                  cleaned = true;
                }),
              ),
            ),
        });
        const fiber = yield* Effect.forkScoped(settle(doorOver({ calls }), slow));
        yield* Deferred.await(started);
        stopRun(calls);
        const settled = yield* Fiber.join(fiber);
        expect(cleaned).toBe(true);
        expect(settled).toMatchObject({ executed: true, verdict: { kind }, output: { status: 'cancelled' } });
        expect(calls.snapshot()[0]).toMatchObject({ phase: 'stopped', toolCallId: 'call-1' });
      }
    }),
  );
  it.effect.each([false, true])(
    'a cancelled command keeps its output, address and stop reason after cleanup (oversized: %p)',
    Effect.fnUntraced(function* (oversized) {
      const calls = yield* makeCalls();
      const started = yield* Deferred.make<void>();
      const execution = yield* Schema.decodeUnknownEffect(CallExecution)({
        execution: { installation: 'installation', execution: 'command-1', incarnation: 167 },
        operation: { installation: 'installation', operation: 'launch-1' },
        kind: 'command',
        label: 'Compile the application',
      });
      const command = Tool.make({
        display: () => ({ form: 'none' }),
        approval: ASKS_NEVER,
        description: 'Run a command until stopped.',
        parameters: Schema.Struct({}),
        keepsTail: true,
        mutates: true,
        execute: Effect.fnUntraced(function* (_input: unknown, call: Tool.ToolCallOptions) {
          const unlink = call.progress?.link(execution);
          yield* Deferred.succeed(started, undefined);
          yield* Effect.never.pipe(Effect.ensuring(Effect.sync(() => unlink?.())));
        }),
        settleEffect: () =>
          Effect.succeed({
            status: 'completed',
            output: new Tool.ToolAnswer(`${oversized ? 'x'.repeat(2 * TOOL_OUTPUT_MAX_BYTES) : ''}compiled before the stop`, {
              form: 'none',
            }),
          }),
      });
      const waiter = yield* Effect.forkScoped(settle(doorOver({ calls }), command));
      yield* Deferred.await(started);
      stopRun(calls, 'The agent harness was disposed.');
      const outcome = yield* Fiber.join(waiter);
      expect(outcome).toMatchObject({ executed: true, verdict: { kind: 'unknown' } });
      const text = JSON.stringify(outcome.modelOutput);
      if (!oversized) expect(text).toContain('compiled before the stop');
      expect(text).toContain('command-1');
      expect(text).toContain('167');
      expect(text).toContain('The agent harness was disposed.');
    }),
  );
  it.effect(
    'a stopped mutation retains its complete read-back until the terminal outcome is recorded',
    Effect.fnUntraced(function* () {
      const calls = yield* makeCalls();
      const settlements = yield* makeCallSettlements;
      const started = yield* Deferred.make<void>();
      const report = { changed: 'x'.repeat(2 * TOOL_OUTPUT_MAX_BYTES), remaining: ['not-started'] };
      let held = true;
      let cleaned = false;
      const kept = new Map<string, string>();
      const outputs: AgentToolOutputs = {
        project: ({ output, modelOutput, keep }) =>
          Effect.sync(() => {
            const inspected = inspectAgentToolOutput(modelOutput);
            if (!inspected.oversized) return { output, modelOutput };
            const outputId = 'retained-cancellation';
            kept.set(outputId, inspected.text);
            return boundAgentToolOutput(modelOutput, { outputId, ...inspected, retrievalTool: 'read_tool_output', keep });
          }),
        projectMessages: (messages) => Effect.succeed(messages),
      };
      const changing = Tool.make({
        display: () => ({ form: 'none' }),
        approval: ASKS_NEVER,
        description: 'Change entries until stopped.',
        parameters: Schema.Struct({}),
        mutates: true,
        execute: () =>
          Deferred.succeed(started, undefined).pipe(
            Effect.andThen(Effect.never),
            Effect.ensuring(
              Effect.sync(() => {
                cleaned = true;
              }),
            ),
          ),
        settleEffect: () =>
          cleaned && held
            ? Effect.succeed({ status: 'completed', output: new Tool.ToolAnswer(report, undefined, { ending: 'cancelled' }) })
            : Effect.fail(new Tool.ToolFailed({ reason: 'The invocation no longer owns its settled report.' })),
        settled: () => {
          held = false;
        },
      });
      const waiter = yield* Effect.forkScoped(
        settle(doorOver({ calls, outputs }), changing).pipe(Effect.provideService(ToolSettlements, settlements)),
      );
      yield* Deferred.await(started);
      yield* calls.control(address, { action: 'stop' });
      const outcome = yield* Fiber.join(waiter);
      expect(outcome).toMatchObject({ executed: true, verdict: { kind: 'cancelled' }, retained: { outputId: 'retained-cancellation' } });
      expect(kept.get(outcome.retained!.outputId)!.split('\n')).toEqual([
        'cancelled: Stopped by the operator.',
        'executions: []',
        `output: ${JSON.stringify(report)}`,
      ]);
      expect(held).toBe(true);
      settlements.recorded('run-1', 'call-1');
      expect(held).toBe(false);
    }),
  );
  it.effect.each(['completed', 'cancelled'] as const)(
    'a file-backed report remains retained after its producer is released (%s)',
    Effect.fnUntraced(function* (ending) {
      const calls = yield* makeCalls();
      const settlements = yield* makeCallSettlements;
      const started = yield* Deferred.make<void>();
      const text = JSON.stringify({ changed: 'x'.repeat(2 * TOOL_OUTPUT_MAX_BYTES), remaining: ['not-started'] });
      const source: ToolOutputSource = { path: '/reports/call-1.json', byteLength: text.length, lineCount: 1, format: 'json' };
      const pending = new Map([[source.path, text]]);
      const kept = new Map<string, string>();
      const outputs: AgentToolOutputs = {
        project: (input) =>
          Effect.sync(() => {
            const content = input.source === undefined ? undefined : pending.get(input.source.path);
            if (content === undefined) return { output: input.output, modelOutput: input.modelOutput };
            const outputId = 'retained-source';
            kept.set(outputId, content);
            return {
              output: input.output,
              modelOutput: input.modelOutput,
              retained: { outputId, format: source.format, byteLength: source.byteLength, lineCount: source.lineCount },
            };
          }),
        projectMessages: (messages) => Effect.succeed(messages),
      };
      const answer = new Tool.ToolAnswer({ report: source.path }, undefined, ending === 'cancelled' ? { source, ending } : { source });
      const changing = Tool.make({
        display: () => ({ form: 'none' }),
        approval: ASKS_NEVER,
        description: 'Report changed entries.',
        parameters: Schema.Struct({}),
        mutates: true,
        execute: () =>
          Deferred.succeed(started, undefined).pipe(Effect.andThen(ending === 'cancelled' ? Effect.never : Effect.succeed(answer))),
        settleEffect: () => Effect.succeed({ status: 'completed', output: answer }),
        settled: () => {
          pending.delete(source.path);
        },
      });
      const waiter = yield* Effect.forkScoped(
        settle(doorOver({ calls, outputs }), changing).pipe(Effect.provideService(ToolSettlements, settlements)),
      );
      yield* Deferred.await(started);
      if (ending === 'cancelled') yield* calls.control(address, { action: 'stop' });
      const outcome = yield* Fiber.join(waiter);
      settlements.recorded('run-1', 'call-1');
      expect(pending.size).toBe(0);
      expect(outcome.verdict.kind).toBe(ending === 'cancelled' ? 'cancelled' : 'answered');
      expect(kept.get(outcome.retained?.outputId ?? '')).toBe(text);
    }),
  );
  it.effect(
    'stopping retention preserves the completed mutation and its source until the outcome is recorded',
    Effect.fnUntraced(function* () {
      const calls = yield* makeCalls();
      const settlements = yield* makeCallSettlements;
      const projecting = yield* Deferred.make<void>();
      const report = { deleted: ['notes.md'] };
      const text = JSON.stringify(report);
      let copied = false;
      const source: ToolOutputSource = {
        path: '/reports/call-1.json',
        byteLength: text.length,
        lineCount: 1,
        format: 'json',
        retained: () => {
          copied = true;
        },
      };
      const pending = new Map([[source.path, text]]);
      const kept = new Map<string, string>();
      let waiting = true;
      const outputs: AgentToolOutputs = {
        project: (input) =>
          Effect.suspend(() => {
            if (waiting) {
              waiting = false;
              return Deferred.succeed(projecting, undefined).pipe(Effect.andThen(Effect.never));
            }
            const content = input.source === undefined ? undefined : pending.get(input.source.path);
            if (content === undefined) return Effect.succeed({ output: input.output, modelOutput: input.modelOutput });
            const outputId = 'retained-completed-source';
            kept.set(outputId, content);
            input.source?.retained?.();
            return Effect.succeed({
              output: input.output,
              modelOutput: input.modelOutput,
              retained: { outputId, format: source.format, byteLength: source.byteLength, lineCount: source.lineCount },
            });
          }),
        projectMessages: (messages) => Effect.succeed(messages),
      };
      const changing = Tool.make({
        display: () => ({ form: 'none' }),
        approval: ASKS_NEVER,
        description: 'Delete an entry and retain its report.',
        parameters: Schema.Struct({}),
        mutates: true,
        execute: () => Effect.succeed(new Tool.ToolAnswer(report, undefined, { source, text: 'deleted notes.md' })),
        settled: () => {
          if (copied) pending.delete(source.path);
        },
      });
      const waiter = yield* Effect.forkScoped(
        settle(doorOver({ calls, outputs }), changing).pipe(Effect.provideService(ToolSettlements, settlements)),
      );
      yield* Deferred.await(projecting);
      yield* calls.control(address, { action: 'stop' });
      const outcome = yield* Fiber.join(waiter);
      expect(outcome).toMatchObject({
        executed: true,
        verdict: { kind: 'answered' },
        output: report,
        modelOutput: { type: 'text', value: 'deleted notes.md' },
        retained: { outputId: 'retained-completed-source' },
      });
      expect(kept.get(outcome.retained!.outputId)).toBe(text);
      expect(pending.get(source.path)).toBe(text);
      settlements.recorded('run-1', 'call-1');
      expect(pending.size).toBe(0);
      expect(kept.get(outcome.retained!.outputId)).toBe(text);
    }),
  );
  it.effect.each(['unknown', 'legacy', 'unreadable', 'unsettled'] as const)(
    'a stopped mutation keeps unknown without a confirmed cancelled read-back (%s)',
    Effect.fnUntraced(function* (recovery) {
      const calls = yield* makeCalls();
      const started = yield* Deferred.make<void>();
      const changing = Tool.make({
        display: () => ({ form: 'none' }),
        approval: ASKS_NEVER,
        description: 'Change entries until stopped.',
        parameters: Schema.Struct({}),
        mutates: true,
        execute: () => Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
        settleEffect: () => {
          if (recovery === 'unreadable') return Effect.fail(new Tool.ToolFailed({ reason: 'The read-back is unavailable.' }));
          if (recovery === 'unsettled') return Effect.succeed({ status: 'unknown' });
          const output =
            recovery === 'legacy'
              ? { status: 'cancelled' }
              : new Tool.ToolAnswer({ remaining: ['unknown'] }, undefined, { ending: 'unknown' });
          return Effect.succeed({ status: 'completed', output });
        },
      });
      const waiter = yield* Effect.forkScoped(settle(doorOver({ calls }), changing));
      yield* Deferred.await(started);
      yield* calls.control(address, { action: 'stop' });
      const outcome = yield* Fiber.join(waiter);
      expect(outcome).toMatchObject({ executed: true, verdict: { kind: 'unknown' } });
      if (recovery === 'unreadable')
        expect(outcome.output).toMatchObject({ output: { status: 'unreadable', reason: 'The read-back is unavailable.' } });
    }),
  );
  it.effect(
    'an interrupted admission returns its owner’s read-back even before an execution was linked',
    Effect.fnUntraced(function* () {
      const calls = yield* makeCalls();
      const started = yield* Deferred.make<void>();
      let recovery = 'unknown';
      const command = Tool.make({
        display: () => ({ form: 'none' }),
        approval: ASKS_NEVER,
        description: 'Admit a command until interrupted.',
        parameters: Schema.Struct({}),
        execute: () =>
          Deferred.succeed(started, undefined).pipe(
            Effect.andThen(Effect.never),
            Effect.onInterrupt(() =>
              Effect.sync(() => {
                recovery = 'read_terminal_operation launch-1';
              }),
            ),
          ),
        settleEffect: () => Effect.sync(() => ({ status: 'completed', output: recovery })),
      });
      const waiter = yield* Effect.forkScoped(settle(doorOver({ calls }), command));
      yield* Deferred.await(started);
      stopRun(calls, 'The agent harness was disposed.');
      expect(yield* Fiber.join(waiter)).toMatchObject({
        output: { status: 'cancelled', reason: 'The agent harness was disposed.', output: 'read_terminal_operation launch-1' },
      });
    }),
  );
  it.effect(
    'a prepared mutation stopped before dispatch is cancelled without executing',
    Effect.fnUntraced(function* () {
      const calls = yield* makeCalls();
      const changing = Tool.make({
        display: () => ({ form: 'none' }),
        approval: ASKS_NEVER,
        description: 'Change an entry.',
        parameters: Schema.Struct({}),
        mutates: true,
        execute: () => Effect.die('A stopped invocation must not execute.'),
      });
      const door = doorOver({ calls });
      const prepared = yield* door.preflight({ name: 'slow', tool: changing, input: {}, toolCallId: 'call-1' });
      yield* calls.control(address, { action: 'stop' });
      expect(
        yield* door.settle({ name: 'slow', tool: changing, input: {}, options: { toolCallId: 'call-1', messages: [] } }, prepared),
      ).toMatchObject({
        executed: false,
        verdict: { kind: 'cancelled' },
        output: { status: 'cancelled', output: null },
      });
    }),
  );
  it.effect(
    'stopping one call answers that call, and the run it belongs to is untouched',
    Effect.fnUntraced(function* () {
      const calls = yield* makeCalls();
      const started = yield* Deferred.make<void>();
      const held = yield* Deferred.make<void>();
      const slow = Tool.make({
        display: () => ({ form: 'none' }),
        approval: ASKS_NEVER,
        description: 'Run until stopped.',
        parameters: Schema.Struct({}),
        mutates: true,
        execute: () => running(started, held),
      });
      const fiber = yield* Effect.forkScoped(settle(doorOver({ calls }), slow));
      yield* Deferred.await(started);
      expect((yield* calls.control(address, { action: 'stop' })).status).toBe('changed');
      expect(yield* Fiber.join(fiber)).toMatchObject({
        executed: true,
        verdict: { kind: 'unknown' },
        output: { status: 'cancelled', reason: 'Stopped by the operator.' },
      });
      expect(calls.snapshot()[0]).toMatchObject({ phase: 'stopped', toolCallId: 'call-1' });
      const quick = Tool.make({
        display: () => ({ form: 'none' }),
        approval: ASKS_NEVER,
        description: 'Answer.',
        parameters: Schema.Struct({}),
        execute: () => Effect.succeed('done'),
      });
      expect(yield* settle(doorOver({ calls }), quick, 'call-2')).toMatchObject({ executed: true, output: 'done' });
    }),
  );
  it.effect(
    "a watching call answers that its wait ended when the operator's words arrive",
    Effect.fnUntraced(function* () {
      const calls = yield* makeCalls();
      const started = yield* Deferred.make<void>();
      const held = yield* Deferred.make<void>();
      const watch = Tool.make({
        display: () => ({ form: 'none' }),
        approval: ASKS_NEVER,
        description: 'Wait for independent work.',
        parameters: Schema.Struct({}),
        execute: (_input, call) => Effect.sync(() => call.progress?.watch()).pipe(Effect.andThen(running(started, held))),
      });
      const fiber = yield* Effect.forkScoped(settle(doorOver({ calls }), watch));
      yield* Deferred.await(started);
      calls.giveWay('run-1', 'words');
      expect(yield* Fiber.join(fiber)).toMatchObject({
        executed: true,
        verdict: { kind: 'answered' },
        output: { status: 'wait-ended', reason: WORDS_ENDED_WAIT },
      });
    }),
  );
  it.effect(
    'a call handed to the background answers a receipt, keeps running and completes later',
    Effect.fnUntraced(function* () {
      const calls = yield* makeCalls();
      const started = yield* Deferred.make<void>();
      const held = yield* Deferred.make<void>();
      const completed = yield* Deferred.make<{
        record: CallRecord;
        output: unknown;
      }>();
      const order: string[] = [];
      const slow = Tool.make({
        display: () => ({ form: 'none' }),
        approval: ASKS_NEVER,
        description: 'Run until released.',
        parameters: Schema.Struct({}),
        execute: () =>
          Effect.andThen(
            Effect.sync(() => order.push('body')),
            running(started, held),
          ),
      });
      const outputs: AgentToolOutputs = {
        project: ({ output }) =>
          Effect.sync(() => {
            order.push('project');
            return { output, modelOutput: { type: 'text', value: 'the call answered' } };
          }),
        projectMessages: (messages) => Effect.succeed(messages),
      };
      const hooks: CallHooks = {
        retain: () =>
          Effect.sync(() => {
            order.push('retain');
            return { release: Effect.sync(() => order.push('release')) };
          }),
        completed: (record, exit) =>
          Effect.andThen(
            Effect.sync(() => order.push('completed')),
            Deferred.succeed(completed, { record, output: Exit.isSuccess(exit) ? exit.value.output : undefined }),
          ).pipe(Effect.asVoid),
      };
      const fiber = yield* Effect.forkScoped(settle(doorOver({ calls, hooks, outputs }), slow));
      yield* Deferred.await(started);
      expect((yield* calls.control(address, { action: 'background' })).status).toBe('changed');
      expect(yield* Fiber.join(fiber)).toMatchObject({ executed: true, output: { status: 'running', ...address } });
      yield* Deferred.succeed(held, undefined);
      const landed = yield* Deferred.await(completed);
      yield* calls.get(address)!.settled;
      expect(landed.output).toEqual({ done: true });
      expect(landed.record.mode).toBe('background');
      expect(calls.snapshot()[0]).toMatchObject({ mode: 'background', phase: 'completed' });
      expect(order).toEqual(['retain', 'body', 'project', 'release', 'completed']);
    }),
  );
  it.effect(
    'a parked adoption receipt keeps the source until the late outcome is preserved and delivered',
    Effect.fnUntraced(function* () {
      const calls = yield* makeCalls();
      const settlements = yield* makeCallSettlements;
      const delivering = yield* Deferred.make<void>();
      const delivered = yield* Deferred.make<void>();
      let source = 'complete producer output';
      let preserved = '';
      const tool = Tool.make({
        display: () => ({ form: 'none' }),
        approval: ASKS_NEVER,
        description: 'Return a retained source.',
        parameters: Schema.Struct({}),
        execute: () => Effect.succeed('source address').pipe(agentSpan({ type: 'directory', threadId: 'thread-1' })),
        settled: () => {
          source = '';
        },
      });
      const outputs: AgentToolOutputs = {
        project: () =>
          Effect.sync(() => {
            preserved = source;
            return { output: preserved, modelOutput: { type: 'text', value: preserved } };
          }),
        projectMessages: (messages) => Effect.succeed(messages),
      };
      const door = doorOver({
        calls,
        settlements,
        outputs,
        hooks: {
          retain: () => Effect.succeed({ release: Effect.void }),
          detaching: () => Effect.void,
          asking: () => Effect.succeed({ allowed: true }),
          completed: () => Deferred.succeed(delivering, undefined).pipe(Effect.andThen(Deferred.await(delivered))),
        },
      });
      const call = { name: 'retained', tool, input: {}, toolCallId: 'call-1' };
      const adoption = yield* Effect.gen(function* () {
        return yield* door.adopt({ ...call, options: { toolCallId: call.toolCallId, messages: [] } }, yield* door.approved(call));
      }).pipe(
        agentSpan({ type: 'tool-call', runId: 'run-2', toolName: 'control_call', toolCallId: 'control', executedBy: 'host' }),
        agentSpan({ type: 'run', runId: 'run-2' }),
      );
      if ('refused' in adoption) return yield* Effect.die(adoption.refused);
      settlements.recorded('run-1', 'call-1');
      yield* adoption.live;
      yield* Deferred.await(delivering);
      const atDelivery = source;
      yield* Deferred.succeed(delivered, undefined);
      yield* adoption.settled;
      expect(preserved).toBe('complete producer output');
      expect(atDelivery).toBe('complete producer output');
      expect(source).toBe('');
      expect(settlements.size).toBe(0);
    }),
  );
  it.effect(
    'a stopped detached call retains its read-back until its outcome is delivered after the run ends',
    Effect.fnUntraced(function* () {
      const calls = yield* makeCalls();
      const settlements = yield* makeCallSettlements;
      const started = yield* Deferred.make<void>();
      const delivering = yield* Deferred.make<void>();
      const delivered = yield* Deferred.make<void>();
      const held = new Set(['call-1']);
      const slow = Tool.make({
        display: () => ({ form: 'none' }),
        approval: ASKS_NEVER,
        description: 'Run until stopped.',
        parameters: Schema.Struct({}),
        execute: () => Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
        settled: ({ toolCallId }) => {
          held.delete(toolCallId);
        },
      });
      const hooks: CallHooks = {
        retain: () => Effect.succeed({ release: Effect.void }),
        completed: () => Deferred.succeed(delivering, undefined).pipe(Effect.andThen(Deferred.await(delivered))),
      };
      yield* Effect.gen(function* () {
        const fiber = yield* Effect.forkScoped(settle(doorOver({ calls, hooks }), slow));
        yield* Deferred.await(started);
        yield* calls.control(address, { action: 'background' });
        yield* Fiber.join(fiber);
        settlements.recorded('run-1', 'call-1');
        settlements.ended('run-1');
        expect(settlements.size).toBe(1);
        expect([...held]).toEqual(['call-1']);
        yield* calls.control(address, { action: 'stop' });
        yield* Deferred.await(delivering);
        expect([...held]).toEqual(['call-1']);
        yield* Deferred.succeed(delivered, undefined);
        yield* calls.get(address)!.settled;
        expect([...held]).toEqual([]);
        expect(settlements.size).toBe(0);
      }).pipe(Effect.provideService(ToolSettlements, settlements));
    }),
  );
  it.effect(
    'a tool’s own receipt replaces the door’s and its result still lands later',
    Effect.fnUntraced(function* () {
      const calls = yield* makeCalls();
      const started = yield* Deferred.make<void>();
      const held = yield* Deferred.make<void>();
      const completed = yield* Deferred.make<unknown>();
      const display: ToolDisplay = {
        form: 'command',
        command: 'sleep 9',
        reference: { kind: 'command', execution: 'exec-1', incarnation: 1, standing: true },
      };
      const slow = Tool.make({
        display: () => ({ form: 'none' }),
        approval: ASKS_NEVER,
        description: 'Run until released.',
        parameters: Schema.Struct({}),
        execute: () => running(started, held),
        receipt: ({ toolCallId }) => new Tool.ToolAnswer(toolCallId === 'call-1' ? 'exec-1:1' : 'wrong-call', display),
      });
      const hooks: CallHooks = {
        retain: () => Effect.succeed({ release: Effect.void }),
        completed: (_record, exit) => Deferred.succeed(completed, Exit.isSuccess(exit) ? exit.value.output : undefined).pipe(Effect.asVoid),
      };
      const fiber = yield* Effect.forkScoped(settle(doorOver({ calls, hooks }), slow));
      yield* Deferred.await(started);
      yield* calls.control(address, { action: 'background' });
      expect(yield* Fiber.join(fiber)).toMatchObject({
        executed: true,
        output: 'exec-1:1',
        modelOutput: { type: 'text', value: 'exec-1:1' },
        display: { form: 'command', reference: { kind: 'command', execution: 'exec-1', incarnation: 1, standing: true } },
      });
      yield* Deferred.succeed(held, undefined);
      expect(yield* Deferred.await(completed)).toEqual({ done: true });
      yield* calls.get(address)!.settled;
    }),
  );
  it.effect(
    'a receipt with nothing to name yet leaves the door’s own receipt standing',
    Effect.fnUntraced(function* () {
      const calls = yield* makeCalls();
      const started = yield* Deferred.make<void>();
      const held = yield* Deferred.make<void>();
      const slow = Tool.make({
        display: () => ({ form: 'none' }),
        approval: ASKS_NEVER,
        description: 'Run until released.',
        parameters: Schema.Struct({}),
        execute: () => running(started, held),
        receipt: () => undefined,
      });
      const hooks: CallHooks = { retain: () => Effect.succeed({ release: Effect.void }), completed: () => Effect.void };
      const fiber = yield* Effect.forkScoped(settle(doorOver({ calls, hooks }), slow));
      yield* Deferred.await(started);
      yield* calls.control(address, { action: 'background' });
      expect(yield* Fiber.join(fiber)).toMatchObject({ executed: true, output: { status: 'running', ...address } });
      yield* Deferred.succeed(held, undefined);
      yield* calls.get(address)!.settled;
    }),
  );
  describe('the background field', () => {
    const slowOver = (started: Deferred.Deferred<void>, held: Deferred.Deferred<void>, order: string[]) =>
      Tool.make({
        display: () => ({ form: 'none' }),
        approval: ASKS_NEVER,
        description: 'Run until released.',
        parameters: Schema.Struct({}),
        execute: () =>
          Effect.andThen(
            Effect.sync(() => order.push('body')),
            running(started, held),
          ),
      });
    const hooksOver = (
      order: string[],
      landed: Deferred.Deferred<unknown>,
      detaching: () => Effect.Effect<void, AgentHostFailed> = () => Effect.void,
    ): CallHooks => ({
      retain: () => Effect.succeed({ release: Effect.void }),
      detaching: () =>
        Effect.andThen(
          detaching(),
          Effect.sync(() => order.push('owed')),
        ),
      completed: (_record, exit) =>
        Effect.andThen(
          Effect.sync(() => order.push('completed')),
          Deferred.succeed(landed, Exit.isSuccess(exit) ? exit.value.output : undefined),
        ).pipe(Effect.asVoid),
    });
    const called = (door: AgentToolDoor<Ctx>, tool: Tool.Tool, input: unknown) =>
      door.settle({ name: 'slow', tool, input, options: { toolCallId: 'call-1', messages: [] } });
    it.effect(
      'background true answers at dispatch, owes the outcome first, and delivers it at the end',
      Effect.fnUntraced(function* () {
        const calls = yield* makeCalls();
        const started = yield* Deferred.make<void>();
        const held = yield* Deferred.make<void>();
        const landed = yield* Deferred.make<unknown>();
        const order: string[] = [];
        const receipt = yield* called(doorOver({ calls, hooks: hooksOver(order, landed) }), slowOver(started, held, order), {
          background: true,
        });
        expect(receipt).toMatchObject({ executed: true, output: { status: 'running', ...address } });
        expect(order).toEqual(['body', 'owed']);
        yield* Deferred.succeed(held, undefined);
        expect(yield* Deferred.await(landed)).toEqual({ done: true });
        yield* calls.get(address)!.settled;
        expect(order).toEqual(['body', 'owed', 'completed']);
        expect(calls.snapshot()[0]).toMatchObject({ mode: 'background', phase: 'completed' });
      }),
    );
    it.effect(
      'a call without the field answers in place',
      Effect.fnUntraced(function* () {
        const calls = yield* makeCalls();
        const started = yield* Deferred.make<void>();
        const held = yield* Deferred.make<void>();
        const landed = yield* Deferred.make<unknown>();
        const order: string[] = [];
        const fiber = yield* Effect.forkScoped(
          called(doorOver({ calls, hooks: hooksOver(order, landed) }), slowOver(started, held, order), {}),
        );
        yield* Deferred.await(started);
        yield* Deferred.succeed(held, undefined);
        expect(yield* Fiber.join(fiber)).toMatchObject({ executed: true, output: { done: true } });
        expect(order).toEqual(['body']);
        expect(calls.snapshot()[0]).toMatchObject({ mode: 'foreground', phase: 'completed' });
      }),
    );
    it.effect(
      'a call whose outcome cannot be recorded as owed stays in the foreground and answers in place',
      Effect.fnUntraced(function* () {
        const calls = yield* makeCalls();
        const started = yield* Deferred.make<void>();
        const held = yield* Deferred.make<void>();
        const landed = yield* Deferred.make<unknown>();
        const order: string[] = [];
        const refused = () => Effect.fail(new AgentHostFailed({ port: 'tools', cause: new Error('the store is down') }));
        const fiber = yield* Effect.forkScoped(
          called(doorOver({ calls, hooks: hooksOver(order, landed, refused) }), slowOver(started, held, order), {}),
        );
        yield* Deferred.await(started);
        expect((yield* calls.control(address, { action: 'background' })).status).toBe('unavailable');
        yield* Deferred.succeed(held, undefined);
        expect(yield* Fiber.join(fiber)).toMatchObject({ executed: true, output: { done: true } });
        expect(order).toEqual(['body']);
        expect(calls.snapshot()[0]).toMatchObject({ mode: 'foreground', phase: 'completed' });
      }),
    );
    it.effect(
      'union input offers the field in each member and decodes with it stripped',
      Effect.fnUntraced(function* () {
        const calls = yield* makeCalls();
        const either = Tool.make({
          display: () => ({ form: 'none' }),
          approval: ASKS_NEVER,
          description: 'Take either shape.',
          parameters: Schema.Union([Schema.Struct({ url: Schema.String }), Schema.Struct({ command: Schema.String })]),
          execute: (input) => Effect.succeed(input),
        });
        const members =
          (
            either.inputSchema as {
              readonly anyOf?: readonly {
                readonly properties: Record<string, unknown>;
              }[];
            }
          ).anyOf ?? [];
        expect(members.map((member) => 'background' in member.properties)).toEqual([true, true]);
        const landed = yield* Deferred.make<unknown>();
        expect(yield* called(doorOver({ calls, hooks: hooksOver([], landed) }), either, { url: 'x', background: false })).toMatchObject({
          output: { url: 'x' },
        });
      }),
    );
    it.effect(
      'a tool’s own background field is neither stripped nor used to detach its call',
      Effect.fnUntraced(function* () {
        const calls = yield* makeCalls();
        const own = Tool.make({
          display: () => ({ form: 'none' }),
          approval: ASKS_NEVER,
          description: 'Echo its own field.',
          parameters: Schema.Struct({ background: Schema.optional(Schema.Boolean) }),
          execute: (input) => Effect.succeed({ own: input.background }),
        });
        const landed = yield* Deferred.make<unknown>();
        expect(yield* called(doorOver({ calls, hooks: hooksOver([], landed) }), own, { background: true })).toMatchObject({
          output: { own: true },
        });
        expect(calls.snapshot()[0]).toMatchObject({ mode: 'foreground' });
      }),
    );
    it.effect(
      'a body ending while the hand-off records its debt answers the receipt and delivers once',
      Effect.fnUntraced(function* () {
        const calls = yield* makeCalls();
        const started = yield* Deferred.make<void>();
        const held = yield* Deferred.make<void>();
        const recording = yield* Deferred.make<void>();
        const recorded = yield* Deferred.make<void>();
        const released = yield* Deferred.make<void>();
        const landed = yield* Deferred.make<unknown>();
        const order: string[] = [];
        const hooks = {
          ...hooksOver(order, landed, () => Effect.andThen(Deferred.succeed(recording, undefined), Deferred.await(recorded))),
          retain: () => Effect.succeed({ release: Deferred.succeed(released, undefined).pipe(Effect.asVoid) }),
        };
        const fiber = yield* Effect.forkScoped(called(doorOver({ calls, hooks }), slowOver(started, held, order), { background: true }));
        yield* Deferred.await(recording);
        yield* Deferred.succeed(held, undefined);
        yield* Deferred.await(released);
        expect(yield* Deferred.isDone(landed)).toBe(false);
        yield* Deferred.succeed(recorded, undefined);
        expect(yield* Fiber.join(fiber)).toMatchObject({ output: { status: 'running' } });
        expect(yield* Deferred.await(landed)).toEqual({ done: true });
        yield* calls.get(address)!.settled;
        expect(order).toEqual(['body', 'owed', 'completed']);
      }),
    );
  });
  it.effect(
    'a foreground call takes its resources before the body and releases them at its ending',
    Effect.fnUntraced(function* () {
      const calls = yield* makeCalls();
      const order: string[] = [];
      const quick = Tool.make({
        display: () => ({ form: 'none' }),
        approval: ASKS_NEVER,
        description: 'Answer once.',
        parameters: Schema.Struct({}),
        execute: () =>
          Effect.sync(() => {
            order.push('body');
            return { done: true };
          }),
      });
      const hooks: CallHooks = {
        retain: () =>
          Effect.sync(() => {
            order.push('retain');
            return { release: Effect.sync(() => order.push('release')) };
          }),
        completed: () => Effect.sync(() => order.push('completed')),
      };
      expect(yield* settle(doorOver({ calls, hooks }), quick)).toMatchObject({ executed: true, output: { done: true } });
      expect(order).toEqual(['retain', 'body', 'release']);
      expect(calls.snapshot()[0]).toMatchObject({ phase: 'completed', mode: 'foreground' });
    }),
  );
  it.effect(
    'a lifetime that could not be taken fails the call and runs nothing',
    Effect.fnUntraced(function* () {
      const calls = yield* makeCalls();
      let ran = false;
      const quick = Tool.make({
        display: () => ({ form: 'none' }),
        approval: ASKS_NEVER,
        description: 'Answer once.',
        parameters: Schema.Struct({}),
        execute: () =>
          Effect.sync(() => {
            ran = true;
            return { done: true };
          }),
      });
      const hooks: CallHooks = {
        retain: () => Effect.fail(new AgentHostFailed({ port: 'tools', cause: new Error('no world stands here') })),
        completed: () => Effect.void,
      };
      expect(yield* failing(doorOver({ calls, hooks }), quick)).toMatchObject({ _tag: 'AgentToolFailed', toolCallId: 'call-1' });
      expect(ran).toBe(false);
      expect(calls.snapshot()[0]).toMatchObject({ phase: 'failed' });
    }),
  );
  it.effect(
    'a stop during preparation fails the call as a tool failure, never as a run abort',
    Effect.fnUntraced(function* () {
      const calls = yield* makeCalls();
      const reading = yield* Deferred.make<void>();
      const slowToRead = Tool.make({
        display: () => ({ form: 'none' }),
        approval: ASKS_NEVER,
        description: 'Wait for a reader.',
        parameters: Schema.Struct({}),
        prepare: () => Deferred.succeed(reading, undefined).pipe(Effect.andThen(Effect.never)),
        execute: () => Effect.succeed({ done: true }),
      });
      const door = doorOver({ calls });
      const placed = { toolCallId: 'call-1', name: 'slow', claims: [NOTES_WRITE] };
      door.order.place([placed]);
      const fiber = yield* Effect.forkScoped(failing(door, slowToRead));
      yield* Deferred.await(reading);
      yield* calls.control(address, { action: 'stop' });
      expect(yield* Fiber.join(fiber)).toMatchObject({
        _tag: 'AgentToolFailed',
        cause: { _tag: 'Tool.Failed', reason: 'Stopped by the operator.' },
      });
      expect(calls.snapshot()[0]).toMatchObject({ phase: 'stopped' });
      door.order.place([placed, { toolCallId: 'call-2', name: 'write', claims: [NOTES_WRITE] }]);
      const next = Tool.make({
        display: () => ({ form: 'none' }),
        approval: ASKS_NEVER,
        description: 'Write after the stopped call.',
        parameters: Schema.Struct({}),
        execute: () => Effect.succeed({ written: true }),
      });
      expect(yield* settle(door, next, 'call-2')).toMatchObject({ executed: true, output: { written: true } });
    }),
  );
  it.effect(
    'a door without a call owner returns the tool’s outcome',
    Effect.fnUntraced(function* () {
      const quick = Tool.make({
        display: () => ({ form: 'none' }),
        approval: ASKS_NEVER,
        description: 'Answer once.',
        parameters: Schema.Struct({}),
        execute: () => Effect.succeed({ done: true }),
      });
      expect(yield* settle(doorOver(), quick)).toMatchObject({ executed: true, output: { done: true } });
    }),
  );
  it.effect(
    'a rebuilt door cannot run the same call twice',
    Effect.fnUntraced(function* () {
      const calls = yield* makeCalls();
      let ran = 0;
      const once = Tool.make({
        display: () => ({ form: 'none' }),
        approval: ASKS_NEVER,
        description: 'Run one side effect.',
        parameters: Schema.Struct({}),
        execute: () =>
          Effect.sync(() => {
            ran++;
            return { done: true };
          }),
      });
      expect(yield* settle(doorOver({ calls }), once)).toMatchObject({ executed: true, output: { done: true } });
      expect(yield* failing(doorOver({ calls }), once)).toMatchObject({ _tag: 'AgentToolFailed' });
      expect(ran).toBe(1);
      expect(calls.snapshot()).toHaveLength(1);
    }),
  );
  it.effect(
    'interrupting a running call’s waiter interrupts its body before releasing its resources',
    Effect.fnUntraced(function* () {
      const calls = yield* makeCalls();
      const started = yield* Deferred.make<void>();
      const held = yield* Deferred.make<void>();
      const order: string[] = [];
      const slow = Tool.make({
        display: () => ({ form: 'none' }),
        approval: ASKS_NEVER,
        description: 'Run until released.',
        parameters: Schema.Struct({}),
        execute: () =>
          Effect.andThen(
            Effect.sync(() => order.push('body')),
            running(started, held),
          ).pipe(Effect.ensuring(Effect.sync(() => order.push('end')))),
      });
      const hooks: CallHooks = {
        retain: () =>
          Effect.sync(() => {
            order.push('retain');
            return { release: Effect.sync(() => order.push('release')) };
          }),
        completed: () => Effect.sync(() => order.push('completed')),
      };
      const waiter = yield* Effect.forkScoped(settle(doorOver({ calls, hooks }), slow));
      yield* Deferred.await(started);
      yield* Fiber.interrupt(waiter);
      yield* calls.get(address)!.settled;
      expect(order).toEqual(['retain', 'body', 'end', 'release']);
      expect(calls.snapshot()[0]).toMatchObject({ phase: 'stopped' });
    }),
  );
  it.effect(
    'a detached call holds its write over a later step and its settlement unresolved until its work ends',
    Effect.fnUntraced(function* () {
      const calls = yield* makeCalls();
      const started = yield* Deferred.make<void>();
      const held = yield* Deferred.make<void>();
      const writing = Tool.make({
        display: () => ({ form: 'none' }),
        approval: ASKS_IN_REVIEW,
        description: 'Write one file.',
        parameters: Schema.Struct({}),
        claims: () => Effect.succeed([NOTES_WRITE]),
        execute: () => running(started, held),
      });
      const door = doorOver({ calls });
      door.order.place([{ toolCallId: 'call-1', name: 'slow', claims: [NOTES_WRITE] }]);
      const waiter = yield* Effect.forkScoped(settle(door, writing));
      yield* Deferred.await(started);
      const ended = yield* Deferred.make<void>();
      yield* Effect.forkScoped(calls.get(address)!.settled.pipe(Effect.andThen(Deferred.succeed(ended, undefined))), {
        startImmediately: true,
      });
      expect((yield* calls.control(address, { action: 'background' })).status).toBe('changed');
      expect(yield* Fiber.join(waiter)).toMatchObject({ executed: true, output: { status: 'running', ...address } });
      door.order.place([{ toolCallId: 'call-2', name: 'read', claims: [{ on: NOTES_WRITE.on, access: 'read' }] }]);
      expect(door.order.blockers('call-2')).toEqual([{ toolCallId: 'call-1', toolName: 'slow', on: NOTES }]);
      expect(yield* Deferred.isDone(ended)).toBe(false);
      yield* Deferred.succeed(held, undefined);
      yield* Deferred.await(ended);
      expect(door.order.blockers('call-2')).toEqual([]);
    }),
  );
  it.live(
    'a call queued behind an earlier write runs its envelope from admission',
    Effect.fnUntraced(function* () {
      const calls = yield* makeCalls(40);
      const quick = Tool.make({
        display: () => ({ form: 'none' }),
        approval: ASKS_NEVER,
        description: 'Take a moment, then answer.',
        parameters: Schema.Struct({}),
        claims: () => Effect.succeed([{ on: NOTES_WRITE.on, access: 'read' as const }]),
        execute: () => Effect.sleep('10 millis').pipe(Effect.as({ done: true })),
      });
      const door = doorOver({ calls });
      door.order.place([
        { toolCallId: 'call-0', name: 'write', claims: [NOTES_WRITE] },
        { toolCallId: 'call-1', name: 'slow', claims: [{ on: NOTES_WRITE.on, access: 'read' }] },
      ]);
      yield* Effect.forkScoped(
        Effect.delay(
          Effect.sync(() => door.order.release('call-0')),
          '60 millis',
        ),
      );
      const prepared = yield* door.preflight({ name: 'slow', tool: quick, input: {}, toolCallId: 'call-1' });
      const settled = yield* door.settle(
        { name: 'slow', tool: quick, input: {}, options: { toolCallId: 'call-1', messages: [] } },
        prepared,
      );
      const record = calls.get(address)!.record;
      expect(settled).toMatchObject({ executed: true, output: { done: true } });
      expect(record.phase).toBe('completed');
      expect(record.admittedAt! - record.startedAt).toBeGreaterThanOrEqual(50);
    }),
  );
  it.effect(
    'a queued call offers neither background nor a limit, then reports its admission with what it waited for',
    Effect.fnUntraced(function* () {
      const calls = yield* makeCalls();
      const started = yield* Deferred.make<void>();
      const held = yield* Deferred.make<void>();
      const facts: CallAdmission[] = [];
      const control = (action: CallControl) => calls.control(address, action);
      const tool = Tool.make({
        display: () => ({ form: 'none' }),
        approval: ASKS_NEVER,
        description: 'Run until released.',
        parameters: Schema.Struct({}),
        claims: () => Effect.succeed([{ on: NOTES_WRITE.on, access: 'read' as const }]),
        execute: () => running(started, held),
      });
      const door = doorOver({ calls });
      door.order.place([
        { toolCallId: 'call-0', name: 'write', claims: [NOTES_WRITE] },
        { toolCallId: 'call-1', name: 'slow', claims: [{ on: NOTES_WRITE.on, access: 'read' }] },
      ]);
      const fiber = yield* Effect.forkScoped(
        Effect.flatMap(door.preflight({ name: 'slow', tool, input: {}, toolCallId: 'call-1' }), (prepared) =>
          door.settle(
            {
              name: 'slow',
              tool,
              input: {},
              options: { toolCallId: 'call-1', messages: [] },
              onExecution: (fact) => Effect.sync(() => facts.push(fact)),
            },
            prepared,
          ),
        ),
      );
      yield* awaitPhase(calls, 'waiting');
      expect(calls.get(address)!.record).toMatchObject({
        phase: 'waiting',
        detail: 'after write today.md',
        detachable: false,
        admittedAt: null,
      });
      expect((yield* control({ action: 'background' })).status).toBe('unavailable');
      expect((yield* control({ action: 'limit', milliseconds: 1000 })).status).toBe('unavailable');
      door.order.release('call-0');
      yield* Deferred.await(started);
      const admitted = calls.get(address)!.record;
      expect(admitted).toMatchObject({ phase: 'running', detachable: true, limitCeilingMs: LONGEST_ACT_MS });
      expect(facts).toEqual([
        {
          state: 'started',
          at: admitted.admittedAt ?? Number.NaN,
          mutates: false,
          after: [{ toolCallId: 'call-0', toolName: 'write', on: NOTES }],
          waitedMs: expect.any(Number),
        },
      ]);
      expect((yield* control({ action: 'limit', milliseconds: LONGEST_ACT_MS + 1 })).status).toBe('unavailable');
      yield* Deferred.succeed(held, undefined);
      expect(yield* Fiber.join(fiber)).toMatchObject({ executed: true, output: { done: true } });
    }),
  );
  it.effect(
    'a call whose start cannot be recorded fails without its body running',
    Effect.fnUntraced(function* () {
      const calls = yield* makeCalls();
      let bodies = 0;
      const tool = Tool.make({
        display: () => ({ form: 'none' }),
        approval: ASKS_NEVER,
        description: 'Count its runs.',
        parameters: Schema.Struct({}),
        execute: () => Effect.sync(() => ++bodies),
      });
      const outcome = yield* Effect.flip(
        doorOver({ calls }).settle({
          name: 'slow',
          tool,
          input: {},
          options: { toolCallId: 'call-1', messages: [] },
          onExecution: (fact) =>
            fact.state === 'started'
              ? Effect.fail(new AgentToolFailed({ toolName: 'slow', toolCallId: 'call-1', cause: new Error('the record refused') }))
              : Effect.void,
        }),
      );
      expect(outcome).toBeInstanceOf(AgentToolFailed);
      expect(bodies).toBe(0);
      expect(calls.get(address)?.record.phase).toBe('failed');
    }),
  );
  it.effect(
    'a declined call ends its invocation and releases what it claimed',
    Effect.fnUntraced(function* () {
      const calls = yield* makeCalls();
      const writing = Tool.make({
        display: () => ({ form: 'none' }),
        approval: ASKS_IN_REVIEW,
        description: 'Write one file.',
        parameters: Schema.Struct({}),
        claims: () => Effect.succeed([NOTES_WRITE]),
        execute: () => Effect.succeed({ done: true }),
      });
      const door = doorOver({ calls });
      door.order.place([{ toolCallId: 'call-1', name: 'slow', claims: [NOTES_WRITE] }]);
      yield* door.preflight({ name: 'slow', tool: writing, input: {}, toolCallId: 'call-1' });
      door.order.place([{ toolCallId: 'call-2', name: 'read', claims: [{ on: NOTES_WRITE.on, access: 'read' }] }]);
      expect(door.order.blockers('call-2')).toHaveLength(1);
      door.decline('call-1', 'An earlier write still needs approval.');
      expect(door.order.blockers('call-2')).toEqual([]);
      expect(calls.get(address)?.record).toMatchObject({ phase: 'failed', endedAt: expect.any(Number) });
    }),
  );
  it.effect(
    'hooks that cannot be built leave no published call behind',
    Effect.fnUntraced(function* () {
      const calls = yield* makeCalls();
      const door = openToolDoor<Ctx>(
        'run-1',
        callerInThread('thread-1', 'run-1'),
        {},
        new ToolJudge(builtinMode('trust')),
        undefined,
        undefined,
        undefined,
        undefined,
        calls,
        () => {
          throw new Error('hooks broke');
        },
      );
      const idle = Tool.make({
        display: () => ({ form: 'none' }),
        approval: ASKS_NEVER,
        description: 'Never reached.',
        parameters: Schema.Struct({}),
        execute: () => Effect.succeed({ done: true }),
      });
      const exit = yield* Effect.exit(door.preflight({ name: 'slow', tool: idle, input: {}, toolCallId: 'call-1' }));
      expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true);
      expect(calls.get(address)).toBeUndefined();
    }),
  );
});
describe('a call taken to the background before it runs', () => {
  type Landed = Exit.Exit<AgentToolOutcome, AgentToolFailure>;
  const owing = (log: string[], landed: Deferred.Deferred<Landed>, asking?: CallHooks['asking']): CallHooks => ({
    retain: () => Effect.succeed({ release: Effect.sync(() => log.push('released')) }),
    detaching: () => Effect.sync(() => log.push('owed')),
    began: () => Effect.sync(() => log.push('began')),
    asking: asking ?? (() => Effect.die('No reader is asked in this scenario.')),
    completed: (_record, exit) =>
      Effect.andThen(
        Effect.sync(() => log.push('completed')),
        Deferred.succeed(landed, exit),
      ).pipe(Effect.asVoid),
  });
  const preparedOver = (
    prepared: Deferred.Deferred<void>,
    release: Effect.Effect<void, Tool.ToolFailed>,
    log: string[],
    approval = ASKS_NEVER,
    settled?: () => void,
  ) =>
    Tool.make({
      display: () => ({ form: 'none' }),
      approval,
      description: 'Prepare slowly, then change one thing.',
      parameters: Schema.Struct({}),
      mutates: true,
      prepare: () => Deferred.succeed(prepared, undefined).pipe(Effect.andThen(release), Effect.as({ subjects: [] })),
      execute: () => Effect.sync(() => log.push('body')).pipe(Effect.as({ done: true })),
      settled,
    });
  const attend = (door: AgentToolDoor<Ctx>, tool: Tool.Tool, input: unknown, confirming?: true) =>
    door.attend({ name: 'slow', tool, input, confirming, options: { toolCallId: 'call-1', messages: [] } });
  const outcomeOf = (landed: Landed) => (Exit.isSuccess(landed) ? landed.value : undefined);
  it.effect.each(['answered', 'refused'] as const)(
    'background asked answers its receipt while the preparation is still held, then delivers what the preparation led to once (%s)',
    Effect.fnUntraced(function* (ending) {
      const calls = yield* makeCalls();
      const log: string[] = [];
      const landed = yield* Deferred.make<Landed>();
      const preparing = yield* Deferred.make<void>();
      const held = yield* Deferred.make<void>();
      const release =
        ending === 'answered'
          ? Deferred.await(held)
          : Effect.andThen(Deferred.await(held), Effect.fail(new Tool.ToolFailed({ reason: 'the target is gone' })));
      const door = doorOver({ calls, hooks: owing(log, landed) });
      const attended = yield* attend(door, preparedOver(preparing, release, log), { background: true });
      expect(attended).toMatchObject({ kind: 'answered', outcome: { executed: true, output: { status: 'background', ...address } } });
      expect(calls.get(address)!.record).toMatchObject({ mode: 'background', admittedAt: null });
      yield* Deferred.await(preparing);
      expect(log).toEqual(['owed']);
      yield* Deferred.succeed(held, undefined);
      const delivered = yield* Deferred.await(landed);
      yield* calls.get(address)!.settled;
      if (ending === 'answered') {
        expect(outcomeOf(delivered)).toMatchObject({ executed: true, output: { done: true } });
        expect(log).toEqual(['owed', 'began', 'body', 'released', 'completed']);
        expect(calls.get(address)!.record.phase).toBe('completed');
      } else {
        expect(Exit.isFailure(delivered)).toBe(true);
        expect(log).toEqual(['owed', 'released', 'completed']);
        expect(calls.get(address)!.record.phase).toBe('failed');
      }
    }),
  );
  it.effect.each([true, false])(
    'a call in the background asks its reader without the turn and runs only on the word (allowed: %p)',
    Effect.fnUntraced(function* (allowed) {
      const calls = yield* makeCalls();
      const log: string[] = [];
      const landed = yield* Deferred.make<Landed>();
      const asked = yield* Deferred.make<boolean>();
      const word = yield* Deferred.make<AgentCallVerdict>();
      const hooks = owing(log, landed, (_record, question) =>
        Effect.andThen(Deferred.succeed(asked, question.background()), Deferred.await(word)),
      );
      const door = doorOver({ calls, hooks, mode: 'review' });
      const tool = preparedOver(yield* Deferred.make<void>(), Effect.void, log, ASKS_IN_REVIEW);
      const attended = yield* attend(door, tool, { background: true });
      expect(attended).toMatchObject({ kind: 'answered', outcome: { output: { status: 'background' } } });
      expect(yield* Deferred.await(asked)).toBe(true);
      expect(log).toEqual(['owed']);
      yield* Deferred.succeed(
        word,
        allowed ? { allowed: true } : { allowed: false, output: { status: 'refused', reason: 'Declined by the operator.' } },
      );
      const delivered = outcomeOf(yield* Deferred.await(landed));
      yield* calls.get(address)!.settled;
      if (allowed) {
        expect(delivered).toMatchObject({ executed: true, output: { done: true } });
        expect(log).toEqual(['owed', 'began', 'body', 'released', 'completed']);
      } else {
        expect(delivered).toMatchObject({ executed: false, verdict: { kind: 'denied' } });
        expect(log).toEqual(['owed', 'released', 'completed']);
        expect(calls.get(address)!.record.phase).toBe('stopped');
      }
    }),
  );
  it.effect(
    'the operator moves a call waiting for its reader to the background: the question stays and moves with it, and the word runs it',
    Effect.fnUntraced(function* () {
      const calls = yield* makeCalls();
      const log: string[] = [];
      const landed = yield* Deferred.make<Landed>();
      const asked = yield* Deferred.make<AgentCallQuestion>();
      const word = yield* Deferred.make<AgentCallVerdict>();
      const hooks = owing(log, landed, (_record, question) => Effect.andThen(Deferred.succeed(asked, question), Deferred.await(word)));
      const door = doorOver({ calls, hooks, mode: 'review' });
      const tool = preparedOver(yield* Deferred.make<void>(), Effect.void, log, ASKS_IN_REVIEW);
      const attended = yield* attend(door, tool, {});
      if (attended.kind !== 'prepared') return yield* Effect.die('the call should have been prepared in the foreground');
      const waiter = yield* Effect.forkScoped(
        door.settle(
          { name: 'slow', tool, input: {}, confirming: true, options: { toolCallId: 'call-1', messages: [] } },
          attended.prepared,
        ),
      );
      const question = yield* Deferred.await(asked);
      expect(question.background()).toBe(false);
      expect((yield* calls.control(address, { action: 'background' })).status).toBe('changed');
      expect(yield* Fiber.join(waiter)).toMatchObject({ executed: true, output: { status: 'background' } });
      yield* question.moved;
      expect(question.background()).toBe(true);
      expect(log).toEqual(['owed']);
      yield* Deferred.succeed(word, { allowed: true });
      expect(outcomeOf(yield* Deferred.await(landed))).toMatchObject({ executed: true, output: { done: true } });
      expect(log).toEqual(['owed', 'began', 'body', 'released', 'completed']);
    }),
  );
  it.effect(
    'the operator moves a call still being prepared to the background, and it runs there once prepared',
    Effect.fnUntraced(function* () {
      const calls = yield* makeCalls();
      const log: string[] = [];
      const landed = yield* Deferred.make<Landed>();
      const preparing = yield* Deferred.make<void>();
      const held = yield* Deferred.make<void>();
      const door = doorOver({ calls, hooks: owing(log, landed), settlements: yield* makeCallSettlements });
      const tool = preparedOver(preparing, Deferred.await(held), log, ASKS_NEVER, () => log.push('settled'));
      const waiter = yield* Effect.forkScoped(attend(door, tool, {}));
      yield* Deferred.await(preparing);
      expect(calls.get(address)!.record).toMatchObject({ phase: 'preparing', detachable: true });
      expect((yield* calls.control(address, { action: 'background' })).status).toBe('changed');
      expect(yield* Fiber.join(waiter)).toMatchObject({ kind: 'answered', outcome: { output: { status: 'background' } } });
      yield* Deferred.succeed(held, undefined);
      expect(outcomeOf(yield* Deferred.await(landed))).toMatchObject({ executed: true, output: { done: true } });
      expect(log).toEqual(['owed', 'began', 'body', 'released', 'completed', 'settled']);
    }),
  );
  it.effect(
    'a call moved during preparation keeps its own run context when the move is requested by another call',
    Effect.fnUntraced(function* () {
      const calls = yield* makeCalls();
      const log: string[] = [];
      const landed = yield* Deferred.make<Landed>();
      const preparing = yield* Deferred.make<void>();
      const held = yield* Deferred.make<void>();
      const tool = Tool.make({
        display: () => ({ form: 'none' }),
        approval: ASKS_NEVER,
        description: 'Prepare and read the directory.',
        parameters: Schema.Struct({}),
        prepare: () => Deferred.succeed(preparing, undefined).pipe(Effect.andThen(Deferred.await(held)), Effect.as({ subjects: [] })),
        execute: () => Effect.succeed({ done: true }).pipe(agentSpan({ type: 'directory', threadId: 'thread-1' })),
      });
      const door = doorOver({ calls, hooks: owing(log, landed) });
      const waiter = yield* Effect.forkScoped(attend(door, tool, {}).pipe(agentSpan({ type: 'run', runId: 'run-1' })));
      yield* Deferred.await(preparing);
      const moved = yield* calls
        .control(address, { action: 'background' })
        .pipe(
          agentSpan({ type: 'tool-call', runId: 'run-2', toolName: 'control_call', toolCallId: 'control', executedBy: 'host' }),
          agentSpan({ type: 'run', runId: 'run-2' }),
        );
      expect(moved.status).toBe('changed');
      expect(yield* Fiber.join(waiter)).toMatchObject({ kind: 'answered', outcome: { output: { status: 'background' } } });
      yield* Deferred.succeed(held, undefined);
      expect(outcomeOf(yield* Deferred.await(landed))).toMatchObject({ executed: true, output: { done: true } });
    }),
  );
  it.effect(
    'a run stop leaves a call taken before it ran; the end of its thread answers it as never run, delivered once',
    Effect.fnUntraced(function* () {
      const calls = yield* makeCalls();
      const log: string[] = [];
      const landed = yield* Deferred.make<Landed>();
      const preparing = yield* Deferred.make<void>();
      const door = doorOver({ calls, hooks: owing(log, landed) });
      yield* attend(door, preparedOver(preparing, Effect.never, log), { background: true });
      yield* Deferred.await(preparing);
      stopRun(calls);
      expect(calls.get(address)!.record).toMatchObject({ mode: 'background', endedAt: null });
      yield* calls.end(['thread-1'], 'scope-closed');
      const delivered = outcomeOf(yield* Deferred.await(landed));
      expect(delivered).toMatchObject({ executed: false, verdict: { kind: 'cancelled' } });
      expect(log).toEqual(['owed', 'released', 'completed']);
      expect(calls.get(address)!.record.phase).toBe('stopped');
    }),
  );
  it.effect.each(['runs', 'waits for its reader'] as const)(
    'a prepared call stays the operator’s to move until its run takes it (%s)',
    Effect.fnUntraced(function* (road) {
      const calls = yield* makeCalls();
      const log: string[] = [];
      const landed = yield* Deferred.make<Landed>();
      const asked = yield* Deferred.make<boolean>();
      const hooks = owing(log, landed, (_record, question) =>
        Effect.as(Deferred.succeed(asked, question.background()), { allowed: true } as const),
      );
      const asking = road === 'waits for its reader';
      const door = doorOver({ calls, hooks, mode: asking ? 'review' : 'trust' });
      const tool = preparedOver(yield* Deferred.make<void>(), Effect.void, log, asking ? ASKS_IN_REVIEW : ASKS_NEVER);
      const attended = yield* attend(door, tool, {});
      if (attended.kind !== 'prepared') return yield* Effect.die('the call should have been prepared in the foreground');
      expect(calls.get(address)!.record).toMatchObject({ phase: 'waiting', detachable: true });
      expect((yield* calls.control(address, { action: 'background' })).status).toBe('changed');
      const invocation = { name: 'slow', tool, input: {}, options: { toolCallId: 'call-1', messages: [] } };
      const taken = asking ? yield* door.keep(invocation) : yield* door.settle(invocation, attended.prepared);
      expect(taken).toMatchObject({ executed: true, output: { status: 'background', ...address } });
      if (asking) expect(yield* Deferred.await(asked)).toBe(true);
      expect(outcomeOf(yield* Deferred.await(landed))).toMatchObject({ executed: true, output: { done: true } });
      expect(log).toEqual(['owed', 'began', 'body', 'released', 'completed']);
    }),
  );
  it.effect.each([
    ['the same run', true],
    ['the same run', false],
    ['a later run', true],
    ['a later run', false],
  ] as const)(
    'a conflicting call of %s queues behind a call taken before it ran and runs after it (allowed: %p)',
    Effect.fnUntraced(function* (where, allowed) {
      const calls = yield* makeCalls();
      const log: string[] = [];
      const landed = yield* Deferred.make<Landed>();
      const word = yield* Deferred.make<AgentCallVerdict>();
      const writing = yield* Deferred.make<void>();
      const hooks = owing(log, landed, () => Deferred.await(word));
      const doorIn = (runId: string) => threadDoor(calls, hooks, runId);
      const tool = (name: string, approval: typeof ASKS_NEVER, started: Effect.Effect<void>) =>
        Tool.make({
          display: () => ({ form: 'none' }),
          approval,
          description: `${name} the notes.`,
          parameters: Schema.Struct({}),
          mutates: true,
          claims: () => Effect.succeed([NOTES_WRITE]),
          execute: () => Effect.sync(() => log.push(name)).pipe(Effect.andThen(started), Effect.as({ done: true })),
        });
      const first = doorIn('run-1');
      first.order.place([{ toolCallId: 'call-1', name: 'write', claims: [NOTES_WRITE] }]);
      const taken = yield* first.attend({
        name: 'write',
        tool: tool('write', ASKS_IN_REVIEW, Deferred.succeed(writing, undefined)),
        input: { background: true },
        options: { toolCallId: 'call-1', messages: [] },
      });
      expect(taken).toMatchObject({ kind: 'answered', outcome: { output: { status: 'background' } } });
      const runId = where === 'the same run' ? 'run-1' : 'run-2';
      if (runId !== 'run-1') yield* first.close();
      const later = runId === 'run-1' ? first : doorIn(runId);
      later.order.place([{ toolCallId: 'call-2', name: 'edit', claims: [NOTES_WRITE] }]);
      expect(later.order.blockers('call-2')).toEqual([{ toolCallId: 'call-1', toolName: 'write', on: NOTES }]);
      const editing = yield* Effect.forkScoped(
        later.settle({
          name: 'edit',
          tool: tool('edit', ASKS_NEVER, Effect.void),
          input: {},
          options: { toolCallId: 'call-2', messages: [] },
        }),
      );
      yield* Effect.yieldNow;
      expect(log).toEqual(['owed']);
      expect(calls.get({ runId, toolCallId: 'call-2' })!.record.phase).toBe('waiting');
      yield* Deferred.succeed(
        word,
        allowed ? { allowed: true } : { allowed: false, output: { status: 'refused', reason: 'Declined by the operator.' } },
      );
      if (allowed) yield* Deferred.await(writing);
      expect(yield* Fiber.join(editing)).toMatchObject({ executed: true, output: { done: true } });
      yield* Deferred.await(landed);
      expect(log.filter((step) => step === 'write' || step === 'edit')).toEqual(allowed ? ['write', 'edit'] : ['edit']);
    }),
  );
  it.effect(
    'a retired door of the run leaves standing the claims another door stood for the same call',
    Effect.fnUntraced(function* () {
      const calls = yield* makeCalls();
      const hooks = owing([], yield* Deferred.make<Landed>());
      const placed = { toolCallId: 'call-1', name: 'write', claims: [NOTES_WRITE] };
      const retired = threadDoor(calls, hooks, 'run-1');
      retired.order.place([placed]);
      const moved = threadDoor(calls, hooks, 'run-1');
      moved.order.place([placed]);
      moved.order.stand('call-1');
      retired.order.clear();
      const later = threadDoor(calls, hooks, 'run-2');
      later.order.place([{ toolCallId: 'call-2', name: 'edit', claims: [NOTES_WRITE] }]);
      expect(later.order.blockers('call-2')).toEqual([{ toolCallId: 'call-1', toolName: 'write', on: NOTES }]);
    }),
  );
  it.effect(
    'a later run’s conflicting call stays queued until the body of a call taken before it ran starts',
    Effect.fnUntraced(function* () {
      const calls = yield* makeCalls();
      const log: string[] = [];
      const landed = yield* Deferred.make<Landed>();
      const beginning = yield* Deferred.make<void>();
      const begin = yield* Deferred.make<void>();
      const hooks: CallHooks = {
        ...owing(log, landed),
        began: () => Effect.andThen(Deferred.succeed(beginning, undefined), Deferred.await(begin)),
      };
      const reading = { on: NOTES_WRITE.on, access: 'read' } as const satisfies Claim;
      const tool = (name: string, claim: Claim) =>
        Tool.make({
          display: () => ({ form: 'none' }),
          approval: ASKS_NEVER,
          description: `${name} the notes.`,
          parameters: Schema.Struct({}),
          claims: () => Effect.succeed([claim]),
          execute: () => Effect.sync(() => log.push(name)).pipe(Effect.as({ done: true })),
        });
      const first = threadDoor(calls, hooks, 'run-1');
      first.order.place([{ toolCallId: 'call-1', name: 'read', claims: [reading] }]);
      yield* first.attend({
        name: 'read',
        tool: tool('read', reading),
        input: { background: true },
        options: { toolCallId: 'call-1', messages: [] },
      });
      yield* first.close();
      yield* Deferred.await(beginning);
      const later = threadDoor(calls, hooks, 'run-2');
      later.order.place([{ toolCallId: 'call-2', name: 'edit', claims: [NOTES_WRITE] }]);
      const editing = yield* Effect.forkScoped(
        later.settle({ name: 'edit', tool: tool('edit', NOTES_WRITE), input: {}, options: { toolCallId: 'call-2', messages: [] } }),
      );
      const edit = { runId: 'run-2', toolCallId: 'call-2' };
      while (true) {
        const record = calls.get(edit)?.record;
        if (record !== undefined && (record.phase === 'waiting' || callEnded(record))) break;
        yield* Effect.yieldNow;
      }
      expect(calls.get(edit)!.record.phase).toBe('waiting');
      expect(log).not.toContain('edit');
      yield* Deferred.succeed(begin, undefined);
      expect(yield* Fiber.join(editing)).toMatchObject({ executed: true });
      yield* Deferred.await(landed);
      expect(log).toEqual(expect.arrayContaining(['read', 'edit']));
    }),
  );
});
describe('the door’s lifetime', () => {
  const question = (tool: Tool.Tool) => ({ name: 'slow', tool, input: {}, toolCallId: 'call-1' });
  it.effect(
    'a close while a call runs answers it and its replay, then ends the door with the call',
    Effect.fnUntraced(function* () {
      const started = yield* Deferred.make<void>();
      const held = yield* Deferred.make<void>();
      let runs = 0;
      const slow = Tool.make({
        display: () => ({ form: 'none' }),
        approval: ASKS_NEVER,
        description: 'Run until released.',
        parameters: Schema.Struct({}),
        execute: () =>
          Effect.andThen(
            Effect.sync(() => (runs += 1)),
            running(started, held),
          ),
      });
      const door = doorOver();
      const first = yield* Effect.forkScoped(settle(door, slow));
      yield* Deferred.await(started);
      const replay = yield* Effect.forkScoped(settle(door, slow), { startImmediately: true });
      yield* door.close();
      expect(door.preflighted(question(slow))).not.toBeNull();
      yield* Deferred.succeed(held, undefined);
      const answered = yield* Fiber.join(first);
      expect(answered.output).toEqual({ done: true });
      expect(yield* Fiber.join(replay)).toEqual(answered);
      expect(runs).toBe(1);
      expect(door.preflighted(question(slow))).toBeNull();
      expect(Exit.isFailure(yield* Effect.exit(settle(door, slow)))).toBe(true);
    }),
  );
  it.effect(
    'a call dispatched after its runner scope closed is interrupted and its door still ends',
    Effect.fnUntraced(function* () {
      const runs = yield* Scope.fork(yield* Effect.scope);
      const calls = yield* Scope.provide(makeAgentCalls({ history: 1 }), runs);
      yield* Scope.close(runs, Exit.void);
      const quick = Tool.make({
        display: () => ({ form: 'none' }),
        approval: ASKS_NEVER,
        description: 'Answer.',
        parameters: Schema.Struct({}),
        execute: () => Effect.succeed({ done: true }),
      });
      const door = doorOver({ calls });
      const settled = yield* Effect.exit(settle(door, quick));
      yield* door.close();
      expect(Exit.isFailure(settled) && Cause.hasInterruptsOnly(settled.cause)).toBe(true);
      expect(door.preflighted(question(quick))).toBeNull();
    }),
  );
  it.effect(
    'a body handed to the background keeps its door until its own cleanup',
    Effect.fnUntraced(function* () {
      const calls = yield* makeCalls();
      const started = yield* Deferred.make<void>();
      const held = yield* Deferred.make<void>();
      const slow = Tool.make({
        display: () => ({ form: 'none' }),
        approval: ASKS_NEVER,
        description: 'Run until released.',
        parameters: Schema.Struct({}),
        execute: () => running(started, held),
      });
      const door = doorOver({ calls });
      const fiber = yield* Effect.forkScoped(settle(door, slow));
      yield* Deferred.await(started);
      yield* calls.control(address, { action: 'background' });
      yield* Fiber.join(fiber);
      yield* door.close();
      expect(door.preflighted(question(slow))).not.toBeNull();
      yield* Deferred.succeed(held, undefined);
      yield* calls.get(address)!.settled;
      expect(door.preflighted(question(slow))).toBeNull();
    }),
  );
});
