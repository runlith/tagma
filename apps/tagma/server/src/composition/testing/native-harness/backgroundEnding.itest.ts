import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import * as BunServices from '@effect/platform-bun/BunServices';
import { Context, Deferred, Effect, Fiber, FileSystem, Layer, Schema, Stream } from 'effect';
import { HostRegistration } from '@runlith/executions/HostRegistration';
import { HostRequestKey } from '@runlith/executions/protocol/execution';
import type { LLMEvent } from '@runlith/llm/schema/events';
import { EvidenceFeed } from '../../../threads/contract/service/evidence.js';
import { birthsOf, turnsOf } from '../../../threads/testing/doubles.js';
import { CommandReader, CommandWaiters } from '../../../executions/contract/service/commands.js';
import { HostManagement } from '../../../executions/contract/service/host.js';
import { COMMAND_OPERATIONS } from '../../../executions/contract/wire/operations/commandCatalog.js';
import { knownAnswer } from '../../../platform/contract/wire/operation.js';
import { ThreadId } from '../../../platform/contract/wire/thread.js';
import { spawnedEffect } from '../../../platform/testing/spawn.js';
import { Coverage } from '../../../workspace/contract/service/roots.js';
import { makeDoorWorld } from '../doorFixture.js';
import { gitEffect } from '../graphFixture.js';

const CALL = 'background-diff';
const ASK = 'Leave the diff running.';
const finished: readonly LLMEvent[] = [
  { type: 'text-start', id: 'reply' },
  { type: 'text-delta', id: 'reply', text: 'Checked.' },
  { type: 'text-end', id: 'reply' },
  { type: 'finish', reason: 'stop' },
];

it.live('a background bash ending after logic handover agrees with read_command on its persisted native exit', () =>
  Effect.gen(function* () {
    const returned = yield* Deferred.make<void>();
    const notified = yield* Deferred.make<string>();
    let gate = '';
    const world = yield* makeDoorWorld({
      own: 'the scenario replaces its execution host logic before delivering a command ending',
      models: (standing) => ({
        ...standing,
        request: () => ({
          plannedOutputTokens: 32,
          text: () => Effect.die('the background command fixture streams only'),
          object: () => Effect.die('the background command fixture streams only'),
          stream: (input) =>
            Stream.unwrap(
              Effect.gen(function* () {
                const notice = input.messages
                  .flatMap((message) => message.content)
                  .find((part) => part.type === 'text' && part.text.includes('<command-result>'));
                if (notice?.type === 'text') {
                  yield* Deferred.succeed(notified, notice.text);
                  return Stream.fromIterable(finished);
                }
                if (input.messages.some((message) => message.content.some((part) => part.type === 'tool-result' && part.id === CALL))) {
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
                    input: { command: `read ready < '${gate}'; exec git diff --stat`, waitMs: 0, description: 'Read the working diff' },
                  },
                  { type: 'step-finish', index: 0, reason: 'tool-calls' },
                  { type: 'finish', reason: 'tool-calls' },
                ]);
              }),
            ),
        }),
      }),
    });
    const files = yield* FileSystem.FileSystem;
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
    gate = `${yield* world.directory('gate')}/input`;
    const fifo = yield* spawnedEffect(['mkfifo', gate]);
    expect(fifo.success).toBe(true);
    const projectId = yield* world.stealthProject(root);
    yield* Context.get(world.runtime.workspace, Coverage).cover(projectId);
    const thread = ThreadId.make(
      (yield* birthsOf(world.runtime.owners).create({ projectId, createdBySessionId: null, approvalMode: 'bypass' })).thread.id,
    );
    const idle = yield* Deferred.make<void>();
    yield* Effect.acquireRelease(
      Effect.sync(() =>
        Context.get(world.runtime.owners, EvidenceFeed).subscribe(thread, (event) => {
          if (event.type === 'state' && event.frame.state.status.life === 'idle' && event.frame.state.latestRun !== null)
            Deferred.doneUnsafe(idle, Effect.void);
        }),
      ),
      (unsubscribe) => Effect.sync(unsubscribe),
    );
    yield* turnsOf(world.runtime.owners).send(thread, projectId, ASK);
    yield* Deferred.await(returned);
    yield* Deferred.await(idle);
    const reader = Context.get(world.runtime.executions, CommandReader);
    const [reading] = (yield* reader.page(projectId, { owner: { _tag: 'Thread', thread }, limit: 1 })).readings;
    if (reading === undefined) return yield* Effect.die('the background bash admitted no command');
    const execution = reading.command.execution;
    const waiters = Context.get(world.runtime.executions, CommandWaiters);
    expect(yield* waiters.take(execution, thread)).toBe(true);
    const host = Context.get(world.runtime.executions, HostManagement).connection;
    const ended = yield* Effect.forkChild(host.port.subscribe({ _tag: 'State', execution }, 8).pipe(Stream.runDrain));
    yield* files.writeFileString(gate, 'go\n');
    yield* Fiber.join(ended);
    yield* host.port.subscribe({ _tag: 'Inventory' }, 8).pipe(
      Stream.mapEffect(() => host.port.status()),
      Stream.filter((status) => status.executions === 0),
      Stream.runHead,
    );
    const before = yield* reader.one(projectId, execution.execution, execution.incarnation);
    expect(before.live).toMatchObject({ _tag: 'Held', entry: { state: { phase: 'ended', nativeExit: { _tag: 'Code', code: 0 } } } });
    const registrations = yield* Effect.provide(HostRegistration, HostRegistration.layer.pipe(Layer.provide(BunServices.layer)));
    const prior = yield* registrations.read(host.address.state);
    const watching = yield* Stream.toPull(files.watch(host.address.state));
    const changed = yield* Effect.forkChild(
      Effect.gen(function* () {
        for (;;) {
          const next = yield* registrations.read(host.address.state);
          if (next.logic !== undefined && next.logic.pid !== prior.logic?.pid && (yield* files.exists(`${host.address.state}/host.sock`)))
            return;
          yield* watching;
        }
      }),
    );
    const quiet = yield* host.port.quiesce({ installation: execution.installation, operation: HostRequestKey.make('ending-handover') });
    if (quiet._tag === 'Refused') return yield* Effect.die(quiet.refusal);
    expect((yield* host.port.yield(quiet.ticket))._tag).toBe('Yielding');
    yield* Fiber.join(changed);
    yield* host.port.status();
    yield* waiters.recover();
    yield* waiters.due(execution);
    const notice = yield* Deferred.await(notified);
    const read = yield* world.op(
      'read_command',
      { execution: execution.execution, incarnation: execution.incarnation },
      `project=${projectId}`,
    );
    expect(read.status).toBe(200);
    const answer = yield* Schema.decodeUnknownEffect(knownAnswer(COMMAND_OPERATIONS.read_command.answer))(read.body);
    expect(answer.live).toMatchObject({
      _tag: 'Held',
      entry: { state: { phase: 'ended', nativeExit: { _tag: 'Code', code: 0 }, cleanup: 'complete' } },
    });
    expect(notice).toContain('exit 0');
    expect(notice).toContain(`${execution.execution}:${execution.incarnation}`);
  }).pipe(Effect.provide(BunServices.layer)),
);
