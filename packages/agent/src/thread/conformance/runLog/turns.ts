import { callerInThread } from '../../../agent/testing/caller';
import { describe, expect } from 'bun:test';
import type { Tester } from '@runlith/effect-test';
import { Deferred, Effect, Fiber, type Scope } from 'effect';
import { toolExecute } from '../../../agent/tool';
import { HistoryFold } from '../../HistoryFold';
import { Message, ToolResultPart } from '@runlith/llm/schema/messages';
import { Usage } from '@runlith/llm/schema/events';
import { foldThreadTranscript } from '../../../transcript/eventFold';
import type { ThreadTranscript } from '../../../transcript/rows';
import type { ThreadStorageFactory } from '../storagePort';
import type { ThreadRunSettled } from '../../run/ThreadRunLedger';
import { threadResumeEvent, decodeThreadFeedEvent } from '../../../protocol/http';
import { threadWireDeltas } from '../../ThreadWireDeltas';
import { readThreadEvents } from '../../events';
import { ThreadCallBroke } from '../../ThreadBorder';
import { supplied } from '../../agents/supply';
import { OWNER, SCOPE, scriptedWorld, openedRun, pump, startedTurn, queuedTurn, steeredWords, type ScriptedInput } from './world';
import { replyTurn, steeredTurn, hangingTurn, scriptedStep } from './scripts';
import { gate, transcriptOf, inboxQueued, until, foldEntries, messageText } from './support';
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
export function describeThreadRunTurns<TTx, TWrite extends TTx = TTx, R = never>(
  name: string,
  open: ThreadStorageFactory<TTx, TWrite, R>,
  test: Tester<Scope.Scope | R>,
): void {
  describe(`${name}: the run over the log — turns, steers and stops`, () => {
    test(
      'a run`s whole output is events, and every reader is a fold of the log',
      Effect.fnUntraced(function* () {
        const { storage, world, thread } = yield* openedRun(open);
        world.plan.push(
          replyTurn({
            chunks: [
              { type: 'reasoning-start', id: 'r1' },
              { type: 'reasoning-delta', id: 'r1', text: 'Weighing the ask.' },
              { type: 'reasoning-end', id: 'r1' },
              { type: 'text-start', id: 't1' },
              { type: 'text-delta', id: 't1', text: 'The build ' },
              { type: 'text-delta', id: 't1', text: 'is green.' },
              { type: 'text-end', id: 't1' },
            ],
            steps: [
              scriptedStep({
                text: 'The build is green.',
                messages: [Message.assistant('The build is green.')],
                usage: new Usage({ inputTokens: 1_200, outputTokens: 40, totalTokens: 1_240 }),
              }),
            ],
          }),
        );
        const first = yield* startedTurn(world, thread.id, 'Check the build.');
        yield* pump(first);
        const afterFirst = yield* storage.aggregate.find(thread.id);
        const afterFirstTranscript = yield* transcriptOf(storage, thread.id);
        expect(afterFirst?.systemPrompt).toContain('Scripted prompt v1');
        expect(afterFirstTranscript[0]).toMatchObject({ type: 'system-prompt', text: afterFirst?.systemPrompt });
        expect(afterFirstTranscript.slice(-3)).toMatchObject([
          { type: 'reasoning', text: 'Weighing the ask.' },
          { type: 'message', role: 'assistant', text: 'The build is green.' },
          { type: 'run-end', status: 'completed', runId: first.runId },
        ]);
        const firstEvents = yield* readThreadEvents(storage.eventLog, storage.kinds, thread.id, 0, 1_000);
        const stepEvent = firstEvents.find((event) => event.kind === 'step');
        expect(stepEvent?.payload.usage).toMatchObject({ inputTokens: 1_200, outputTokens: 40 });
        expect(stepEvent?.payload.context).toMatchObject({ stepNumber: 0, provider: thread.provider });
        expect(afterFirst?.contextReading).toMatchObject({ stepNumber: 0, stale: false, usage: { totalTokens: 1_240 } });
        const billedRun = yield* storage.runs({ ownerId: 'observer', scope: SCOPE }).latestRun(thread.id);
        expect(billedRun?.usage).toMatchObject({ inputTokens: 1_200, outputTokens: 40, totalTokens: 1_240 });
        expect(afterFirstTranscript.at(-1)).toMatchObject({
          type: 'run-end',
          startedAt: billedRun!.startedAt.toISOString(),
          finishedAt: billedRun!.finishedAt!.toISOString(),
        });
        const compositionEvent = firstEvents.find((event) => event.kind === 'composition');
        expect(compositionEvent?.payload.entry).toMatchObject({ type: 'composition', tools: { count: 0, chars: 0 } });
        const composed = compositionEvent?.payload.entry as
          | {
              system?: {
                chars?: unknown;
              };
            }
          | undefined;
        expect(typeof composed?.system?.chars).toBe('number');
        yield* world.harness.threads.handle(thread.id, OWNER).attachContext({ title: 'Release notes', text: 'Nothing breaks.' });
        const held = yield* world.harness.reads.snapshot(thread.id);
        world.plan.push(
          replyTurn({
            chunks: [
              { type: 'tool-call', id: 'call-1', name: 'graph_probe', input: { block: 'one' } },
              { type: 'text-start', id: 't2' },
              { type: 'text-delta', id: 't2', text: 'Probed.' },
              { type: 'text-end', id: 't2' },
              { type: 'tool-result', id: 'call-1', name: 'graph_probe', result: { type: 'json', value: { ok: true } } },
            ],
            steps: [
              scriptedStep({
                text: '',
                messages: [
                  Message.assistant([{ type: 'tool-call', id: 'call-1', name: 'graph_probe', input: { block: 'one' } }]),
                  Message.tool(ToolResultPart.from({ id: 'call-1', name: 'graph_probe', result: { ok: true } })),
                ],
                toolCalls: [{ toolCallId: 'call-1', toolName: 'graph_probe', input: { block: 'one' } }],
                toolResults: [{ toolCallId: 'call-1', toolName: 'graph_probe', output: { ok: true } }],
              }),
              scriptedStep({ text: 'Probed.', messages: [Message.assistant('Probed.')] }),
            ],
          }),
        );
        const second = yield* startedTurn(world, thread.id, 'Probe the graph.');
        yield* pump(second);
        expect(world.ranWith).toHaveLength(2);
        expect(world.ranWith[0]).toBe(world.ranWith[1]);
        expect(world.ranWith[0]).toContain('Scripted prompt v1');
        expect(world.resolved()).toBe(1);
        const reached = gate();
        world.plan.push(
          hangingTurn({
            chunks: [
              { type: 'reasoning-start', id: 'r3' },
              { type: 'reasoning-delta', id: 'r3', text: 'Thinking about the tear.' },
              { type: 'text-start', id: 't3' },
              { type: 'text-delta', id: 't3', text: 'Half a par' },
            ],
            reached: reached.reach,
          }),
        );
        const third = yield* startedTurn(world, thread.id, 'Hang here.');
        const pumping = yield* Effect.forkScoped(pump(third));
        yield* reached.reached;
        expect(yield* world.harness.threads.handle(thread.id, OWNER).stop()).toMatchObject({ status: 'stopped' });
        yield* Fiber.join(pumping);
        const runs = storage.runs({ ownerId: 'observer', scope: SCOPE });
        const torn = yield* runs.latestRun(thread.id);
        expect(torn?.status).toBe('aborted');
        expect(torn?.streamTail).toBeNull();
        const finalRow = yield* storage.aggregate.find(thread.id);
        const finalRowTranscript = yield* transcriptOf(storage, thread.id);
        if (!finalRow) return yield* Effect.die('The thread disappeared under the proof.');
        expect(finalRowTranscript.slice(-4)).toEqual([
          expect.objectContaining({ type: 'reasoning', state: 'done', text: 'Thinking about the tear.' }),
          expect.objectContaining({ type: 'message', role: 'assistant', text: 'Half a par' }),
          expect.objectContaining({ type: 'interruption' }),
          expect.objectContaining({
            type: 'run-end',
            status: 'aborted',
            startedAt: torn!.startedAt.toISOString(),
            finishedAt: torn!.finishedAt!.toISOString(),
          }),
        ]);
        const events = yield* readThreadEvents(storage.eventLog, storage.kinds, thread.id, 0, 1_000);
        expect(events.map((event) => event.position)).toEqual(events.map((_, index) => index + 1));
        expect(yield* storage.eventLog.headPosition(thread.id)).toBe(events.length);
        expect(foldEntries(events)).toEqual(finalRowTranscript);
        expect(
          events
            .reduce((fold, event) => {
              fold.fold(event, event.position);
              return fold;
            }, new HistoryFold())
            .take(),
        ).toEqual([...finalRow.history]);
        expect(events[0]?.kind).toBe('message');
        const promptEvents = events.filter((event) => event.kind === 'system-prompt');
        expect(promptEvents).toHaveLength(1);
        expect(
          (
            promptEvents[0]?.payload.entry as
              | {
                  text?: string;
                }
              | undefined
          )?.text,
        ).toContain('Scripted prompt v1');
        const toolEvents = events.filter((event) => event.kind === 'tool');
        expect(toolEvents).toHaveLength(2);
        const toolIds = new Set(toolEvents.map((event) => event.payload.entry?.id));
        expect(toolIds.size).toBe(1);
        const [toolId] = toolIds;
        expect(finalRowTranscript.filter((entry) => entry.id === toolId)).toEqual([
          expect.objectContaining({ toolState: 'output-available' }),
        ]);
        const closedIds = events.flatMap((event) =>
          event.kind === 'message' || event.kind === 'reasoning' || event.kind === 'system-prompt' ? [event.payload.entry?.id] : [],
        );
        expect(new Set(closedIds).size).toBe(closedIds.length);
        expect(events.at(-1)?.kind).toBe('run-end');
        const deltas = yield* threadWireDeltas(storage.eventLog, storage.kinds, thread.id, held.position);
        if (!deltas) return yield* Effect.die('The resume window refused a position it just handed out.');
        let resumed: ThreadTranscript = held.transcript;
        for (const delta of deltas) resumed = foldThreadTranscript(resumed, delta);
        expect(resumed).toEqual(finalRowTranscript);
        const wholeLog = yield* threadWireDeltas(storage.eventLog, storage.kinds, thread.id, 0);
        if (!wholeLog) return yield* Effect.die('The resume window refused the log it just wrote.');
        expect(wholeLog.reduce(foldThreadTranscript, held.transcript)).toEqual(finalRowTranscript);
        expect(wholeLog.reduce(foldThreadTranscript, finalRowTranscript)).toEqual(finalRowTranscript);
        expect([...finalRow.history].at(-1)).toEqual(Message.assistant('Half a par'));
        world.plan.push(reply('t4', 'Resuming.'));
        yield* pump(yield* startedTurn(world, thread.id, 'Continue.'));
        const replay = world.replayed.at(-1) ?? [];
        const tearIndex = replay.findIndex((message) => message.role === 'user' && messageText(message) === 'Hang here.');
        const tornIndex = replay.findIndex((message) => message.role === 'assistant' && messageText(message) === 'Half a par');
        expect(tearIndex).toBeGreaterThanOrEqual(0);
        expect(tornIndex).toBeGreaterThan(tearIndex);
        const beforeResume = yield* readThreadEvents(storage.eventLog, storage.kinds, thread.id, 0, 1_000);
        const lastRow = yield* storage.aggregate.find(thread.id);
        const lastRowTranscript = yield* transcriptOf(storage, thread.id);
        if (!lastRow) return yield* Effect.die('The thread disappeared under the proof.');
        const attached = yield* world.harness.reads.attachFrom(thread.id, held.position);
        if (!attached) return yield* Effect.die('The resume window refused a position it just handed out.');
        const wire = decodeThreadFeedEvent(JSON.parse(JSON.stringify(threadResumeEvent(attached, { position: held.position, seq: 0 }))));
        if (wire.type !== 'resume') return yield* Effect.die('The resume event did not survive its own wire.');
        let wireFolded: ThreadTranscript = held.transcript;
        for (const delta of wire.payload.records) wireFolded = foldThreadTranscript(wireFolded, delta);
        expect(wireFolded).toEqual(lastRowTranscript);
        expect(wire.at.position).toBe(beforeResume.length);
        const afterResume = yield* readThreadEvents(storage.eventLog, storage.kinds, thread.id, 0, 1_000);
        expect(afterResume.map((event) => [event.id, event.position])).toEqual(beforeResume.map((event) => [event.id, event.position]));
        expect(yield* storage.eventLog.headPosition(thread.id)).toBe(beforeResume.length);
      }),
    );
    test(
      'the words are acknowledged and durable while the agent is still opening the run',
      Effect.fnUntraced(function* () {
        const storage = yield* Effect.acquireRelease(open(), (storage) => storage.dispose());
        const thread = yield* storage.createThread({ ownerId: OWNER, scope: SCOPE });
        const opening = gate();
        let openings = 0;
        const world = yield* scriptedWorld(storage, thread.agentId, {
          opening: () =>
            Effect.andThen(
              Effect.sync(() => {
                openings += 1;
              }),
              opening.released,
            ),
        });
        world.plan.push(reply('t1', 'Opened.'));
        const first = yield* startedTurn(world, thread.id, 'Answer when you can.');
        yield* until(() => Effect.sync(() => openings === 1));
        const runs = storage.runs({ ownerId: 'observer', scope: SCOPE });
        expect(yield* runs.latestRun(thread.id)).toMatchObject({ id: first.runId, status: 'running' });
        const row = yield* storage.aggregate.find(thread.id);
        const transcript = yield* transcriptOf(storage, thread.id);
        expect(transcript.filter((entry) => coreEntry(entry) && entry.type === 'message' && entry.role === 'user')).toMatchObject([
          { id: first.entry.id, text: 'Answer when you can.' },
        ]);
        expect(row?.history.map(messageText)).toEqual(['Answer when you can.']);
        expect(world.ranWith).toHaveLength(0);
        opening.release();
        yield* pump(first);
        expect(yield* runs.latestRun(thread.id)).toMatchObject({ id: first.runId, status: 'completed' });
        expect(world.ranWith).toHaveLength(1);
        expect(world.prepared()).toBe(1);
        expect(
          (yield* transcriptOf(storage, thread.id)).some(
            (entry) => coreEntry(entry) && entry.type === 'message' && entry.text === 'Opened.',
          ),
        ).toBe(true);
      }),
    );
    test(
      'an agent that fails to open is a run failed at its first step, and the turn stands',
      Effect.fnUntraced(function* () {
        const storage = yield* Effect.acquireRelease(open(), (storage) => storage.dispose());
        const thread = yield* storage.createThread({ ownerId: OWNER, scope: SCOPE });
        const endings: ThreadRunSettled[] = [];
        let disposed = 0;
        const world = yield* scriptedWorld(storage, thread.agentId, {
          opening: () => Effect.fail(new ThreadCallBroke({ cause: new Error('The world state could not be read.') })),
          onSettled: (event) => Effect.asVoid(Effect.sync(() => endings.push(event))),
          outputsDisposed: () => {
            disposed += 1;
          },
        });
        const first = yield* startedTurn(world, thread.id, 'Begin anyway.');
        yield* pump(first);
        expect(yield* storage.runs({ ownerId: 'observer', scope: SCOPE }).latestRun(thread.id)).toMatchObject({
          id: first.runId,
          status: 'failed',
          failureReason: expect.stringContaining('The world state could not be read.'),
        });
        expect(endings.map((event) => [event.runId, event.status])).toEqual([[first.runId, 'failed']]);
        expect(disposed).toBe(1);
        const row = yield* storage.aggregate.find(thread.id);
        const transcript = yield* transcriptOf(storage, thread.id);
        expect(transcript.filter((entry) => coreEntry(entry) && entry.type === 'message' && entry.role === 'user')).toMatchObject([
          { id: first.entry.id, text: 'Begin anyway.' },
        ]);
        expect(transcript.some((entry) => entry.type === 'failure' && entry.runId === first.runId)).toBe(true);
        expect(row?.status).toBe('idle');
      }),
    );
    test(
      'words queued behind a run open their turn when a stop ends it',
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
        expect((yield* queuedTurn(world.harness.threads.handle(thread.id, OWNER), 'Actually, stop and report.')).runId).toBe(first.runId);
        world.plan.push(reply('f1', 'Reported.'));
        expect(yield* world.harness.threads.handle(thread.id, OWNER).stop()).toMatchObject({ status: 'stopped' });
        yield* Fiber.join(pumping);
        yield* until(() =>
          Effect.map(transcriptOf(storage, thread.id), (entries) =>
            entries.some((entry) => coreEntry(entry) && entry.type === 'message' && entry.text === 'Reported.'),
          ),
        );
        expect(yield* inboxQueued(storage, thread.id, 'turn')).toHaveLength(0);
        const finalRow = yield* storage.aggregate.find(thread.id);
        const finalRowTranscript = yield* transcriptOf(storage, thread.id);
        if (!finalRow) return yield* Effect.die('The thread disappeared under the proof.');
        expect(finalRowTranscript.some((entry) => entry.type === 'interruption')).toBe(true);
        expect(
          finalRowTranscript.filter((entry) => coreEntry(entry) && entry.type === 'message' && entry.role === 'user').at(-1),
        ).toMatchObject({ text: 'Actually, stop and report.' });
        expect(foldEntries(yield* readThreadEvents(storage.eventLog, storage.kinds, thread.id, 0, 1_000))).toEqual(finalRowTranscript);
      }),
    );
    test(
      'an envelope accepted before a snapshot failure still reaches the next input boundary, once',
      Effect.fnUntraced(function* () {
        const storage = yield* Effect.acquireRelease(open(), (storage) => storage.dispose());
        const thread = yield* storage.createThread({ ownerId: OWNER, scope: SCOPE });
        const captured = yield* Deferred.make<ScriptedInput>();
        const reached = gate();
        const read = gate();
        let snapshotFails = false;
        let words: readonly string[] = [];
        const world = yield* scriptedWorld(storage, thread.agentId, {
          rhythm: { takeoverAfterMs: 30_000 },
          toState: (state) =>
            snapshotFails
              ? Effect.fail(new ThreadCallBroke({ cause: new Error('snapshot publication failed') }))
              : Effect.succeed({
                  ...state,
                  transcript: [],
                  before: null,
                  live: { at: { position: state.position, seq: 0 }, open: [], progress: null },
                }),
        });
        try {
          world.plan.push((input) => {
            Deferred.doneUnsafe(captured, Effect.succeed(input));
            return steeredTurn({
              reached: reached.reach,
              released: reached.released,
              onDrained: (texts) => {
                words = texts;
              },
              drainSeen: { reached: read.reach, released: read.released },
            })(input);
          });
          const running = yield* startedTurn(world, thread.id, 'Wait for the result.');
          const pumping = yield* Effect.forkScoped(pump(running));
          yield* reached.reached;
          const input = yield* Deferred.await(captured);
          const given = yield* supplied(input.supply, null, input.thread.profile);
          const sendTool = given.supply.contributions.flatMap((contribution) =>
            'tools' in contribution && contribution.source === 'collaboration' && contribution.tools.send_message
              ? [contribution.tools.send_message]
              : [],
          )[0];
          const send = sendTool ? toolExecute(sendTool) : null;
          if (!send) return yield* Effect.die('The real collaboration tools were not mounted.');
          snapshotFails = true;
          const answer = yield* send(
            { to: [thread.id], message: 'Accepted result' },
            { toolCallId: 'send', caller: callerInThread(thread.id, input.run.id), messages: input.messages },
          );
          expect(answer).toMatchObject({
            value: { deliveries: [{ status: 'pending', failure: expect.stringContaining('snapshot publication failed') }] },
          });
          snapshotFails = false;
          reached.release();
          yield* read.reached;
          expect(words).toEqual(['Accepted result']);
          expect(yield* input.signals.drain(2)).toEqual([]);
          expect(yield* storage.inbox.pending(thread.id)).toEqual([]);
          expect(
            (yield* storage.aggregate.find(thread.id))?.history.filter((message) => messageText(message).includes('Accepted result')),
          ).toHaveLength(1);
          read.release();
          yield* Fiber.join(pumping);
        } finally {
          snapshotFails = false;
          reached.release();
          read.release();
        }
      }),
    );
    test(
      'words steered into a running turn reach that run at its next step',
      Effect.fnUntraced(function* () {
        const { storage, world, thread } = yield* openedRun(open);
        const reached = gate();
        const drainSeen = gate();
        let drained: readonly string[] = [];
        world.plan.push(
          steeredTurn({
            reached: reached.reach,
            released: reached.released,
            onDrained: (texts) => {
              drained = texts;
            },
            drainSeen: { reached: drainSeen.reach, released: drainSeen.released },
          }),
        );
        const first = yield* startedTurn(world, thread.id, 'Start something long.');
        const pumping = yield* Effect.forkScoped(pump(first));
        yield* reached.reached;
        expect(
          yield* world.harness.threads.handle(thread.id, OWNER).steer({ expectedRunId: first.runId, text: 'Use the other table.' }),
        ).toMatchObject({ status: 'steered', runId: first.runId });
        reached.release();
        yield* drainSeen.reached;
        expect(yield* inboxQueued(storage, thread.id, 'signal')).toHaveLength(0);
        drainSeen.release();
        yield* Fiber.join(pumping);
        yield* until(() =>
          Effect.map(transcriptOf(storage, thread.id), (entries) =>
            entries.some((entry) => coreEntry(entry) && entry.type === 'message' && entry.role === 'assistant'),
          ),
        );
        expect(drained).toEqual(['Use the other table.']);
        const finalRun = yield* storage.runs({ ownerId: 'observer', scope: SCOPE }).latestRun(thread.id);
        expect(finalRun?.id).toBe(first.runId);
        expect(finalRun?.status).toBe('completed');
        expect(yield* inboxQueued(storage, thread.id, 'signal')).toHaveLength(0);
        const finalRow = yield* storage.aggregate.find(thread.id);
        const finalRowTranscript = yield* transcriptOf(storage, thread.id);
        if (!finalRow) return yield* Effect.die('The thread disappeared under the proof.');
        const shown = finalRowTranscript.filter((entry) => entry.type === 'signal' || entry.type === 'message');
        expect(shown.map((entry) => entry.type)).toEqual(['message', 'signal', 'message']);
        expect(shown[1]).toMatchObject({ type: 'signal', text: 'Use the other table.', addressee: 'reader' });
        expect(foldEntries(yield* readThreadEvents(storage.eventLog, storage.kinds, thread.id, 0, 1_000))).toEqual(finalRowTranscript);
      }),
    );
    test(
      'the queue verb on an idle thread opens the turn at once',
      Effect.fnUntraced(function* () {
        const { storage, world, thread } = yield* openedRun(open);
        world.plan.push(reply('q1', 'Noted.'));
        const said = yield* world.harness.threads.handle(thread.id, OWNER).queue('Then write the note.');
        if (said.status !== 'started') return yield* Effect.die(`The queue press answered ${said.status} on an idle thread.`);
        yield* pump({ world, threadId: thread.id, runId: said.runId, entry: said.entry });
        expect(yield* inboxQueued(storage, thread.id)).toHaveLength(0);
        expect(
          (yield* transcriptOf(storage, thread.id))
            .filter((entry) => coreEntry(entry) && entry.type === 'message' && entry.role === 'user')
            .at(-1),
        ).toMatchObject({ text: 'Then write the note.', runId: said.runId });
      }),
    );
    test(
      'words sent to a working thread go into the run that is going, naming no run',
      Effect.fnUntraced(function* () {
        const { storage, world, thread } = yield* openedRun(open);
        const reached = gate();
        world.plan.push(
          hangingTurn({
            chunks: [
              { type: 'text-start', id: 'h1' },
              { type: 'text-delta', id: 'h1', text: 'Working' },
            ],
            reached: reached.reach,
          }),
        );
        const first = yield* startedTurn(world, thread.id, 'Start something long.');
        const pumping = yield* Effect.forkScoped(pump(first));
        yield* reached.reached;
        expect(yield* steeredWords(world.harness.threads.handle(thread.id, OWNER), 'Use the other table.')).toEqual({ runId: first.runId });
        const waiting = yield* world.harness.reads.snapshot(thread.id);
        world.plan.push(reply('f1', 'Reported.'));
        expect(yield* world.harness.threads.handle(thread.id, OWNER).stop()).toMatchObject({ status: 'stopped' });
        yield* Fiber.join(pumping);
        expect(waiting.pendingInput.steers).toMatchObject([{ runId: first.runId, text: 'Use the other table.' }]);
        expect(waiting.pendingInput.queued).toEqual([]);
        expect((yield* storage.runs({ ownerId: 'observer', scope: SCOPE }).runsOf(thread.id)).map((run) => run.id)).toContain(first.runId);
      }),
    );
  });
}
