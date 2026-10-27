import { describe, expect } from 'bun:test';
import type { Tester } from '@runlith/effect-test';
import { Effect, Stream, type Scope } from 'effect';
import type { AgentEvent } from '../../../agent/AgentEvent';
import { Message, ToolCallPart } from '@runlith/llm/schema/messages';
import { AgentRunBroke } from '../../../agent/AgentFailure';
import type { ThreadStorageFactory } from '../storagePort';
import { threadCauseOf } from '../../ThreadBorder';
import { OWNER, SCOPE, openedRun, scriptedWorld, pump, startedTurn } from './world';
import { heldTurn, processTurn, replyTurn, brokenTurn, scriptedStep } from './scripts';
import { dyingToolTurn } from './toolScripts';
import { gate, request, standingOf, until } from './support';
import { coreEntry } from '../../../transcript/kinds';
const reply = (text: string) =>
  replyTurn({
    chunks: [
      { type: 'text-start', id: 't1' },
      { type: 'text-delta', id: 't1', text },
      { type: 'text-end', id: 't1' },
    ],
    steps: [scriptedStep({ text, messages: [Message.assistant(text)] })],
  });
export function describeThreadRunContinues<TTx, TWrite extends TTx = TTx, R = never>(
  name: string,
  open: ThreadStorageFactory<TTx, TWrite, R>,
  test: Tester<Scope.Scope | R>,
): void {
  describe(`${name}: the run over the log — orderly departures and Continue`, () => {
    test.each(['reasoning', 'intent', 'retry'] as const)(
      '%s before a completed step receives only its earned crash recovery credit',
      Effect.fnUntraced(function* (progress) {
        const storage = yield* Effect.acquireRelease(open(), (storage) => storage.dispose());
        const thread = yield* storage.createThread({ ownerId: OWNER, scope: SCOPE });
        const first = yield* scriptedWorld(storage, thread.agentId);
        first.plan.push(heldTurn(Effect.never));
        const stream = yield* startedTurn(first, thread.id, 'Begin.');
        yield* until(() =>
          Effect.map(storage.aggregate.transcriptOf(thread.id), (entries) =>
            (entries ?? []).some((entry) => coreEntry(entry) && entry.type === 'message' && entry.role === 'assistant'),
          ),
        );
        const recovering = yield* scriptedWorld(storage, thread.agentId);
        recovering.plan.push((input) => {
          const held = processTurn(Effect.never)(input);
          const events =
            progress !== 'intent'
              ? Stream.concat(
                  Stream.fromIterable<AgentEvent>(
                    progress === 'reasoning'
                      ? [
                          { type: 'reasoning-start', id: 'new-thought' },
                          { type: 'reasoning-delta', id: 'new-thought', text: 'New durable thought.' },
                          { type: 'reasoning-end', id: 'new-thought' },
                        ]
                      : [
                          {
                            type: 'retry',
                            stepNumber: input.stepsTaken ?? 0,
                            attempt: 1,
                            of: 3,
                            family: 'transport',
                            delayMs: 0,
                            message: 'The provider asked for another attempt.',
                          },
                        ],
                  ),
                  held.events,
                )
              : Stream.unwrap(
                  Effect.gen(function* () {
                    if (!input.commitEffects) return yield* Effect.die('The run has no durable intent door.');
                    yield* input
                      .commitEffects({
                        stepNumber: input.stepsTaken ?? 0,
                        messages: [
                          Message.assistant([ToolCallPart.from({ id: 'new-call', name: 'write_file', input: { path: 'a.txt' } })]),
                        ],
                        calls: [{ toolCallId: 'new-call', toolName: 'write_file', input: { path: 'a.txt' } }],
                      })
                      .pipe(Effect.mapError((cause) => new AgentRunBroke({ cause })));
                    return held.events;
                  }),
                );
          return { ...held, events };
        });
        expect(yield* recovering.harness.runs.recoverNow()).toBe(1);
        yield* until(() =>
          Effect.map(storage.aggregate.transcriptOf(thread.id), (entries) =>
            (entries ?? []).some((entry) =>
              progress === 'reasoning'
                ? entry.type === 'reasoning'
                : progress === 'retry'
                  ? entry.type === 'retry'
                  : coreEntry(entry) && entry.type === 'tool' && entry.toolCallId === 'new-call',
            ),
          ),
        );
        const runs = storage.runs({ ownerId: 'observer', scope: SCOPE });
        expect(yield* runs.latestRun(thread.id)).toMatchObject({
          id: stream.runId,
          status: 'running',
          resumes: progress === 'retry' ? 1 : 0,
        });
        const successor = yield* scriptedWorld(storage, thread.agentId);
        successor.plan.push(processTurn(Effect.never));
        expect(yield* successor.harness.runs.recoverNow()).toBe(1);
        expect(yield* runs.latestRun(thread.id)).toMatchObject({ id: stream.runId, status: progress === 'retry' ? 'cut' : 'running' });
      }),
    );
    test(
      'a run whose process died before it oriented is oriented by the process that takes it up, and a run that had oriented is not oriented twice',
      Effect.fnUntraced(function* () {
        const storage = yield* Effect.acquireRelease(open(), (storage) => storage.dispose());
        const bare = yield* storage.createThread({ ownerId: OWNER, scope: SCOPE });
        const told = yield* storage.createThread({ ownerId: OWNER, scope: SCOPE });
        const orienting = gate();
        const orientation = (thread: { readonly id: string; readonly transcript: readonly { readonly runId?: string }[] }, text: string) =>
          Effect.succeed({
            message: Message.user(text),
            entry: { type: 'context' as const, id: `context:${thread.id}:${text}`, runId: thread.transcript.at(-1)?.runId, text },
          });
        const first = yield* scriptedWorld(storage, bare.agentId, {
          orient: (thread) =>
            thread.id === bare.id
              ? Effect.andThen(Effect.sync(orienting.reach), Effect.never)
              : orientation(thread, `Oriented ${thread.id}.`),
        });
        first.plan.push(processTurn(Effect.never));
        yield* startedTurn(first, told.id, 'Begin there.');
        yield* until(() => Effect.sync(() => first.replayed.length === 1));
        yield* startedTurn(first, bare.id, 'Begin here.');
        yield* orienting.reached;
        const second = yield* scriptedWorld(storage, bare.agentId, {
          orient: (thread) => orientation(thread, `Oriented ${thread.id} on resume.`),
        });
        second.plan.push(processTurn(Effect.never), processTurn(Effect.never));
        let recovered = 0;
        yield* until(() => Effect.map(second.harness.runs.recoverNow(), (taken) => (recovered += taken) === 2));
        yield* until(() => Effect.sync(() => second.replayed.length === 2));
        const heard = second.replayed.map((messages) => JSON.stringify(messages));
        expect(heard.filter((said) => said.includes(`Oriented ${bare.id} on resume.`))).toHaveLength(1);
        expect(heard.filter((said) => said.includes(`Oriented ${told.id} on resume.`))).toHaveLength(0);
        expect(heard.filter((said) => said.includes(`Oriented ${told.id}.`))).toHaveLength(1);
      }),
    );
    test(
      'Continue over a run stopped before it oriented orients the run that takes the turn up',
      Effect.fnUntraced(function* () {
        const orienting = gate();
        let orients = 0;
        const { storage, world, thread } = yield* openedRun(open, {
          orient: () =>
            Effect.suspend(() =>
              (orients += 1) === 1
                ? Effect.andThen(Effect.sync(orienting.reach), Effect.never)
                : Effect.succeed({ message: Message.user('Oriented on Continue.') }),
            ),
        });
        yield* startedTurn(world, thread.id, 'Begin.');
        yield* orienting.reached;
        expect(yield* world.harness.threads.handle(thread.id, OWNER).stop()).toMatchObject({ status: 'stopped' });
        yield* until(() => Effect.map(storage.aggregate.find(thread.id), (row) => row?.status === 'idle'));
        world.plan.push(reply('Continued.'));
        yield* world.harness.threads.handle(thread.id, OWNER).continue();
        yield* until(() => Effect.sync(() => world.replayed.length === 1));
        expect(JSON.stringify(world.replayed[0])).toContain('Oriented on Continue.');
      }),
    );
    test(
      'a run a person stopped on the way out stays stopped: nobody takes it up after the departure',
      Effect.fnUntraced(function* () {
        const storage = yield* Effect.acquireRelease(open(), (storage) => storage.dispose());
        const thread = yield* storage.createThread({ ownerId: OWNER, scope: SCOPE });
        const processA = yield* scriptedWorld(storage, thread.agentId);
        processA.plan.push(dyingToolTurn());
        const stream = yield* startedTurn(processA, thread.id, 'Begin.');
        yield* until(() =>
          Effect.map(storage.aggregate.transcriptOf(thread.id), (entries) => (entries ?? []).some((entry) => entry.type === 'tool')),
        );
        expect(yield* processA.harness.threads.handle(thread.id, OWNER).stop()).toMatchObject({ status: 'stopped' });
        yield* processA.dispose();
        const runsPort = storage.runs({ ownerId: 'observer', scope: SCOPE });
        const row = yield* runsPort.latestRun(thread.id);
        expect(row).toMatchObject({ id: stream.runId, status: 'aborted' });
        const processB = yield* scriptedWorld(storage, thread.agentId);
        expect(yield* processB.harness.runs.recoverNow()).toBe(0);
        expect((yield* runsPort.latestRun(thread.id))?.status).toBe('aborted');
      }),
    );
    test(
      'Continue takes up a run a person stopped, over the history it kept',
      Effect.fnUntraced(function* () {
        const storage = yield* Effect.acquireRelease(open(), (storage) => storage.dispose());
        const thread = yield* storage.createThread({ ownerId: OWNER, scope: SCOPE });
        const world = yield* scriptedWorld(storage, thread.agentId);
        world.plan.push(dyingToolTurn());
        const stream = yield* startedTurn(world, thread.id, 'Begin.');
        yield* until(() =>
          Effect.map(storage.aggregate.transcriptOf(thread.id), (entries) => (entries ?? []).some((entry) => entry.type === 'tool')),
        );
        expect(yield* world.harness.threads.handle(thread.id, OWNER).stop()).toMatchObject({ status: 'stopped' });
        yield* until(() => Effect.map(storage.aggregate.find(thread.id), (row) => row?.status === 'idle'));
        const runsPort = storage.runs({ ownerId: 'observer', scope: SCOPE });
        expect(yield* runsPort.latestRun(thread.id)).toMatchObject({ id: stream.runId, status: 'aborted' });
        world.plan.push(reply('Continued.'));
        const continued = yield* world.harness.threads.handle(thread.id, OWNER).continue();
        expect(continued.runId).not.toBe(stream.runId);
        yield* until(() => Effect.map(storage.aggregate.find(thread.id), (row) => row?.status === 'idle'));
        expect((yield* runsPort.latestRun(thread.id))?.status).toBe('completed');
        const after = (yield* storage.aggregate.transcriptOf(thread.id)) ?? [];
        expect(
          after.filter(
            (entry) => coreEntry(entry) && entry.type === 'message' && entry.role === 'assistant' && entry.text === 'Continued.',
          ),
        ).toHaveLength(1);
        expect(after.filter((entry) => coreEntry(entry) && entry.type === 'message' && entry.role === 'user')).toHaveLength(1);
      }),
    );
    test(
      'Continue takes up a run that broke, over the history it kept',
      Effect.fnUntraced(function* () {
        const storage = yield* Effect.acquireRelease(open(), (storage) => storage.dispose());
        const thread = yield* storage.createThread({ ownerId: OWNER, scope: SCOPE });
        const world = yield* scriptedWorld(storage, thread.agentId);
        world.plan.push(brokenTurn('The account this thread signs with was replaced.'));
        const stream = yield* startedTurn(world, thread.id, 'Begin.');
        yield* pump(stream);
        yield* until(() => Effect.map(storage.aggregate.find(thread.id), (row) => row?.status !== 'running'));
        const runsPort = storage.runs({ ownerId: 'observer', scope: SCOPE });
        expect((yield* runsPort.latestRun(thread.id))?.status).toBe('failed');
        world.plan.push(reply('Continued.'));
        const continued = yield* world.harness.threads.handle(thread.id, OWNER).continue();
        expect(continued.runId).not.toBe(stream.runId);
        yield* until(() => Effect.map(storage.aggregate.find(thread.id), (row) => row?.status === 'idle'));
        expect((yield* runsPort.latestRun(thread.id))?.status).toBe('completed');
        const after = (yield* storage.aggregate.transcriptOf(thread.id)) ?? [];
        expect(
          after.filter(
            (entry) => coreEntry(entry) && entry.type === 'message' && entry.role === 'assistant' && entry.text === 'Continued.',
          ),
        ).toHaveLength(1);
        expect(after.filter((entry) => coreEntry(entry) && entry.type === 'message' && entry.role === 'user')).toHaveLength(1);
      }),
    );
    test(
      'a turn typed over a run that broke takes up what the broken run was answering for',
      Effect.fnUntraced(function* () {
        const storage = yield* Effect.acquireRelease(open(), (storage) => storage.dispose());
        const thread = yield* storage.createThread({ ownerId: OWNER, scope: SCOPE });
        const world = yield* scriptedWorld(storage, thread.agentId);
        world.plan.push(brokenTurn('The provider refused the request.'));
        const stream = yield* startedTurn(world, thread.id, 'Begin.');
        yield* pump(stream);
        yield* until(() => Effect.map(storage.aggregate.find(thread.id), (row) => row?.status !== 'running'));
        const runsPort = storage.runs({ ownerId: 'observer', scope: SCOPE });
        expect((yield* runsPort.latestRun(thread.id))?.status).toBe('failed');
        yield* storage.inbox.put(request('envelope:asked', thread.id, 'Begin.', 1_000));
        yield* storage.inbox.deliver(['envelope:asked'], stream.runId);
        world.plan.push(reply('Taken up.'));
        const typed = yield* startedTurn(world, thread.id, 'Go on.');
        expect(typed.runId).not.toBe(stream.runId);
        yield* pump(typed);
        yield* until(() => Effect.map(storage.aggregate.find(thread.id), (row) => row?.status === 'idle'));
        expect((yield* runsPort.latestRun(thread.id))?.status).toBe('completed');
        yield* until(() => Effect.map(standingOf(storage, 'envelope:asked'), (receipt) => receipt?.state === 'acknowledged'));
        expect(yield* standingOf(storage, 'envelope:asked')).toEqual({ state: 'acknowledged', runId: typed.runId });
      }),
    );
    test(
      'a thread whose newest run finished is not continued, and the refusal names the state',
      Effect.fnUntraced(function* () {
        const storage = yield* Effect.acquireRelease(open(), (storage) => storage.dispose());
        const thread = yield* storage.createThread({ ownerId: OWNER, scope: SCOPE });
        const world = yield* scriptedWorld(storage, thread.agentId);
        world.plan.push(reply('Done.'));
        const stream = yield* startedTurn(world, thread.id, 'Begin.');
        yield* pump(stream);
        yield* until(() => Effect.map(storage.aggregate.find(thread.id), (row) => row?.status === 'idle'));
        const runsPort = storage.runs({ ownerId: 'observer', scope: SCOPE });
        expect((yield* runsPort.latestRun(thread.id))?.status).toBe('completed');
        expect(threadCauseOf(yield* Effect.flip(world.harness.threads.handle(thread.id, OWNER).continue()))).toMatchObject({
          _tag: 'ThreadRunNotInterrupted',
          status: 'completed',
        });
      }),
    );
    test(
      'two Continues at once open one run, and the loser is answered by name',
      Effect.fnUntraced(function* () {
        const storage = yield* Effect.acquireRelease(open(), (storage) => storage.dispose());
        const thread = yield* storage.createThread({ ownerId: OWNER, scope: SCOPE });
        const processA = yield* scriptedWorld(storage, thread.agentId);
        processA.plan.push(dyingToolTurn());
        yield* startedTurn(processA, thread.id, 'Begin.');
        yield* until(() =>
          Effect.map(storage.aggregate.transcriptOf(thread.id), (entries) => (entries ?? []).some((entry) => entry.type === 'tool')),
        );
        yield* processA.dispose();
        const processB = yield* scriptedWorld(storage, thread.agentId, { rhythm: { resumeWithinMs: 0 } });
        expect(yield* processB.harness.runs.recoverNow()).toBe(1);
        processB.plan.push(reply('Continued.'));
        const face = processB.harness.threads.handle(thread.id, OWNER);
        const both = yield* Effect.all([Effect.result(face.continue()), Effect.result(face.continue())], { concurrency: 2 });
        const won = both.filter((outcome) => outcome._tag === 'Success');
        const lost = both.filter((outcome) => outcome._tag === 'Failure');
        expect(won).toHaveLength(1);
        expect(lost).toHaveLength(1);
        expect(threadCauseOf(lost[0]?.failure)).toMatchObject({
          _tag: expect.stringMatching(/^(ThreadRunConflict|ThreadRunNotInterrupted)$/),
        });
        yield* until(() => Effect.map(storage.aggregate.find(thread.id), (row) => row?.status === 'idle'));
        const runsPort = storage.runs({ ownerId: 'observer', scope: SCOPE });
        expect((yield* runsPort.latestRun(thread.id))?.status).toBe('completed');
      }),
    );
    test(
      'two Continues over a stopped run with words waiting open one run, and the one whose words the other recorded is refused by name',
      Effect.fnUntraced(function* () {
        const storage = yield* Effect.acquireRelease(open(), (storage) => storage.dispose());
        const thread = yield* storage.createThread({ ownerId: OWNER, scope: SCOPE });
        const world = yield* scriptedWorld(storage, thread.agentId);
        world.plan.push(dyingToolTurn());
        const started = yield* startedTurn(world, thread.id, 'Begin.');
        yield* until(() =>
          Effect.map(storage.aggregate.transcriptOf(thread.id), (entries) => (entries ?? []).some((entry) => entry.type === 'tool')),
        );
        expect(yield* world.harness.threads.handle(thread.id, OWNER).stop()).toMatchObject({ status: 'stopped' });
        yield* pump(started);
        yield* storage.inbox.put({
          id: 'envelope:waiting',
          threadId: thread.id,
          sender: { kind: 'thread', threadId: 'parent', name: 'parent' },
          kind: 'envelope',
          body: { intent: 'message', text: 'Also look at the log.', inReplyTo: null },
          occurredAt: new Date(1_000).toISOString(),
        });
        world.plan.push(reply('Continued.'));
        const face = world.harness.threads.handle(thread.id, OWNER);
        const both = yield* Effect.all([Effect.result(face.continue()), Effect.result(face.continue())], { concurrency: 2 });
        expect(both.filter((outcome) => outcome._tag === 'Success')).toHaveLength(1);
        const lost = both.filter((outcome) => outcome._tag === 'Failure');
        expect(lost).toHaveLength(1);
        expect(threadCauseOf(lost[0]?.failure)).toMatchObject({
          _tag: expect.stringMatching(/^(ThreadRunConflict|ThreadRunNotInterrupted)$/),
        });
        yield* until(() => Effect.map(storage.aggregate.find(thread.id), (row) => row?.status === 'idle'));
      }),
    );
  });
}
