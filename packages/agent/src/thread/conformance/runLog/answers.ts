import { describe, expect } from 'bun:test';
import type { Tester } from '@runlith/effect-test';
import { Clock, Deferred, Effect, Fiber, type Scope } from 'effect';
import { Message } from '@runlith/llm/schema/messages';
import { EFFECT_STOPPED_BEFORE_SETTLING } from '../../run/ThreadEffectSettlement';
import type { ThreadStorageFactory } from '../storagePort';
import type { ThreadQuestionEntry } from '../../../transcript/entries';
import { OWNER, SCOPE, RHYTHM, scriptedWorld, openedRun, pump, startedTurn } from './world';
import { heldTurn, replyTurn, scriptedStep } from './scripts';
import { dyingToolTurn, askingTurn, selectingCatalog, confirmingTurn, toolResultIds } from './toolScripts';
import { until } from './support';
const reply = (id: string, text: string) =>
  replyTurn({
    chunks: [
      { type: 'text-start', id },
      { type: 'text-delta', id, text },
      { type: 'text-end', id },
    ],
    steps: [scriptedStep({ text, messages: [Message.assistant(text)] })],
  });
export function describeThreadRunAnswers<TTx, TWrite extends TTx = TTx, R = never>(
  name: string,
  open: ThreadStorageFactory<TTx, TWrite, R>,
  test: Tester<Scope.Scope | R>,
): void {
  describe(`${name}: the run over the log — questions and confirmed calls`, () => {
    test(
      'a refusal the run owns reaches an in-dialect caller by tag, and the run then finishes',
      Effect.fnUntraced(function* () {
        const { storage, world, thread } = yield* openedRun(open);
        const release = yield* Deferred.make<void>();
        world.plan.push(heldTurn(Deferred.await(release)));
        const stream = yield* startedTurn(world, thread.id, 'Hold the thread open.');
        const drain = yield* Effect.forkScoped(pump(stream));
        yield* until(() => Effect.map(storage.aggregate.find(thread.id), (row) => row?.status === 'running'));
        const refusal = yield* Effect.flip(
          world.harness.threads.duplicate({
            ownerId: OWNER,
            sourceThreadId: thread.id,
            spawned: { parentThreadId: thread.id, spawnedByRunId: null },
          }),
        );
        expect(refusal).toMatchObject({ _tag: 'ThreadRunConflict', threadId: thread.id, runId: stream.runId });
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(drain);
        expect((yield* storage.aggregate.find(thread.id))?.status).toBe('idle');
      }),
    );
    test(
      'a run stopped mid-effect answers the call it had already committed',
      Effect.fnUntraced(function* () {
        const { storage, world, thread } = yield* openedRun(open);
        world.plan.push(dyingToolTurn());
        const stream = yield* startedTurn(world, thread.id, 'Write the file.');
        const drain = yield* Effect.forkScoped(pump(stream));
        yield* until(() =>
          Effect.map(storage.aggregate.transcriptOf(thread.id), (entries) => (entries ?? []).some((entry) => entry.type === 'tool')),
        );
        expect(yield* world.harness.threads.handle(thread.id, OWNER).stop()).toMatchObject({ status: 'stopped' });
        yield* Fiber.join(drain);
        const row = yield* storage.aggregate.find(thread.id);
        const rowTranscript = (yield* storage.aggregate.transcriptOf(thread.id)) ?? [];
        const calls = row?.history.flatMap((message) => message.content.flatMap((part) => (part.type === 'tool-call' ? [part.id] : [])));
        const results = row?.history.flatMap((message) =>
          message.content.flatMap((part) => (part.type === 'tool-result' ? [part.id] : [])),
        );
        expect(calls).toEqual(['call-1']);
        expect(results).toEqual(['call-1']);
        expect(rowTranscript.filter((entry) => entry.type === 'tool')).toEqual([
          expect.objectContaining({ toolCallId: 'call-1', toolState: 'output-unknown' }),
        ]);
      }),
    );
    test(
      'stopping a run parked on a question answers its call once, as cancelled',
      Effect.fnUntraced(function* () {
        const { storage, world, thread } = yield* openedRun(open);
        world.plan.push(askingTurn());
        yield* pump(yield* startedTurn(world, thread.id, 'Ask me which branch.'));
        yield* until(() => Effect.map(storage.aggregate.find(thread.id), (row) => row?.pendingInteraction != null));
        expect(yield* world.harness.threads.handle(thread.id, OWNER).stop()).toMatchObject({ status: 'stopped' });
        yield* until(() => Effect.map(storage.aggregate.find(thread.id), (row) => row?.pendingInteraction === null));
        const row = yield* storage.aggregate.find(thread.id);
        const rowTranscript = (yield* storage.aggregate.transcriptOf(thread.id)) ?? [];
        const results = row?.history.flatMap((message) =>
          message.content.flatMap((part) => (part.type === 'tool-result' ? [part.id] : [])),
        );
        expect(results).toEqual(['call-1']);
        expect(rowTranscript.filter((entry) => entry.type === 'tool')).toEqual([
          expect.objectContaining({ toolCallId: 'call-1', toolState: 'output-cancelled' }),
        ]);
        world.plan.push(reply('n1', 'Taking main.'));
        yield* pump(yield* startedTurn(world, thread.id, 'Take main.'));
        expect(toolResultIds(world.replayed.at(-1) ?? [])).toEqual(['call-1']);
      }),
    );
    test(
      'a confirmed call runs the targets its question named',
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
        expect(parked.questions[0]?.options?.map((option) => option.value)).toEqual(['confirm', 'cancel']);
        selector.names = ['thread-a', 'thread-b'];
        world.plan.push(reply('c1', 'Read it.'));
        yield* handle.answer({ questionId: parked.questionId, answers: [{ questionId: 'call-1', values: ['confirm'] }] });
        yield* until(() => Effect.map(storage.aggregate.find(thread.id), (row) => row?.status === 'idle'));
        expect(selector.read).toEqual(['thread-a']);
        const rowTranscript = (yield* storage.aggregate.transcriptOf(thread.id)) ?? [];
        expect(rowTranscript.filter((entry) => entry.type === 'tool')).toMatchObject([
          { toolCallId: 'call-1', toolState: 'output-available', toolOutput: { read: ['thread-a'] } },
        ]);
      }),
    );
    test(
      'an accepted answer survives its waiter and rejects duplicate execution',
      Effect.fnUntraced(function* () {
        const entered = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const effects: string[] = [];
        const selector = {
          names: ['thread-a'],
          read: [] as readonly string[],
          running: () =>
            Effect.andThen(
              Effect.sync(() => effects.push('thread-a')),
              Effect.andThen(Deferred.succeed(entered, undefined), Deferred.await(release)),
            ),
        };
        const catalog = selectingCatalog(selector);
        const { storage, world, thread } = yield* openedRun(open, { catalog });
        const handle = world.harness.threads.handle(thread.id, OWNER);
        yield* handle.setAuthorityMode('review');
        world.plan.push(confirmingTurn(catalog));
        yield* pump(yield* startedTurn(world, thread.id, 'Read the lineage.'));
        const parked = (yield* storage.aggregate.find(thread.id))?.pendingInteraction as ThreadQuestionEntry;
        const answer = { questionId: parked.questionId, answers: [{ questionId: 'call-1', values: ['confirm'] }] };
        world.plan.push(reply('continued', 'Read.'));
        const waiter = yield* Effect.forkScoped(handle.answer(answer));
        yield* Deferred.await(entered);
        yield* Fiber.interrupt(waiter);
        try {
          expect((yield* storage.aggregate.find(thread.id))?.pendingInteraction).toMatchObject({ status: 'open' });
          expect(yield* Effect.flip(handle.answer(answer))).toMatchObject({
            _tag: 'ThreadRunConflict',
            threadId: thread.id,
            runId: parked.runId,
          });
        } finally {
          yield* Deferred.succeed(release, undefined);
        }
        yield* until(() => Effect.map(storage.aggregate.find(thread.id), (row) => row?.status === 'idle'));
        const row = yield* storage.aggregate.find(thread.id);
        expect(effects).toEqual(['thread-a']);
        expect(toolResultIds(row?.history ?? [])).toEqual(['call-1']);
        expect((yield* storage.aggregate.transcriptOf(thread.id))?.filter((entry) => entry.type === 'tool')).toMatchObject([
          { toolCallId: 'call-1', toolState: 'output-available', toolOutput: { read: ['thread-a'] } },
        ]);
        expect(yield* storage.runs({ ownerId: 'observer', scope: SCOPE }).latestRun(thread.id)).toMatchObject({ status: 'completed' });
      }),
    );
    test(
      'a thread switched to bypass while its run waits is answered by the operator word, and the act it held runs',
      Effect.fnUntraced(function* () {
        const ran: string[] = [];
        const selector = {
          names: ['thread-a'] as readonly string[],
          read: [] as readonly string[],
          running: () => Effect.asVoid(Effect.sync(() => ran.push('thread-a'))),
        };
        const catalog = selectingCatalog(selector);
        const { storage, world, thread } = yield* openedRun(open, { catalog });
        const handle = world.harness.threads.handle(thread.id, OWNER);
        yield* handle.setAuthorityMode('review');
        world.plan.push(confirmingTurn(catalog));
        yield* pump(yield* startedTurn(world, thread.id, 'Read the lineage.'));
        world.plan.push(reply('continued', 'Read.'));
        yield* handle.setAuthorityMode('bypass');
        yield* until(() => Effect.map(storage.aggregate.find(thread.id), (row) => row?.status === 'idle'));
        const after = yield* storage.aggregate.find(thread.id);
        expect(after?.pendingInteraction).toBeNull();
        expect(ran).toEqual(['thread-a']);
        expect(after?.authority.mode).toBe('bypass');
        expect(toolResultIds(after?.history ?? [])).toEqual(['call-1']);
      }),
    );
    test.each([false, true])(
      'a live slow answer cannot be adopted (withdraw waiter: %s)',
      Effect.fnUntraced(function* (withdraw) {
        const entered = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const selector = { names: ['thread-a'], read: [] as readonly string[], wording: null as (() => Effect.Effect<void>) | null };
        const catalog = selectingCatalog(selector);
        const { storage, world, thread } = yield* openedRun(open, { catalog, rhythm: { heartbeatIntervalMs: 10 } });
        const handle = world.harness.threads.handle(thread.id, OWNER);
        yield* handle.setAuthorityMode('review');
        world.plan.push(confirmingTurn(catalog));
        yield* pump(yield* startedTurn(world, thread.id, 'Read the lineage.'));
        const parked = (yield* storage.aggregate.find(thread.id))?.pendingInteraction as ThreadQuestionEntry;
        selector.wording = () => Effect.andThen(Deferred.succeed(entered, undefined), Deferred.await(release));
        const waiter = yield* Effect.forkScoped(
          handle.answer({ questionId: parked.questionId, answers: [{ questionId: 'call-1', values: ['confirm'] }] }),
        );
        yield* Deferred.await(entered);
        if (withdraw) yield* Fiber.interrupt(waiter);
        try {
          const peer = storage.runs({ ownerId: 'peer', scope: SCOPE });
          const silentBefore = new Date(yield* Clock.currentTimeMillis);
          yield* until(() => Effect.map(peer.latestRun(thread.id), (row) => (row?.heartbeatAt.getTime() ?? 0) > silentBefore.getTime()));
          const adopted = yield* peer.adoptRun(parked.runId, {
            selector: { kind: 'foreign-owner', heartbeatBefore: silentBefore },
            maxResumes: RHYTHM.resumeAttemptLimit,
            progress: { stage: 'resuming', message: 'Taking abandoned work.' },
            heartbeatAt: new Date(yield* Clock.currentTimeMillis),
          });
          expect(adopted).toBeNull();
          expect(yield* peer.latestRun(thread.id)).toMatchObject({ id: parked.runId, status: 'running' });
        } finally {
          yield* handle.stop();
          yield* Deferred.succeed(release, undefined);
        }
        yield* Fiber.await(waiter);
        yield* until(() => Effect.map(storage.aggregate.find(thread.id), (row) => row?.pendingInteraction === null));
        expect(selector.read).toEqual([]);
      }),
    );
    test(
      'host departure hands over an accepted answer without inventing a failed or cancelled run',
      Effect.fnUntraced(function* () {
        const entered = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const selector = {
          names: ['thread-a'],
          read: [] as readonly string[],
          running: () => Effect.andThen(Deferred.succeed(entered, undefined), Deferred.await(release)),
        };
        const catalog = selectingCatalog(selector);
        const { storage, world, thread } = yield* openedRun(open, { catalog });
        const handle = world.harness.threads.handle(thread.id, OWNER);
        yield* handle.setAuthorityMode('review');
        world.plan.push(confirmingTurn(catalog));
        yield* pump(yield* startedTurn(world, thread.id, 'Read the lineage.'));
        const parked = (yield* storage.aggregate.find(thread.id))?.pendingInteraction as ThreadQuestionEntry;
        const waiter = yield* Effect.forkScoped(
          handle.answer({ questionId: parked.questionId, answers: [{ questionId: 'call-1', values: ['confirm'] }] }),
        );
        yield* Deferred.await(entered);
        try {
          yield* world.dispose();
        } finally {
          yield* Deferred.succeed(release, undefined);
        }
        yield* Fiber.await(waiter);
        const row = yield* storage.runs({ ownerId: 'observer', scope: SCOPE }).latestRun(thread.id);
        expect(row).toMatchObject({ id: parked.runId, status: 'running', handedOverAt: expect.any(Date), failure: null });
        expect(selector.read).toEqual(['thread-a']);
        expect((yield* storage.aggregate.transcriptOf(thread.id))?.filter((entry) => entry.type === 'tool')).toMatchObject([
          { toolCallId: 'call-1', toolState: 'output-unknown', toolOutput: EFFECT_STOPPED_BEFORE_SETTLING },
        ]);
      }),
    );
    test(
      'a run stopped while its answer is still preparing never runs the confirmed call',
      Effect.fnUntraced(function* () {
        const selector = {
          names: ['thread-a'] as readonly string[],
          read: [] as readonly string[],
          wording: null as (() => Effect.Effect<void>) | null,
        };
        const catalog = selectingCatalog(selector);
        const { storage, world, thread } = yield* openedRun(open, { catalog });
        const handle = world.harness.threads.handle(thread.id, OWNER);
        yield* handle.setAuthorityMode('review');
        world.plan.push(confirmingTurn(catalog));
        yield* pump(yield* startedTurn(world, thread.id, 'Read the lineage.'));
        yield* until(() => Effect.map(storage.aggregate.find(thread.id), (row) => row?.pendingInteraction != null));
        const parked = (yield* storage.aggregate.find(thread.id))?.pendingInteraction as ThreadQuestionEntry;
        const held = yield* Deferred.make<void>();
        const reached = yield* Deferred.make<void>();
        selector.wording = () => Effect.andThen(Deferred.succeed(reached, undefined), Deferred.await(held));
        const answering = yield* Effect.forkScoped(
          handle.answer({ questionId: parked.questionId, answers: [{ questionId: 'call-1', values: ['confirm'] }] }),
        );
        yield* Deferred.await(reached);
        expect(yield* handle.stop()).toMatchObject({ status: 'stopped' });
        yield* Deferred.succeed(held, undefined);
        yield* Fiber.await(answering);
        yield* until(() => Effect.map(storage.aggregate.find(thread.id), (row) => row?.pendingInteraction === null));
        expect(selector.read).toEqual([]);
        const rowTranscript = (yield* storage.aggregate.transcriptOf(thread.id)) ?? [];
        expect(rowTranscript.filter((entry) => entry.type === 'tool')).toMatchObject([
          { toolCallId: 'call-1', toolState: 'output-cancelled' },
        ]);
        const row = yield* storage.aggregate.find(thread.id);
        expect(toolResultIds(row?.history ?? [])).toEqual(['call-1']);
      }),
    );
    test(
      'a run stopped inside a confirmed body retains uncertainty instead of denying its effect',
      Effect.fnUntraced(function* () {
        const selector = {
          names: ['thread-a'] as readonly string[],
          read: [] as readonly string[],
          running: null as (() => Effect.Effect<void>) | null,
        };
        const catalog = selectingCatalog(selector);
        const { storage, world, thread } = yield* openedRun(open, { catalog });
        const handle = world.harness.threads.handle(thread.id, OWNER);
        yield* handle.setAuthorityMode('review');
        world.plan.push(confirmingTurn(catalog));
        yield* pump(yield* startedTurn(world, thread.id, 'Read the lineage.'));
        yield* until(() => Effect.map(storage.aggregate.find(thread.id), (row) => row?.pendingInteraction != null));
        const parked = (yield* storage.aggregate.find(thread.id))?.pendingInteraction as ThreadQuestionEntry;
        const held = yield* Deferred.make<void>();
        const reached = yield* Deferred.make<void>();
        selector.running = () => Effect.andThen(Deferred.succeed(reached, undefined), Deferred.await(held));
        const answering = yield* Effect.forkScoped(
          handle.answer({ questionId: parked.questionId, answers: [{ questionId: 'call-1', values: ['confirm'] }] }),
        );
        yield* Deferred.await(reached);
        expect(yield* handle.stop()).toMatchObject({ status: 'stopped' });
        yield* Deferred.succeed(held, undefined);
        yield* Fiber.await(answering);
        yield* until(() => Effect.map(storage.aggregate.find(thread.id), (row) => row?.pendingInteraction === null));
        expect(selector.read).toEqual(['thread-a']);
        const rowTranscript = (yield* storage.aggregate.transcriptOf(thread.id)) ?? [];
        expect(rowTranscript.filter((entry) => entry.type === 'tool')).toMatchObject([
          { toolCallId: 'call-1', toolState: 'output-unknown', toolOutput: EFFECT_STOPPED_BEFORE_SETTLING },
        ]);
        const row = yield* storage.aggregate.find(thread.id);
        expect(toolResultIds(row?.history ?? [])).toEqual(['call-1']);
        expect(yield* storage.runs({ ownerId: 'observer', scope: SCOPE }).latestRun(thread.id)).toMatchObject({
          id: parked.runId,
          status: 'aborted',
        });
        expect(row?.status).toBe('idle');
      }),
    );
    test(
      'a question answered on a peer refuses the confirmed call, and the instance that parked it stops holding the run',
      Effect.fnUntraced(function* () {
        const storage = yield* Effect.acquireRelease(open(), (storage) => storage.dispose());
        const thread = yield* storage.createThread({ ownerId: OWNER, scope: SCOPE });
        const other = yield* storage.createThread({ ownerId: OWNER, scope: SCOPE });
        const selector = { names: ['thread-a'] as readonly string[], read: [] as readonly string[] };
        const catalog = selectingCatalog(selector);
        const processA = yield* scriptedWorld(storage, thread.agentId, { catalog });
        const processB = yield* scriptedWorld(storage, thread.agentId, { catalog });
        yield* processA.harness.threads.handle(thread.id, OWNER).setAuthorityMode('review');
        yield* processA.harness.threads.handle(other.id, OWNER).setAuthorityMode('review');
        processA.plan.push(confirmingTurn(catalog));
        yield* pump(yield* startedTurn(processA, thread.id, 'Read the lineage.'));
        yield* until(() => Effect.map(storage.aggregate.find(thread.id), (row) => row?.pendingInteraction != null));
        const parked = (yield* storage.aggregate.find(thread.id))?.pendingInteraction as ThreadQuestionEntry;
        const parkedRun = parked.runId;
        expect(processA.harness.runs.parked()).toEqual([parkedRun]);
        selector.names = ['thread-a', 'thread-b'];
        processB.plan.push(reply('c2', 'Asking again.'));
        yield* processB.harness.threads
          .handle(thread.id, OWNER)
          .answer({ questionId: parked.questionId, answers: [{ questionId: 'call-1', values: ['confirm'] }] });
        yield* until(() => Effect.map(storage.aggregate.find(thread.id), (row) => row?.status === 'idle'));
        expect(selector.read).toEqual([]);
        const rowTranscript = (yield* storage.aggregate.transcriptOf(thread.id)) ?? [];
        expect(rowTranscript.filter((entry) => entry.type === 'tool')).toMatchObject([{ toolCallId: 'call-1', toolState: 'output-error' }]);
        processA.plan.push(confirmingTurn(catalog));
        yield* pump(yield* startedTurn(processA, other.id, 'Read it here too.'));
        yield* until(() => Effect.map(storage.aggregate.find(other.id), (row) => row?.pendingInteraction != null));
        const held = (yield* storage.aggregate.find(other.id))?.pendingInteraction as ThreadQuestionEntry;
        yield* until(() => Effect.sync(() => !processA.harness.runs.parked().includes(parkedRun)));
        expect(processA.harness.runs.parked()).toEqual([held.runId]);
      }),
    );
  });
}
