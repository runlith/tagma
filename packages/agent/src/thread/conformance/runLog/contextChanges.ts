import { describe, expect } from 'bun:test';
import type { Tester } from '@runlith/effect-test';
import { Effect, Fiber, type Scope } from 'effect';
import { Message } from '@runlith/llm/schema/messages';
import { Usage } from '@runlith/llm/schema/events';
import type { ThreadStorageFactory } from '../storagePort';
import type { ThreadQuestionEntry } from '../../../transcript/entries';
import { OWNER, SCOPE, scriptedWorld, openedRun, pump, startedTurn, queuedTurn, type ScriptedInput } from './world';
import { heldTurn, replyTurn, scriptedStep } from './scripts';
import { askingTurn, selectingCatalog, confirmingTurn, crossingTurn } from './toolScripts';
import { gate, transcriptOf, contextEntries, stepNumbersOf, contextRecords, inboxQueued, standingOf, until } from './support';
import { coreEntry, entryOf } from '../../../transcript/kinds';
export function describeThreadRunContextChanges<TTx, TWrite extends TTx = TTx, R = never>(
  name: string,
  open: ThreadStorageFactory<TTx, TWrite, R>,
  test: Tester<Scope.Scope | R>,
): void {
  describe(`${name}: the run over the log — context changes`, () => {
    test(
      'a change asked while a run waits for a person is published at the step its real answer resumes',
      Effect.fnUntraced(function* () {
        const selector = { names: ['thread-a'] as readonly string[], read: [] as readonly string[] };
        const catalog = selectingCatalog(selector);
        const { storage, world, thread } = yield* openedRun(open, { catalog });
        const handle = world.harness.threads.handle(thread.id, OWNER);
        yield* handle.setAuthorityMode('review');
        world.plan.push(confirmingTurn(catalog));
        yield* pump(yield* startedTurn(world, thread.id, 'Read the lineage.'));
        yield* until(() => Effect.map(storage.aggregate.find(thread.id), (row) => row?.pendingInteraction != null));
        const parked = (yield* storage.aggregate.find(thread.id))?.pendingInteraction as ThreadQuestionEntry;
        expect(yield* handle.changeContext({ requestId: 'req-1', sourceKey: 'tree-b' })).toMatchObject({ status: 'accepted' });
        expect(contextEntries(yield* transcriptOf(storage, thread.id))).toMatchObject([{ requestId: 'req-1', status: 'pending' }]);
        selector.names = ['thread-a', 'thread-b'];
        let generation = -1;
        world.plan.push(
          crossingTurn({
            world,
            said: ['Read it.', 'Working there now.'],
            reached: () => {},
            released: Effect.void,
            opening: { generation: 0 },
            between: null,
            onCrossed: (crossing) => {
              generation = crossing.generation;
            },
          }),
        );
        const resumed = yield* handle.answer({ questionId: parked.questionId, answers: [{ questionId: 'call-1', values: ['confirm'] }] });
        yield* until(() => Effect.map(storage.aggregate.find(thread.id), (row) => row?.status === 'idle'));
        expect(selector.read).toEqual(['thread-a']);
        expect(resumed.runId).toBe(parked.runId);
        expect((yield* transcriptOf(storage, thread.id)).filter((entry) => entry.type === 'tool')).toMatchObject([
          { toolCallId: 'call-1', toolState: 'output-available', toolOutput: { read: ['thread-a'] } },
        ]);
        expect(generation).toBe(1);
        expect(yield* stepNumbersOf(storage, thread.id, parked.runId)).toEqual([0, 1, 2]);
        expect(contextEntries(yield* transcriptOf(storage, thread.id))).toMatchObject([
          { requestId: 'req-1', status: 'published', fromGeneration: 0, generation: 1, stepNumber: 1, runId: parked.runId },
        ]);
      }),
    );
    test(
      'a change asked of a run stopped while it waits for a person ends with that run',
      Effect.fnUntraced(function* () {
        const { storage, world, thread } = yield* openedRun(open);
        const handle = world.harness.threads.handle(thread.id, OWNER);
        world.plan.push(askingTurn());
        yield* pump(yield* startedTurn(world, thread.id, 'Ask me which branch.'));
        yield* until(() => Effect.map(storage.aggregate.find(thread.id), (row) => row?.pendingInteraction != null));
        const parked = (yield* storage.aggregate.find(thread.id))?.pendingInteraction as ThreadQuestionEntry;
        yield* handle.changeContext({ requestId: 'req-1', sourceKey: 'tree-b' });
        expect(yield* handle.stop()).toMatchObject({ status: 'stopped' });
        yield* until(() => Effect.map(storage.aggregate.find(thread.id), (row) => row?.status === 'idle'));
        yield* until(() =>
          Effect.map(transcriptOf(storage, thread.id), (entries) =>
            entries.filter(entryOf('context-change')).every((change) => change.status !== 'pending'),
          ),
        );
        expect(contextEntries(yield* transcriptOf(storage, thread.id))).toMatchObject([
          { requestId: 'req-1', status: 'denied', detail: expect.any(String) },
        ]);
        expect((yield* contextRecords(storage, thread.id))[0]?.record).toBeUndefined();
        expect(yield* storage.runs({ ownerId: 'observer', scope: SCOPE }).latestRun(thread.id)).toMatchObject({
          id: parked.runId,
          status: 'aborted',
        });
      }),
    );
    test(
      'words steered while a change prepares are read once by the same run, and a queued turn stays queued',
      Effect.fnUntraced(function* () {
        const { storage, world, thread } = yield* openedRun(open);
        const handle = world.harness.threads.handle(thread.id, OWNER);
        const boundary = gate();
        let generation = -1;
        let drained: readonly string[] = [];
        let waiting: Effect.Success<ReturnType<typeof standingOf>> | undefined;
        let queued:
          | {
              runId: string;
              id: string;
            }
          | undefined;
        world.plan.push(
          crossingTurn({
            world,
            said: ['Working here.', 'Working there.'],
            reached: boundary.reach,
            released: boundary.released,
            onCrossed: (crossing) => {
              generation = crossing.generation;
            },
            onDrained: Effect.fnUntraced(function* (texts) {
              drained = texts;
              waiting = queued ? yield* standingOf(storage, queued.id) : undefined;
            }),
            usage: new Usage({ inputTokens: 100, outputTokens: 10, totalTokens: 110 }),
          }),
        );
        const running = yield* startedTurn(world, thread.id, 'Begin.');
        const draining = yield* Effect.forkScoped(pump(running));
        yield* boundary.reached;
        yield* handle.changeContext({ requestId: 'req-1', sourceKey: 'tree-b' });
        expect(yield* handle.steer({ expectedRunId: running.runId, text: 'And also this.' })).toMatchObject({
          status: 'steered',
          runId: running.runId,
        });
        queued = yield* queuedTurn(handle, 'Then the other thing.');
        expect(queued.runId).toBe(running.runId);
        world.plan.push(
          replyTurn({
            chunks: [
              { type: 'text-start', id: 'q1' },
              { type: 'text-delta', id: 'q1', text: 'The other thing.' },
              { type: 'text-end', id: 'q1' },
            ],
            steps: [scriptedStep({ text: 'The other thing.', messages: [Message.assistant('The other thing.')] })],
          }),
        );
        boundary.release();
        yield* Fiber.join(draining);
        yield* until(() => Effect.map(storage.aggregate.find(thread.id), (row) => row?.status === 'idle'));
        expect(generation).toBe(1);
        expect(drained).toEqual(['And also this.']);
        expect((yield* transcriptOf(storage, thread.id)).filter((entry) => entry.type === 'signal')).toMatchObject([
          { text: 'And also this.' },
        ]);
        expect(yield* inboxQueued(storage, thread.id, 'signal')).toHaveLength(0);
        expect(waiting).toMatchObject({ state: 'queued' });
        const runs = storage.runs({ ownerId: 'observer', scope: SCOPE });
        expect((yield* runs.latestRun(thread.id))?.id).not.toBe(running.runId);
        expect(yield* inboxQueued(storage, thread.id, 'turn')).toHaveLength(0);
        const changed = (yield* runs.runsOf(thread.id)).find((row) => row.id === running.runId);
        expect(changed?.usage).toMatchObject({ inputTokens: 200, outputTokens: 20, totalTokens: 220 });
      }),
    );
    test(
      'a destination that cannot be admitted is recorded denied, and the run works on where it was',
      Effect.fnUntraced(function* () {
        const { storage, world, thread } = yield* openedRun(open);
        const handle = world.harness.threads.handle(thread.id, OWNER);
        const boundary = gate();
        let generation = -1;
        world.plan.push(
          crossingTurn({
            world,
            said: ['Working here.', 'Still here.'],
            reached: boundary.reach,
            released: boundary.released,
            refusal: new Error('The tree that was named is gone.'),
            onCrossed: (crossing) => {
              generation = crossing.generation;
            },
          }),
        );
        const running = yield* startedTurn(world, thread.id, 'Begin.');
        const draining = yield* Effect.forkScoped(pump(running));
        yield* boundary.reached;
        yield* handle.changeContext({ requestId: 'req-1', sourceKey: 'tree-b' });
        boundary.release();
        yield* Fiber.join(draining);
        yield* until(() => Effect.map(storage.aggregate.find(thread.id), (row) => row?.status === 'idle'));
        expect(generation).toBe(0);
        expect(contextEntries(yield* transcriptOf(storage, thread.id))).toMatchObject([
          { requestId: 'req-1', status: 'denied', detail: 'The tree that was named is gone.' },
        ]);
        const records = yield* contextRecords(storage, thread.id);
        expect(records[0]?.record).toBeUndefined();
        expect(records[0]?.evidence).toBeUndefined();
        expect(yield* storage.runs({ ownerId: 'observer', scope: SCOPE }).latestRun(thread.id)).toMatchObject({
          id: running.runId,
          status: 'completed',
        });
        expect((yield* transcriptOf(storage, thread.id)).findLast((entry) => entry.type === 'message')).toMatchObject({
          text: 'Still here.',
        });
      }),
    );
    test(
      'a stop that lands while a change prepares publishes nothing, and the run`s ending settles the request',
      Effect.fnUntraced(function* () {
        const { storage, world, thread } = yield* openedRun(open);
        const handle = world.harness.threads.handle(thread.id, OWNER);
        const boundary = gate();
        let generation = -1;
        world.plan.push(
          crossingTurn({
            world,
            said: ['Working here.', ''],
            reached: boundary.reach,
            released: boundary.released,
            stays: true,
            onCrossed: (crossing) => {
              generation = crossing.generation;
            },
          }),
        );
        const running = yield* startedTurn(world, thread.id, 'Begin.');
        yield* boundary.reached;
        yield* handle.changeContext({ requestId: 'req-1', sourceKey: 'tree-b' });
        expect(yield* handle.stop()).toMatchObject({ status: 'stopped' });
        boundary.release();
        yield* until(() => Effect.map(storage.aggregate.find(thread.id), (row) => row?.status === 'idle'));
        yield* until(() =>
          Effect.map(transcriptOf(storage, thread.id), (entries) =>
            entries.filter(entryOf('context-change')).every((change) => change.status !== 'pending'),
          ),
        );
        expect(generation).toBe(0);
        expect(contextEntries(yield* transcriptOf(storage, thread.id))).toMatchObject([
          { requestId: 'req-1', status: 'denied', detail: expect.any(String) },
        ]);
        expect((yield* contextRecords(storage, thread.id))[0]?.record).toBeUndefined();
        expect(yield* storage.runs({ ownerId: 'observer', scope: SCOPE }).latestRun(thread.id)).toMatchObject({
          id: running.runId,
          status: 'aborted',
        });
      }),
    );
    test(
      'a request the lost process never published is reconciled by the successor, which keeps the old context',
      Effect.fnUntraced(function* () {
        const storage = yield* Effect.acquireRelease(open(), (storage) => storage.dispose());
        const thread = yield* storage.createThread({ ownerId: OWNER, scope: SCOPE });
        const processA = yield* scriptedWorld(storage, thread.agentId);
        processA.plan.push(heldTurn(Effect.never));
        yield* startedTurn(processA, thread.id, 'Begin.');
        yield* until(() =>
          Effect.map(transcriptOf(storage, thread.id), (entries) =>
            entries.some((entry) => coreEntry(entry) && entry.type === 'message' && entry.role === 'assistant'),
          ),
        );
        yield* processA.harness.threads.handle(thread.id, OWNER).changeContext({ requestId: 'req-1', sourceKey: 'tree-b' });
        const processB = yield* scriptedWorld(storage, thread.agentId);
        let generation = -1;
        processB.plan.push(
          crossingTurn({
            world: processB,
            said: ['Recovered.', 'Finished.'],
            reached: () => {},
            released: Effect.void,
            opening: { generation: 0 },
            between: null,
            onCrossed: (crossing) => {
              generation = crossing.generation;
            },
          }),
        );
        expect(yield* processB.harness.runs.recoverNow()).toBe(1);
        yield* until(() => Effect.map(storage.aggregate.find(thread.id), (row) => row?.status === 'idle'));
        expect(generation).toBe(0);
        expect(contextEntries(yield* transcriptOf(storage, thread.id))).toMatchObject([
          { requestId: 'req-1', status: 'denied', detail: expect.any(String) },
        ]);
        expect((yield* contextRecords(storage, thread.id))[0]?.record).toBeUndefined();
      }),
    );
    test(
      'a run the successor recovers after it published a change is prepared over the place it moved to',
      Effect.fnUntraced(function* () {
        const storage = yield* Effect.acquireRelease(open(), (storage) => storage.dispose());
        const thread = yield* storage.createThread({ ownerId: OWNER, scope: SCOPE });
        const processA = yield* scriptedWorld(storage, thread.agentId);
        const boundary = gate();
        processA.plan.push(
          crossingTurn({
            world: processA,
            said: ['Working here.', ''],
            reached: boundary.reach,
            released: boundary.released,
            stays: true,
            onCrossed: () => {},
          }),
        );
        yield* startedTurn(processA, thread.id, 'Begin.');
        yield* boundary.reached;
        yield* processA.harness.threads.handle(thread.id, OWNER).changeContext({ requestId: 'req-1', sourceKey: 'tree-b' });
        boundary.release();
        yield* until(() => Effect.map(contextRecords(storage, thread.id), (records) => records[0]?.record !== undefined));
        yield* until(() =>
          Effect.map(transcriptOf(storage, thread.id), (entries) =>
            entries.some((entry) => coreEntry(entry) && entry.type === 'message' && entry.role === 'assistant'),
          ),
        );
        const processB = yield* scriptedWorld(storage, thread.agentId);
        let preparedOver: ScriptedInput['admitted'];
        processB.plan.push((input) => {
          preparedOver = input.admitted;
          return replyTurn({
            chunks: [
              { type: 'text-start', id: 'r1' },
              { type: 'text-delta', id: 'r1', text: 'Recovered there.' },
              { type: 'text-end', id: 'r1' },
            ],
            steps: [scriptedStep({ text: 'Recovered there.', messages: [Message.assistant('Recovered there.')] })],
          })(input);
        });
        expect(yield* processB.harness.runs.recoverNow()).toBe(1);
        yield* until(() => Effect.map(storage.aggregate.find(thread.id), (row) => row?.status === 'idle'));
        expect(preparedOver).toMatchObject({ generation: 1, sourceKey: 'tree-b', requestId: 'req-1' });
      }),
    );
  });
}
