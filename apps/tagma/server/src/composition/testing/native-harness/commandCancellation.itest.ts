import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Context, Effect, Schema, Stream } from 'effect';
import type { LLMEvent } from '@runlith/llm/schema/events';
import { HarnessCalls, ThreadHarness } from '../../../threads/contract/service/engine.js';
import { Terminals } from '../../../executions/contract/service/terminals.js';
import { birthsOf, turnsOf } from '../../../threads/testing/doubles.js';
import { THREAD_OPERATIONS } from '../../../threads/contract/wire/operations/catalog.js';
import { knownAnswer } from '../../../platform/contract/wire/operation.js';
import { Coverage } from '../../../workspace/contract/service/roots.js';
import { makeDoorWorld } from '../doorFixture.js';
import { gitEffect } from '../graphFixture.js';

const CALL = 'held-command';
const ASK = 'Run the command until stopped.';

it.live('native bash retains the producer reason for operator stop and agent host shutdown', () =>
  Effect.gen(function* () {
    const world = yield* makeDoorWorld({
      own: 'the test closes the agent host with a foreground bash call still running',
      models: (standing) => ({
        ...standing,
        request: () => ({
          plannedOutputTokens: 32,
          text: () => Effect.die('the cancellation fixture streams only'),
          object: () => Effect.die('the cancellation fixture streams only'),
          stream: (input) =>
            Stream.fromIterable<LLMEvent>(
              JSON.stringify(input.messages).includes(ASK)
                ? [
                    { type: 'step-start', index: 0 },
                    { type: 'tool-input-start', id: CALL, name: 'bash' },
                    {
                      type: 'tool-call',
                      id: CALL,
                      name: 'bash',
                      input: {
                        command: 'exec /usr/bin/perl -e "sleep while 1"',
                        description: 'Wait for the owner to stop the command',
                        waitMs: 90_000,
                        lifeMs: 900_000,
                      },
                    },
                    { type: 'step-finish', index: 0, reason: 'tool-calls' },
                    { type: 'finish', reason: 'tool-calls' },
                  ]
                : [{ type: 'finish', reason: 'stop' }],
            ),
        }),
      }),
    });
    const root = yield* world.directory('commands');
    yield* gitEffect(root, ['init', '-q', '-b', 'main']);
    yield* gitEffect(root, [
      '-c',
      'user.email=fixture@tagma',
      '-c',
      'user.name=fixture',
      'commit',
      '--allow-empty',
      '--no-gpg-sign',
      '-q',
      '-m',
      'initial',
    ]);
    const projectId = yield* world.stealthProject(root);
    yield* Context.get(world.runtime.workspace, Coverage).cover(projectId);
    const calls = Context.get(world.runtime.owners, HarnessCalls);
    const start = Effect.fnUntraced(function* () {
      const threadId = (yield* birthsOf(world.runtime.owners).create({
        projectId,
        createdBySessionId: null,
        approvalMode: 'bypass',
      })).thread.id;
      yield* turnsOf(world.runtime.owners).send(threadId, projectId, ASK);
      const linked = yield* calls.events().pipe(
        Stream.flatMap((event) => Stream.fromIterable(event.type === 'snapshot' ? event.calls : [event.call])),
        Stream.filter((call) => call.threadId === threadId && call.toolCallId === CALL && call.executions.length > 0),
        Stream.runHead,
      );
      if (linked._tag === 'None') return yield* Effect.die('the call ended without linking its command');
      const execution = linked.value.executions[0]!.execution;
      const terminals = Context.get(world.runtime.executions, Terminals);
      for (;;) {
        const state = yield* terminals.state(execution);
        if (state?.state.phase === 'running') break;
        if (state?.state.phase === 'ended') return yield* Effect.die('the command ended before the stop');
        yield* Effect.yieldNow;
      }
      return threadId;
    });
    const read = Effect.fnUntraced(function* (threadId: string) {
      const response = yield* world.op(
        'read_thread',
        {
          threadId,
          select: 'entries',
          where: [{ field: 'toolCallId', op: 'eq', value: CALL }],
          fields: ['toolState', 'entry.toolOutput'],
          limit: 1,
        },
        `project=${projectId}`,
      );
      expect(response.status).toBe(200);
      const answer = yield* Schema.decodeUnknownEffect(knownAnswer(THREAD_OPERATIONS.read_thread.answer))(response.body);
      expect(answer.evidence?.rows).toHaveLength(1);
      return yield* Schema.decodeUnknownEffect(
        Schema.Struct({
          status: Schema.Literal('cancelled'),
          output: Schema.String,
          reason: Schema.String,
        }),
      )(answer.evidence?.rows[0]?.['entry.toolOutput']);
    });
    const operator = yield* start();
    const stopped = yield* turnsOf(world.runtime.owners).stop(operator, projectId);
    expect(stopped.status).toBe('stopped');
    yield* calls.events().pipe(
      Stream.filter((event) =>
        (event.type === 'snapshot' ? event.calls : [event.call]).some(
          (call) => call.threadId === operator && call.toolCallId === CALL && call.endedAt !== null,
        ),
      ),
      Stream.runHead,
    );
    const shuttingDown = yield* start();
    yield* Context.get(world.runtime.owners, ThreadHarness).dispose();
    const operatorAnswer = yield* read(operator);
    const shutdownAnswer = yield* read(shuttingDown);
    expect(operatorAnswer.output).toContain(operatorAnswer.reason);
    expect(operatorAnswer.output).toContain('stopped by the operator');
    expect(shutdownAnswer.output).toContain(shutdownAnswer.reason);
    expect(shutdownAnswer.output).toContain('The agent host is shutting down');
    expect(shutdownAnswer.output).not.toContain('User aborted the command');
  }),
);
