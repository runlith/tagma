import { describe, expect } from 'bun:test';
import type { Tester } from '@runlith/effect-test';
import { Effect, Fiber, Stream, type Scope } from 'effect';
import { Message } from '@runlith/llm/schema/messages';
import type { ThreadStorageFactory } from '../storagePort';
import { readThreadEvents, type ThreadEventRecord } from '../../events';
import { ThreadCallBroke } from '../../ThreadBorder';
import { OWNER, SCOPE, scriptedWorld, openedRun, pump, startedTurn, queuedTurn } from './world';
import { heldTurn, replyTurn, hangingTurn, scriptedStep } from './scripts';
import { reportTurn } from './toolScripts';
import { gate, withInbox, transcriptOf, inboxQueued, standingOf, until, foldEntries, BrokenCarryInbox } from './support';
import { coreEntry } from '../../../transcript/kinds';
const reply = (id: string, text: string) =>
  replyTurn({
    chunks: [
      { type: 'text-start', id },
      { type: 'text-delta', id, text },
      { type: 'text-end', id },
    ],
    steps: [scriptedStep({ text, messages: [Message.assistant(text)] })],
  });
export function describeThreadRunStops<TTx, TWrite extends TTx = TTx, R = never>(
  name: string,
  open: ThreadStorageFactory<TTx, TWrite, R>,
  test: Tester<Scope.Scope | R>,
): void {
  describe(`${name}: the run over the log — stops and settles`, () => {
    test(
      'withdrawing an unanswered turn removes its context and guidance from the next run but keeps the earlier dialogue',
      Effect.fnUntraced(function* () {
        const { storage, world, thread } = yield* openedRun(open, {
          orient: () => Effect.succeed({ message: Message.user('Orientation for this run.') }),
        });
        world.plan.push(reply('kept', 'Earlier answer.'));
        yield* pump(yield* startedTurn(world, thread.id, 'Earlier question.'));
        const prefix = (yield* storage.aggregate.find(thread.id))!.history;
        const guided = gate();
        world.plan.push((input) => {
          const waiting = hangingTurn({ chunks: [], reached: guided.reach })(input);
          return {
            ...waiting,
            events: Stream.concat(
              Stream.drain(
                Stream.fromEffect(
                  input.sink.push({
                    type: 'runtime-guidance',
                    entry: {
                      type: 'runtime-guidance',
                      id: 'guide-withdrawn',
                      runId: input.run.id,
                      hook: 'beforeStep',
                      sequence: 1,
                      texts: ['Guidance for the withdrawn turn.'],
                      sources: [],
                    },
                  }),
                ),
              ),
              waiting.events,
            ),
          };
        });
        const withdrawn = yield* startedTurn(world, thread.id, 'Withdraw this request.');
        yield* guided.reached;
        expect(yield* world.harness.threads.handle(thread.id, OWNER).stop(undefined, { withdraw: true })).toMatchObject({
          status: 'stopped',
        });
        yield* pump(withdrawn);
        const stopped = yield* transcriptOf(storage, thread.id);
        expect(stopped.filter((entry) => entry.runId === withdrawn.runId)).toEqual([]);
        expect((yield* storage.runs({ ownerId: 'observer', scope: SCOPE }).latestRun(thread.id))?.status).toBe('withdrawn');
        expect((yield* world.harness.reads.snapshot(thread.id)).status.ending).toMatchObject({
          status: 'withdrawn',
          stoppedBy: 'reader',
          words: { text: 'Withdraw this request.' },
        });
        const events = yield* readThreadEvents(storage.eventLog, storage.kinds, thread.id, 0, 1_000);
        expect(events.filter((event) => event.payload.entry?.type === 'run-end' && event.payload.entry.runId === withdrawn.runId)).toEqual(
          [],
        );
        expect(events.filter((event) => event.payload.withdrawn)).toHaveLength(1);
        expect(foldEntries(events)).toEqual(stopped);
        world.plan.push(reply('after', 'Next answer.'));
        yield* pump(yield* startedTurn(world, thread.id, 'Next question.'));
        expect(world.replayed.at(-1)).toEqual([
          ...prefix,
          expect.objectContaining({ role: 'user', content: [{ type: 'text', text: 'Next question.' }] }),
          expect.objectContaining({ role: 'user', content: [{ type: 'text', text: 'Orientation for this run.' }] }),
        ]);
      }),
    );
    test(
      'a stopped run writes the words it only showed once, before its end',
      Effect.fnUntraced(function* () {
        const { storage, world, thread } = yield* openedRun(open, { rhythm: { streamFlushIntervalMs: 60_000 } });
        const reached = gate();
        world.plan.push(
          hangingTurn({
            chunks: [
              { type: 'text-start', id: 'shown' },
              { type: 'text-delta', id: 'shown', text: 'Shown, not yet written.' },
            ],
            reached: reached.reach,
          }),
        );
        const turn = yield* startedTurn(world, thread.id, 'Hang here.');
        const pumping = yield* Effect.forkScoped(pump(turn));
        yield* reached.reached;
        const said = (events: readonly ThreadEventRecord[]) =>
          events.filter((event) => {
            const entry = event.payload.entry as
              | {
                  type?: string;
                  text?: string;
                }
              | undefined;
            return entry?.type === 'message' && entry.text === 'Shown, not yet written.';
          });
        expect(said(yield* readThreadEvents(storage.eventLog, storage.kinds, thread.id, 0, 1_000))).toEqual([]);
        expect(yield* world.harness.threads.handle(thread.id, OWNER).stop()).toMatchObject({ status: 'stopped' });
        yield* Fiber.join(pumping);
        const events = yield* readThreadEvents(storage.eventLog, storage.kinds, thread.id, 0, 1_000);
        const written = said(events);
        expect(written).toHaveLength(1);
        expect(events.at(-1)?.payload.entry).toMatchObject({ type: 'run-end', status: 'aborted' });
        expect(events.indexOf(written[0]!)).toBeLessThan(events.length - 1);
        expect((yield* storage.runs({ ownerId: 'observer', scope: SCOPE }).latestRun(thread.id))?.streamTail).toBeNull();
      }),
    );
    test(
      'a run somebody steered into keeps its turn',
      Effect.fnUntraced(function* () {
        const { storage, world, thread } = yield* openedRun(open);
        const reached = gate();
        world.plan.push(hangingTurn({ chunks: [], reached: reached.reach }));
        const first = yield* startedTurn(world, thread.id, 'как дела');
        yield* reached.reached;
        expect(
          yield* world.harness.threads.handle(thread.id, OWNER).steer({ expectedRunId: first.runId, text: 'и ещё вот это' }),
        ).toMatchObject({
          status: 'steered',
          runId: first.runId,
        });
        world.plan.push(reply('f1', 'Прочитал.'));
        expect(yield* world.harness.threads.handle(thread.id, OWNER).stop(undefined, { withdraw: true })).toMatchObject({
          status: 'stopped',
        });
        yield* until(() =>
          Effect.map(transcriptOf(storage, thread.id), (entries) =>
            entries.some((entry) => coreEntry(entry) && entry.type === 'message' && entry.text === 'Прочитал.'),
          ),
        );
        const finalRow = yield* storage.aggregate.find(thread.id);
        const finalRowTranscript = yield* transcriptOf(storage, thread.id);
        if (!finalRow) return yield* Effect.die('The thread disappeared under the proof.');
        expect(finalRowTranscript.filter((entry) => coreEntry(entry) && entry.type === 'message' && entry.role === 'user')).toMatchObject([
          { text: 'как дела' },
        ]);
      }),
    );
    test(
      'a run that had only been thinking still gives its turn back',
      Effect.fnUntraced(function* () {
        const { storage, world, thread } = yield* openedRun(open);
        const reached = gate();
        world.plan.push(
          hangingTurn({
            chunks: [
              { type: 'reasoning-start', id: 'r1' },
              { type: 'reasoning-delta', id: 'r1', text: 'Взвешиваю вопрос.' },
            ],
            reached: reached.reach,
          }),
        );
        const first = yield* startedTurn(world, thread.id, 'как дела');
        const pumping = yield* Effect.forkScoped(pump(first));
        yield* reached.reached;
        yield* until(() =>
          Effect.map(storage.runs({ ownerId: 'observer', scope: SCOPE }).latestRun(thread.id), (row) => Boolean(row?.streamTail?.length)),
        );
        expect(yield* world.harness.threads.handle(thread.id, OWNER).stop(undefined, { withdraw: true })).toMatchObject({
          status: 'stopped',
        });
        yield* Fiber.join(pumping);
        yield* until(() => Effect.map(storage.aggregate.find(thread.id), (row) => row?.status === 'idle'));
        const finalRow = yield* storage.aggregate.find(thread.id);
        const finalRowTranscript = yield* transcriptOf(storage, thread.id);
        if (!finalRow) return yield* Effect.die('The thread disappeared under the proof.');
        expect(finalRowTranscript.filter((entry) => entry.type === 'message' || entry.type === 'reasoning')).toEqual([]);
        expect(JSON.stringify(finalRow.history)).not.toContain('как дела');
      }),
    );
    test(
      'a stop keeps the turn of a run that already said something',
      Effect.fnUntraced(function* () {
        const { storage, world, thread } = yield* openedRun(open);
        const reached = gate();
        world.plan.push(
          hangingTurn({
            chunks: [
              { type: 'text-start', id: 'h1' },
              { type: 'text-delta', id: 'h1', text: 'Уже отвечаю' },
            ],
            reached: reached.reach,
          }),
        );
        const first = yield* startedTurn(world, thread.id, 'как дела');
        const pumping = yield* Effect.forkScoped(pump(first));
        yield* reached.reached;
        yield* until(() =>
          Effect.map(storage.runs({ ownerId: 'observer', scope: SCOPE }).latestRun(thread.id), (row) => Boolean(row?.streamTail)),
        );
        expect(yield* world.harness.threads.handle(thread.id, OWNER).stop(undefined, { withdraw: true })).toMatchObject({
          status: 'stopped',
        });
        yield* Fiber.join(pumping);
        yield* until(() => Effect.map(storage.aggregate.find(thread.id), (row) => row?.status === 'idle'));
        const finalRow = yield* storage.aggregate.find(thread.id);
        const finalRowTranscript = yield* transcriptOf(storage, thread.id);
        if (!finalRow) return yield* Effect.die('The thread disappeared under the proof.');
        const said = finalRowTranscript.filter((entry) => coreEntry(entry) && entry.type === 'message' && entry.role === 'user');
        expect(said).toHaveLength(1);
        expect(said[0]).toMatchObject({ text: 'как дела' });
        expect(JSON.stringify(finalRow.history)).toContain('как дела');
      }),
    );
    test(
      'a steer the stopped run never read is answered without being said twice',
      Effect.fnUntraced(function* () {
        const { storage, world, thread } = yield* openedRun(open);
        const reached = gate();
        world.plan.push(
          hangingTurn({
            chunks: [
              { type: 'text-start', id: 'h1' },
              { type: 'text-delta', id: 'h1', text: 'Working on it' },
            ],
            reached: reached.reach,
          }),
        );
        const first = yield* startedTurn(world, thread.id, 'Start something long.');
        const pumping = yield* Effect.forkScoped(pump(first));
        yield* reached.reached;
        expect(
          yield* world.harness.threads.handle(thread.id, OWNER).steer({ expectedRunId: first.runId, text: 'Answer this instead.' }),
        ).toMatchObject({ status: 'steered', runId: first.runId });
        world.plan.push(reply('f1', 'Answered.'));
        expect(yield* world.harness.threads.handle(thread.id, OWNER).stop()).toMatchObject({ status: 'stopped' });
        yield* Fiber.join(pumping);
        yield* until(() =>
          Effect.map(transcriptOf(storage, thread.id), (entries) =>
            entries.some((entry) => coreEntry(entry) && entry.type === 'message' && entry.text === 'Answered.'),
          ),
        );
        const runs = storage.runs({ ownerId: 'observer', scope: SCOPE });
        yield* until(() => Effect.map(runs.latestRun(thread.id), (row) => row?.id !== first.runId && row?.status === 'completed'));
        expect(yield* inboxQueued(storage, thread.id, 'signal')).toHaveLength(0);
        const followup = yield* runs.latestRun(thread.id);
        expect(followup?.id).not.toBe(first.runId);
        expect(followup?.status).toBe('completed');
        const finalRow = yield* storage.aggregate.find(thread.id);
        const finalRowTranscript = yield* transcriptOf(storage, thread.id);
        if (!finalRow) return yield* Effect.die('The thread disappeared under the proof.');
        expect(
          finalRowTranscript.filter((entry) => coreEntry(entry) && entry.type === 'signal' && entry.text === 'Answer this instead.'),
        ).toHaveLength(1);
        expect(
          finalRowTranscript.filter(
            (entry) => coreEntry(entry) && entry.type === 'message' && entry.role === 'user' && entry.text === 'Answer this instead.',
          ),
        ).toHaveLength(0);
        expect(finalRowTranscript.some((entry) => entry.type === 'interruption')).toBe(true);
        expect(foldEntries(yield* readThreadEvents(storage.eventLog, storage.kinds, thread.id, 0, 1_000))).toEqual(finalRowTranscript);
      }),
    );
    test(
      'after a stop the unread steers and the queued turns go out in one run, in the order they were pressed',
      Effect.fnUntraced(function* () {
        const { storage, world, thread } = yield* openedRun(open);
        const handle = world.harness.threads.handle(thread.id, OWNER);
        const reached = gate();
        world.plan.push(
          hangingTurn({
            chunks: [
              { type: 'text-start', id: 'h1' },
              { type: 'text-delta', id: 'h1', text: 'Working on it' },
            ],
            reached: reached.reach,
          }),
        );
        const first = yield* startedTurn(world, thread.id, 'Start the migration.');
        const pumping = yield* Effect.forkScoped(pump(first));
        yield* reached.reached;
        yield* queuedTurn(handle, 'Then write the note.');
        expect(yield* handle.steer({ expectedRunId: first.runId, text: 'Read this now.' })).toMatchObject({ status: 'steered' });
        yield* queuedTurn(handle, 'And open the request.');
        expect(yield* handle.send('And this.')).toMatchObject({ status: 'steered', runId: first.runId });
        world.plan.push(reply('f1', 'All read.'));
        expect(yield* handle.stop()).toMatchObject({ status: 'stopped' });
        yield* Fiber.join(pumping);
        yield* until(() =>
          Effect.map(transcriptOf(storage, thread.id), (entries) =>
            entries.some((entry) => coreEntry(entry) && entry.type === 'message' && entry.text === 'All read.'),
          ),
        );
        const runs = yield* storage.runs({ ownerId: 'observer', scope: SCOPE }).runsOf(thread.id);
        expect(runs).toHaveLength(2);
        expect(yield* inboxQueued(storage, thread.id)).toHaveLength(0);
        const finalRowTranscript = yield* transcriptOf(storage, thread.id);
        const said = finalRowTranscript.filter(
          (entry) => coreEntry(entry) && (entry.type === 'signal' || (entry.type === 'message' && entry.role === 'user')),
        );
        expect(said.map((entry) => [entry.type, entry.runId, 'text' in entry ? entry.text : null])).toEqual([
          ['message', first.runId, 'Start the migration.'],
          ['message', runs.at(-1)?.id, 'Then write the note.\nRead this now.\nAnd open the request.\nAnd this.'],
        ]);
        const heard = JSON.stringify(world.replayed.at(-1) ?? []);
        expect(heard.split('Read this now.')).toHaveLength(2);
        expect(heard).toContain('Then write the note.\\nRead this now.\\nAnd open the request.\\nAnd this.');
        expect(foldEntries(yield* readThreadEvents(storage.eventLog, storage.kinds, thread.id, 0, 1_000))).toEqual(finalRowTranscript);
      }),
    );
    test(
      'a steer named for a run that no longer holds the thread is kept: with no run going it opens one, under another run it waits for the turn after it',
      Effect.fnUntraced(function* () {
        const { storage, world, thread } = yield* openedRun(open);
        const handle = world.harness.threads.handle(thread.id, OWNER);
        const reached = gate();
        world.plan.push(hangingTurn({ chunks: [{ type: 'text-start', id: 'h1' }], reached: reached.reach }));
        const opened = yield* handle.steer({ expectedRunId: 'run-nobody-has', text: 'Use the other table.' });
        if (opened.status !== 'started') return yield* Effect.die(`The kept steer answered ${opened.status} instead of opening a run.`);
        const pumping = yield* Effect.forkScoped(pump({ world, threadId: thread.id, runId: opened.runId, entry: opened.entry }));
        yield* reached.reached;
        expect(yield* handle.steer({ expectedRunId: 'run-that-ended', text: 'Then the next one.' })).toMatchObject({
          status: 'queued',
          runId: opened.runId,
        });
        expect(yield* handle.stop('run-that-ended')).toEqual({ status: 'run-mismatch', runId: opened.runId });
        world.plan.push(reply('f1', 'Took it.'));
        expect(yield* handle.stop()).toEqual({ status: 'stopped', runId: opened.runId });
        yield* Fiber.join(pumping);
        yield* until(() =>
          Effect.map(transcriptOf(storage, thread.id), (entries) =>
            entries.some((entry) => coreEntry(entry) && entry.type === 'message' && entry.text === 'Took it.'),
          ),
        );
        const said = (yield* transcriptOf(storage, thread.id)).filter(
          (entry) => coreEntry(entry) && entry.type === 'message' && entry.role === 'user',
        );
        expect(said.map((entry) => ('text' in entry ? entry.text : null))).toEqual(['Use the other table.', 'Then the next one.']);
        expect(yield* inboxQueued(storage, thread.id)).toHaveLength(0);
      }),
    );
    test(
      'words pressed while the run stops, Tab and Enter, go out once each in the one run after the stop',
      Effect.fnUntraced(function* () {
        const { storage, world, thread } = yield* openedRun(open);
        const reached = gate();
        let firstRunId = '';
        world.plan.push(
          hangingTurn({
            chunks: [
              { type: 'text-start', id: 'h1' },
              { type: 'text-delta', id: 'h1', text: 'Working on it' },
            ],
            reached: reached.reach,
            onAbort: Effect.fnUntraced(function* () {
              const waiting = yield* queuedTurn(world.harness.threads.handle(thread.id, OWNER), 'Take this into the next turn.');
              if (waiting.runId !== firstRunId) return yield* Effect.die(`The late words waited behind ${waiting.runId}.`);
              const steered = yield* world.harness.threads.handle(thread.id, OWNER).send('And read this as it stops.');
              if (steered.status !== 'steered') return yield* Effect.die(`The late Enter answered ${steered.status}.`);
            }),
          }),
        );
        const first = yield* startedTurn(world, thread.id, 'Start something long.');
        firstRunId = first.runId;
        const pumping = yield* Effect.forkScoped(pump(first));
        yield* reached.reached;
        world.plan.push(reply('f1', 'Took it.'));
        expect(yield* world.harness.threads.handle(thread.id, OWNER).stop()).toMatchObject({ status: 'stopped' });
        yield* Fiber.join(pumping);
        yield* until(() =>
          Effect.map(transcriptOf(storage, thread.id), (entries) =>
            entries.some((entry) => coreEntry(entry) && entry.type === 'message' && entry.text === 'Took it.'),
          ),
        );
        expect(yield* inboxQueued(storage, thread.id)).toHaveLength(0);
        const runs = yield* storage.runs({ ownerId: 'observer', scope: SCOPE }).runsOf(thread.id);
        expect(runs).toHaveLength(2);
        const said = (yield* transcriptOf(storage, thread.id)).filter(
          (entry) => coreEntry(entry) && (entry.type === 'signal' || (entry.type === 'message' && entry.role === 'user')),
        );
        expect(said.map((entry) => [entry.runId, 'text' in entry ? entry.text : null])).toEqual([
          [firstRunId, 'Start something long.'],
          [runs.at(-1)?.id, 'Take this into the next turn.\nAnd read this as it stops.'],
        ]);
      }),
    );
    test(
      'two Enters racing to open the run of an idle thread are each said once',
      Effect.fnUntraced(function* () {
        const { storage, world, thread } = yield* openedRun(open);
        const handle = world.harness.threads.handle(thread.id, OWNER);
        world.plan.push(reply('r1', 'First answer.'), reply('r2', 'Second answer.'));
        const answers = yield* Effect.all([handle.send('Alpha words.'), handle.send('Bravo words.')], { concurrency: 'unbounded' });
        expect(answers.map((answer) => answer.status).sort()).toEqual(expect.arrayContaining(['started']));
        const runs = storage.runs({ ownerId: 'observer', scope: SCOPE });
        yield* until(() =>
          Effect.flatMap(inboxQueued(storage, thread.id), (waiting) =>
            Effect.map(runs.latestRun(thread.id), (latest) => waiting.length === 0 && latest !== null && latest.status !== 'running'),
          ),
        );
        const heard = (yield* transcriptOf(storage, thread.id))
          .filter((entry) => coreEntry(entry) && (entry.type === 'signal' || (entry.type === 'message' && entry.role === 'user')))
          .map((entry) => ('text' in entry ? entry.text : ''))
          .join('\n');
        expect(heard.split('Alpha words.')).toHaveLength(2);
        expect(heard.split('Bravo words.')).toHaveLength(2);
      }),
    );
    test(
      'a failing settle hook does not hold the follow-up, and its redelivery starts no second one',
      Effect.fnUntraced(function* () {
        const storage = yield* Effect.acquireRelease(open(), (storage) => storage.dispose());
        const thread = yield* storage.createThread({ ownerId: OWNER, scope: SCOPE });
        let failedOnce = false;
        const processA = yield* scriptedWorld(storage, thread.agentId, {
          onSettled: () =>
            Effect.suspend(() => {
              if (failedOnce) return Effect.void;
              failedOnce = true;
              return Effect.fail(new ThreadCallBroke({ cause: new Error('The process died before confirming the settle.') }));
            }),
        });
        const held = gate();
        processA.plan.push(heldTurn(held.released), reply('t2', 'Followed up.'));
        const first = yield* startedTurn(processA, thread.id, 'Begin.');
        const waiting = yield* queuedTurn(processA.harness.threads.handle(thread.id, OWNER), 'And then this.');
        expect(waiting.runId).toBe(first.runId);
        held.release();
        const runsPort = storage.runs({ ownerId: 'observer', scope: SCOPE });
        yield* until(() =>
          Effect.map(runsPort.latestRun(thread.id), (latest) => failedOnce && latest?.id !== first.runId && latest?.status === 'completed'),
        );
        const followup = yield* runsPort.latestRun(thread.id);
        const deliveredB: string[] = [];
        const processB = yield* scriptedWorld(storage, thread.agentId, {
          onSettled: (event) => Effect.asVoid(Effect.sync(() => deliveredB.push(event.runId))),
          rhythm: { settledClaimAfterMs: -1_000 },
        });
        expect(yield* processB.harness.runs.recoverNow()).toBe(0);
        expect(deliveredB).toContain(first.runId);
        yield* until(() => Effect.map(storage.aggregate.find(thread.id), (row) => row?.status === 'idle'));
        expect((yield* runsPort.runsOf(thread.id)).map((run): string => run.id)).toEqual([first.runId, followup?.id ?? '']);
        expect(
          (yield* transcriptOf(storage, thread.id)).filter(
            (entry) => coreEntry(entry) && entry.type === 'message' && entry.role === 'user' && entry.text === 'And then this.',
          ),
        ).toHaveLength(1);
      }),
    );
    test(
      'an acceptance that cannot inherit the request takes nothing, and the next one takes both',
      Effect.fnUntraced(function* () {
        const storage = yield* Effect.acquireRelease(open(), (storage) => storage.dispose());
        const thread = yield* storage.createThread({ ownerId: OWNER, scope: SCOPE });
        const sender = yield* storage.createThread({ ownerId: OWNER, scope: SCOPE });
        const inbox = new BrokenCarryInbox(storage.inbox);
        const processA = yield* scriptedWorld(withInbox(storage, inbox.faces), thread.agentId);
        const reached = gate();
        processA.plan.push(
          hangingTurn({
            chunks: [
              { type: 'text-start', id: 'h1' },
              { type: 'text-delta', id: 'h1', text: 'Working' },
            ],
            reached: reached.reach,
          }),
          reportTurn(),
        );
        const first = yield* startedTurn(processA, thread.id, 'Start something long.');
        const pumping = yield* Effect.forkScoped(pump(first));
        yield* reached.reached;
        yield* queuedTurn(processA.harness.threads.handle(thread.id, OWNER), 'And then this.');
        yield* storage.inbox.put({
          id: 'task-carry',
          threadId: thread.id,
          sender: { kind: 'thread', threadId: sender.id, name: null },
          kind: 'task',
          body: { intent: 'task', text: 'work out the branch', inReplyTo: null },
          occurredAt: new Date(1_000).toISOString(),
        });
        yield* storage.inbox.deliver(['task-carry'], first.runId);
        inbox.breakNextCarryOf('task-carry');
        expect(yield* processA.harness.threads.handle(thread.id, OWNER).stop()).toMatchObject({ status: 'stopped' });
        yield* Fiber.join(pumping);
        const runsPort = storage.runs({ ownerId: 'observer', scope: SCOPE });
        yield* until(() => Effect.map(inboxQueued(storage, thread.id, 'turn'), (items) => items.length === 0));
        yield* until(() => Effect.map(runsPort.latestRun(thread.id, ['running']), (row) => row === null));
        const spoken = (yield* transcriptOf(storage, thread.id)).filter(
          (entry) => coreEntry(entry) && entry.type === 'message' && entry.role === 'user' && entry.text === 'And then this.',
        );
        expect(spoken).toHaveLength(1);
        const carrier = spoken[0]?.runId;
        expect(carrier).not.toBe(first.runId);
        expect(yield* standingOf(storage, 'task-carry')).toMatchObject({ runId: carrier });
      }),
    );
    test(
      'restarting a thread stops its hanging run, records the restart once and continues the turn in a new run',
      Effect.fnUntraced(function* () {
        const { storage, world, thread } = yield* openedRun(open);
        const reached = gate();
        world.plan.push(hangingTurn({ chunks: [], reached: reached.reach }));
        const hung = yield* startedTurn(world, thread.id, 'Hang here.');
        const pumping = yield* Effect.forkScoped(pump(hung));
        yield* reached.reached;
        world.plan.push(reply('continued', 'Picked up again.'));
        const restarted = yield* world.harness.threads.handle(thread.id, OWNER).restart();
        yield* Fiber.join(pumping);
        expect(restarted.stoppedRunId).toBe(hung.runId);
        if (restarted.runId === null) return yield* Effect.die(new Error('the restart continued no run'));
        yield* pump({ ...hung, runId: restarted.runId });
        const runs = storage.runs({ ownerId: 'observer', scope: SCOPE });
        expect((yield* runs.runById(hung.runId))?.status).toBe('aborted');
        expect((yield* runs.runById(restarted.runId))?.status).toBe('completed');
        expect((yield* transcriptOf(storage, thread.id)).filter((entry) => entry.type === 'restart')).toEqual([
          expect.objectContaining({ stoppedRunId: hung.runId, calls: [] }),
        ]);
      }),
    );
  });
}
