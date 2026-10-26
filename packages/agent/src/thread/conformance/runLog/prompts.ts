import { describe, expect } from 'bun:test';
import type { Tester } from '@runlith/effect-test';
import { Effect, Fiber, type Scope } from 'effect';
import { Message } from '@runlith/llm/schema/messages';
import type { ThreadStorageFactory } from '../storagePort';
import type { ThreadQuestionEntry } from '../../../transcript/entries';
import { OWNER, SCOPE, type ScriptedCrossing, scriptedWorld, openedRun, pump, startedTurn } from './world';
import { heldTurn, replyTurn, scriptedStep } from './scripts';
import { askingTurn, crossingTurn, GatedTransitions } from './toolScripts';
import { gate, transcriptOf, contextEntries, contextRecords, until, foldEntries } from './support';
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
export function describeThreadRunPrompts<TTx, TWrite extends TTx = TTx, R = never>(
  name: string,
  open: ThreadStorageFactory<TTx, TWrite, R>,
  test: Tester<Scope.Scope | R>,
): void {
  describe(`${name}: the run over the log — prompt identity`, () => {
    test(
      'a branch carries one prompt identity, and a fork onto another agent mints its own',
      Effect.fnUntraced(function* () {
        const { storage, world, thread } = yield* openedRun(open);
        world.plan.push(reply('t1', 'Frozen.'));
        yield* pump(yield* startedTurn(world, thread.id, 'Freeze the prompt.'));
        const branch = yield* world.harness.threads.duplicate({ ownerId: OWNER, sourceThreadId: thread.id });
        expect((yield* storage.aggregate.find(branch.id))?.contextReading).toBeNull();
        world.plan.push(reply('t2', 'Continued.'));
        yield* pump(yield* startedTurn(world, branch.id, 'Continue here.'));
        expect(world.ranWith).toHaveLength(2);
        expect(world.ranWith[0]).toBe(world.ranWith[1]);
        expect(world.resolved()).toBe(1);
        const branched = yield* storage.aggregate.find(branch.id);
        const branchedTranscript = (yield* storage.aggregate.transcriptOf(branch.id)) ?? [];
        expect(branched?.systemPrompt).toContain('Scripted prompt v1');
        expect(branchedTranscript.filter((entry) => entry.type === 'system-prompt')).toHaveLength(1);
        const branchEvents = yield* storage.eventLog.eventsAfter(branch.id, 0, 1_000);
        expect(foldEntries(branchEvents)).toEqual(branchedTranscript);
        const fork = yield* world.harness.threads.duplicate({
          ownerId: OWNER,
          sourceThreadId: thread.id,
          agentId: `${thread.agentId}-fork`,
        });
        expect(fork.systemPrompt).toBeNull();
        const forkTranscript = (yield* storage.aggregate.transcriptOf(fork.id)) ?? [];
        expect(forkTranscript.filter((entry) => entry.type === 'system-prompt')).toHaveLength(0);
        world.plan.push(reply('t3', 'Fresh.'));
        yield* pump(yield* startedTurn(world, fork.id, 'Fresh identity.'));
        const forked = yield* storage.aggregate.find(fork.id);
        const forkedTranscript = (yield* storage.aggregate.transcriptOf(fork.id)) ?? [];
        expect(forked?.systemPrompt).toContain('Scripted prompt v2');
        expect(forkedTranscript.filter((entry) => entry.type === 'system-prompt')).toEqual([
          expect.objectContaining({ text: forked?.systemPrompt }),
        ]);
      }),
    );
    test(
      'a branch keeps the overlay its source was born with; a fork into another type over the same base carries no prompt',
      Effect.fnUntraced(function* () {
        const { storage, world, thread } = yield* openedRun(open);
        const stories = {
          id: 'stories',
          overlay: { id: 'stories', baseAgentId: thread.agentId, description: 'Writes a story.', capabilities: [] },
        };
        const source = yield* storage.aggregate.insert({
          ownerId: OWNER,
          agentId: thread.agentId,
          profile: stories,
          systemPrompt: 'Frozen for stories.',
        });
        expect(source.profile).toEqual(stories);
        const branch = yield* world.harness.threads.duplicate({ ownerId: OWNER, sourceThreadId: source.id });
        expect(branch.agentId).toBe(thread.agentId);
        expect(branch.profile).toEqual(stories);
        expect(branch.systemPrompt).toBe('Frozen for stories.');
        const reviews = {
          id: 'reviews',
          overlay: { id: 'reviews', baseAgentId: thread.agentId, description: 'Reviews.', capabilities: ['files'] },
        };
        const retyped = yield* world.harness.threads.duplicate({
          ownerId: OWNER,
          sourceThreadId: source.id,
          agentId: thread.agentId,
          spawned: { parentThreadId: source.id, spawnedByRunId: null, profile: reviews },
        });
        expect(retyped.agentId).toBe(thread.agentId);
        expect(retyped.profile).toEqual(reviews);
        expect(retyped.systemPrompt).toBeNull();
      }),
    );
    test(
      'an instruction check replaces the frozen prompt only when the text moved, and the next run runs what it left',
      Effect.fnUntraced(function* () {
        let source = 'instructions-alpha';
        const { storage, world, thread } = yield* openedRun(open, { instructions: () => source });
        const handle = world.harness.threads.handle(thread.id, OWNER);
        world.plan.push(reply('t1', 'First.'));
        yield* pump(yield* startedTurn(world, thread.id, 'Open the thread.'));
        const frozen = (yield* storage.aggregate.find(thread.id))?.systemPrompt ?? null;
        expect(frozen).toContain('instructions-alpha');
        expect(yield* handle.checkInstructions()).toEqual({ status: 'current' });
        expect(yield* handle.checkInstructions()).toEqual({ status: 'current' });
        expect((yield* storage.aggregate.find(thread.id))?.systemPrompt).toBe(frozen);
        const held = gate();
        world.plan.push(heldTurn(held.released));
        const holding = yield* startedTurn(world, thread.id, 'Hold the thread open.');
        const draining = yield* Effect.forkScoped(pump(holding));
        yield* until(() =>
          Effect.map(transcriptOf(storage, thread.id), (shown) =>
            shown.some((entry) => coreEntry(entry) && entry.type === 'message' && entry.text === 'Held.'),
          ),
        );
        source = 'instructions-beta';
        expect(yield* handle.checkInstructions()).toEqual({ status: 'updated' });
        expect(world.ranWith[1]).toBe(frozen!);
        const holdingRow = yield* storage.aggregate.find(thread.id);
        expect(holdingRow?.systemPrompt).toBe(frozen!);
        expect(holdingRow?.pendingSystemPrompt).toContain('instructions-beta');
        held.release();
        yield* Fiber.join(draining);
        const transcript = yield* transcriptOf(storage, thread.id);
        expect(transcript.filter((entry) => entry.type === 'system-prompt')).toHaveLength(1);
        expect(transcript[0]).toMatchObject({ type: 'system-prompt', text: frozen! });
        world.plan.push(reply('t2', 'Third.'));
        yield* pump(yield* startedTurn(world, thread.id, 'Carry on.'));
        const refreshed = yield* storage.aggregate.find(thread.id);
        expect(refreshed?.systemPrompt).toContain('instructions-beta');
        expect(refreshed?.pendingSystemPrompt).toBeNull();
        expect(world.ranWith[2]).toBe(refreshed?.systemPrompt ?? '');
        expect(world.resolved()).toBe(1);
      }),
    );
    test(
      'a question answered after a check resumes its own run on the instructions it opened with',
      Effect.fnUntraced(function* () {
        let source = 'instructions-alpha';
        const { storage, world, thread } = yield* openedRun(open, { instructions: () => source });
        const handle = world.harness.threads.handle(thread.id, OWNER);
        world.plan.push(askingTurn());
        yield* pump(yield* startedTurn(world, thread.id, 'Ask me which branch.'));
        yield* until(() => Effect.map(storage.aggregate.find(thread.id), (row) => row?.pendingInteraction != null));
        const parked = yield* storage.aggregate.find(thread.id);
        const question = parked?.pendingInteraction as ThreadQuestionEntry;
        const frozen = parked?.systemPrompt ?? '';
        expect(frozen).toContain('instructions-alpha');
        source = 'instructions-beta';
        expect(yield* handle.checkInstructions()).toEqual({ status: 'updated' });
        world.plan.push(reply('a1', 'Taking main.'));
        const resumed = yield* handle.answer({
          questionId: question.questionId,
          answers: question.questions.map((prompt) => ({ questionId: prompt.id, values: ['main'] })),
        });
        yield* until(() => Effect.map(storage.aggregate.find(thread.id), (row) => row?.status === 'idle'));
        expect(resumed.runId).toBe(question.runId);
        expect(world.ranWith[1]).toBe(frozen);
        expect((yield* storage.aggregate.find(thread.id))?.systemPrompt).toBe(frozen);
        world.plan.push(reply('a2', 'Done.'));
        yield* pump(yield* startedTurn(world, thread.id, 'Carry on.'));
        expect(world.ranWith[2]).toContain('instructions-beta');
        expect((yield* storage.aggregate.find(thread.id))?.pendingSystemPrompt).toBeNull();
      }),
    );
    test(
      'a start that loses the thread`s slot promotes nothing, and the run in flight keeps its own and carries the losing words',
      Effect.fnUntraced(function* () {
        let source = 'instructions-alpha';
        const storage = yield* Effect.acquireRelease(open(), (storage) => storage.dispose());
        const thread = yield* storage.createThread({ ownerId: OWNER, scope: SCOPE });
        const gated = new GatedTransitions(storage.transitions);
        const world = yield* scriptedWorld({ ...storage, transitions: gated.faces }, thread.agentId, { instructions: () => source });
        const handle = world.harness.threads.handle(thread.id, OWNER);
        world.plan.push(reply('l1', 'First.'));
        yield* pump(yield* startedTurn(world, thread.id, 'Open the thread.'));
        const frozen = (yield* storage.aggregate.find(thread.id))?.systemPrompt ?? '';
        expect(frozen).toContain('instructions-alpha');
        const hold = gated.holdNextPrepare();
        const losing = yield* Effect.forkScoped(handle.send('These words set off first.'));
        yield* hold.taken;
        const held = gate();
        world.plan.push(heldTurn(held.released));
        const holding = yield* startedTurn(world, thread.id, 'Hold the thread open.');
        const draining = yield* Effect.forkScoped(pump(holding));
        yield* until(() =>
          Effect.map(transcriptOf(storage, thread.id), (shown) =>
            shown.some((entry) => coreEntry(entry) && entry.type === 'message' && entry.text === 'Held.'),
          ),
        );
        source = 'instructions-beta';
        expect(yield* handle.checkInstructions()).toEqual({ status: 'updated' });
        hold.release();
        expect(yield* Fiber.join(losing)).toMatchObject({ status: 'started', runId: holding.runId });
        const raced = yield* storage.aggregate.find(thread.id);
        expect(raced?.systemPrompt).toBe(frozen);
        expect(raced?.pendingSystemPrompt).toContain('instructions-beta');
        expect(world.ranWith[1]).toBe(frozen);
        expect(
          (yield* transcriptOf(storage, thread.id)).filter(
            (entry) => coreEntry(entry) && entry.type === 'message' && entry.role === 'user' && entry.runId === holding.runId,
          ),
        ).toMatchObject([{ text: 'These words set off first.\nHold the thread open.' }]);
        held.release();
        yield* Fiber.join(draining);
      }),
    );
    test(
      'a publication consumes neither the frozen prompt nor the refresh waiting for the next run',
      Effect.fnUntraced(function* () {
        let source = 'instructions-alpha';
        const { storage, world, thread } = yield* openedRun(open, { instructions: () => source });
        const handle = world.harness.threads.handle(thread.id, OWNER);
        world.plan.push(reply('c0', 'Opened.'));
        yield* pump(yield* startedTurn(world, thread.id, 'Open the thread.'));
        const frozen = (yield* storage.aggregate.find(thread.id))?.systemPrompt ?? '';
        expect(frozen).toContain('instructions-alpha');
        const boundary = gate();
        let generation = -1;
        world.plan.push(
          crossingTurn({
            world,
            said: ['Working here.', 'Working there.'],
            reached: boundary.reach,
            released: boundary.released,
            onCrossed: (crossing) => {
              generation = crossing.generation;
            },
          }),
        );
        const running = yield* startedTurn(world, thread.id, 'Carry on.');
        const draining = yield* Effect.forkScoped(pump(running));
        yield* boundary.reached;
        source = 'instructions-beta';
        expect(yield* handle.checkInstructions()).toEqual({ status: 'updated' });
        expect(yield* handle.changeContext({ requestId: 'req-1', sourceKey: 'tree-b' })).toEqual({
          status: 'accepted',
          requestId: 'req-1',
          fromGeneration: 0,
        });
        source = 'instructions-gamma';
        boundary.release();
        yield* Fiber.join(draining);
        yield* until(() => Effect.map(storage.aggregate.find(thread.id), (row) => row?.status === 'idle'));
        expect(generation).toBe(1);
        expect(contextEntries(yield* transcriptOf(storage, thread.id))).toMatchObject([
          {
            type: 'context-change',
            runId: running.runId,
            requestId: 'req-1',
            sourceKey: 'tree-b',
            status: 'published',
            fromGeneration: 0,
            generation: 1,
            stepNumber: 1,
          },
        ]);
        const records = yield* contextRecords(storage, thread.id);
        expect(records[0]?.evidence?.instructions).toContain('instructions-gamma');
        expect(records[0]?.evidence?.instructions).not.toContain('instructions-beta');
        const row = yield* storage.aggregate.find(thread.id);
        expect(row?.systemPrompt).toBe(frozen);
        expect((yield* transcriptOf(storage, thread.id)).filter((entry) => entry.type === 'system-prompt')).toMatchObject([
          { type: 'system-prompt', text: frozen },
        ]);
        expect(records[0]).toMatchObject({ fromGeneration: 0, stepNumber: 1, record: { generation: 1 } });
        expect(row?.pendingSystemPrompt).toContain('instructions-beta');
        world.plan.push(reply('c1', 'Once more.'));
        yield* pump(yield* startedTurn(world, thread.id, 'Once more.'));
        expect(world.ranWith[2]).toContain('instructions-beta');
        expect((yield* storage.aggregate.find(thread.id))?.pendingSystemPrompt).toBeNull();
      }),
    );
    test(
      'a run adopted after its process left restores the generation it published, on the bytes it published it with',
      Effect.fnUntraced(function* () {
        const storage = yield* Effect.acquireRelease(open(), (storage) => storage.dispose());
        const thread = yield* storage.createThread({ ownerId: OWNER, scope: SCOPE });
        let source = 'instructions-alpha';
        const processA = yield* scriptedWorld(storage, thread.agentId, { instructions: () => source });
        const boundary = gate();
        let generation = -1;
        processA.plan.push(
          crossingTurn({
            world: processA,
            said: ['Working here.', ''],
            reached: boundary.reach,
            released: boundary.released,
            stays: true,
            onCrossed: (crossing) => {
              generation = crossing.generation;
            },
          }),
        );
        yield* startedTurn(processA, thread.id, 'Begin.');
        yield* boundary.reached;
        yield* processA.harness.threads.handle(thread.id, OWNER).changeContext({ requestId: 'req-1', sourceKey: 'tree-b' });
        boundary.release();
        yield* until(() => Effect.sync(() => generation === 1));
        const frozen = (yield* storage.aggregate.find(thread.id))?.systemPrompt ?? '';
        yield* processA.dispose();
        source = 'instructions-beta';
        const processB = yield* scriptedWorld(storage, thread.agentId, { instructions: () => source });
        expect(yield* processB.harness.threads.handle(thread.id, OWNER).checkInstructions()).toEqual({ status: 'updated' });
        const crossed: ScriptedCrossing[] = [];
        const second = gate();
        processB.plan.push(
          crossingTurn({
            world: processB,
            said: ['Recovered.', 'And on again.'],
            reached: second.reach,
            released: second.released,
            opening: { generation: 0 },
            between: { generation: 1 },
            onCrossed: (crossing) => void crossed.push(crossing),
          }),
        );
        expect(yield* processB.harness.runs.recoverNow()).toBe(1);
        yield* second.reached;
        expect(crossed.map((crossing) => crossing.generation)).toEqual([1]);
        const recorded = (yield* contextRecords(storage, thread.id))[0];
        expect(yield* contextRecords(storage, thread.id)).toHaveLength(1);
        expect(crossed[0]?.admitted?.instructions).toBe(recorded?.evidence?.instructions ?? '');
        expect(crossed[0]?.admitted?.instructions).toContain('instructions-alpha');
        expect(crossed[0]?.admitted?.instructions).not.toContain('instructions-beta');
        expect(processB.ranWith[0]).toBe(frozen);
        expect(yield* storage.aggregate.find(thread.id)).toMatchObject({
          systemPrompt: frozen,
          pendingSystemPrompt: expect.stringContaining('instructions-beta'),
        });
        yield* processB.harness.threads.handle(thread.id, OWNER).changeContext({ requestId: 'req-2', sourceKey: 'tree-c' });
        second.release();
        yield* until(() => Effect.map(storage.aggregate.find(thread.id), (row) => row?.status === 'idle'));
        expect(crossed.map((crossing) => crossing.generation)).toEqual([1, 2]);
        expect(crossed[1]?.admitted?.instructions).toContain('instructions-beta');
        expect(contextEntries(yield* transcriptOf(storage, thread.id))).toMatchObject([
          { requestId: 'req-1', status: 'published', fromGeneration: 0, generation: 1 },
          { requestId: 'req-2', status: 'published', fromGeneration: 1, generation: 2 },
        ]);
        const both = yield* contextRecords(storage, thread.id);
        expect(both[0]?.evidence?.instructions).toContain('instructions-alpha');
        expect(both[1]?.evidence?.instructions).toContain('instructions-beta');
      }),
    );
  });
}
