import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Context, Deferred, Effect, Schema, Stream } from 'effect';
import type { LLMEvent } from '@runlith/llm/schema/events';
import { EvidenceFeed } from '../../../threads/contract/service/evidence.js';
import { birthsOf, turnsOf } from '../../../threads/testing/doubles.js';
import { THREAD_OPERATIONS } from '../../../threads/contract/wire/operations/catalog.js';
import { knownAnswer } from '../../../platform/contract/wire/operation.js';
import { Coverage } from '../../../workspace/contract/service/roots.js';
import { makeDoorWorld } from '../doorFixture.js';
import { gitEffect } from '../graphFixture.js';

const CALL = 'failing-command';
const DIAGNOSTIC = 'retained-compiler-diagnostic';
const ASK = 'Run the failing check.';
const finished: readonly LLMEvent[] = [
  { type: 'text-start', id: 'reply' },
  { type: 'text-delta', id: 'reply', text: 'Checked.' },
  { type: 'text-end', id: 'reply' },
  { type: 'finish', reason: 'stop' },
];

it.live('read_thread records a native command with nonzero exit as failed execution and retains its diagnostics', () =>
  Effect.gen(function* () {
    const returned = yield* Deferred.make<void>();
    const world = yield* makeDoorWorld({
      models: (standing) => ({
        ...standing,
        request: () => ({
          plannedOutputTokens: 32,
          text: () => Effect.die(new Error('the command fixture streams only')),
          object: () => Effect.die(new Error('the command fixture streams only')),
          stream: (input) =>
            Stream.unwrap(
              Effect.gen(function* () {
                const result = input.messages.some((message) =>
                  message.content.some((part) => part.type === 'tool-result' && part.id === CALL),
                );
                if (result) {
                  yield* Deferred.succeed(returned, undefined);
                  return Stream.fromIterable(finished);
                }
                if (!JSON.stringify(input.messages).includes(ASK)) return Stream.fromIterable(finished);
                return Stream.fromIterable<LLMEvent>([
                  { type: 'step-start', index: 0 },
                  { type: 'tool-input-start', id: CALL, name: 'bash' },
                  {
                    type: 'tool-call',
                    id: CALL,
                    name: 'bash',
                    input: { command: `printf '${DIAGNOSTIC}\\n' >&2; exit 3`, description: 'Run a failing check' },
                  },
                  { type: 'step-finish', index: 0, reason: 'tool-calls' },
                  { type: 'finish', reason: 'tool-calls' },
                ]);
              }),
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
    const threadId = (yield* birthsOf(world.runtime.owners).create({ projectId, createdBySessionId: null, approvalMode: 'bypass' })).thread
      .id;
    const ended = yield* Deferred.make<void>();
    yield* Effect.acquireRelease(
      Effect.sync(() =>
        Context.get(world.runtime.owners, EvidenceFeed).subscribe(threadId, (event) => {
          if (event.type === 'state' && event.frame.state.status.life === 'idle' && event.frame.state.latestRun !== null)
            Deferred.doneUnsafe(ended, Effect.void);
        }),
      ),
      (unsubscribe) => Effect.sync(unsubscribe),
    );
    yield* turnsOf(world.runtime.owners).send(threadId, projectId, ASK);
    yield* Deferred.await(returned);
    const read = yield* world.op(
      'read_thread',
      {
        threadId,
        select: 'entries',
        where: [{ field: 'toolCallId', op: 'eq', value: CALL }],
        fields: ['toolState', 'failed', 'entry.toolOutput'],
        limit: 1,
      },
      `project=${projectId}`,
    );
    expect(read.status).toBe(200);
    const answer = yield* Schema.decodeUnknownEffect(knownAnswer(THREAD_OPERATIONS.read_thread.answer))(read.body);
    expect(answer.evidence?.rows).toMatchObject([{ toolState: 'output-error', failed: true }]);
    expect(String(answer.evidence?.rows[0]?.['entry.toolOutput'])).toContain(DIAGNOSTIC);
    yield* Deferred.await(ended);
  }),
);
