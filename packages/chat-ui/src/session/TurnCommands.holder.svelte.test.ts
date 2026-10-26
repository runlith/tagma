import { Deferred, Effect, Fiber } from 'effect';
import { it } from '@runlith/effect-test/vitest';
import { describe, expect, test } from 'vitest';
import { THREAD_TOOL_CONFIRM_KIND } from '@runlith/agent/transcript/parts';
import { ChatReadRefused } from '../wire/ChatConnection';
import { bornAs, draft, settle, snapshotEvent, makeChat, TestDraftState } from '../testing/chatHarness.svelte';
import { ThreadOpening } from './ThreadOpening.svelte';
describe('what the holder says about its turns', () => {
  it.effect('a send uploads beside the one pressed before it, and still reaches the thread after it', () =>
    Effect.gen(function* () {
      const chat = yield* makeChat();
      const { session } = yield* chat.open();
      chat.connection.emit(snapshotEvent({ activeRunId: 'run-1' }));
      yield* settle;
      const drafts = new TestDraftState();
      const uploads: string[] = [];
      const firstUpload = yield* Deferred.make<void>();
      drafts.compose = (_threadId, next) =>
        Effect.andThen(
          Effect.sync(() => void uploads.push(next.text)),
          Effect.andThen(
            next.text === 'первое' ? Deferred.await(firstUpload) : Effect.void,
            Effect.succeed({ status: 'composed' as const }),
          ),
        );
      const commands = yield* chat.holder(session, { draft: drafts });
      drafts.set(draft('первое'));
      const first = yield* Effect.forkChild(commands.send(), { startImmediately: true });
      drafts.set(draft('второе'));
      const second = yield* Effect.forkChild(commands.send(), { startImmediately: true });
      expect(session.pendingSteers.map((item) => item.text)).toEqual(['первое', 'второе']);
      yield* settle;
      expect(uploads).toEqual(['первое', 'второе']);
      expect(chat.connection.called('send')).toEqual([]);
      yield* Deferred.succeed(firstUpload, undefined);
      expect(yield* Fiber.joinAll([first, second])).toEqual([true, true]);
      expect(chat.connection.called('send').map((call) => (call.input as { text: string }).text)).toEqual(['первое', 'второе']);
    }),
  );
  it.effect('a send that fails between two others keeps the one after it behind the one before it', () =>
    Effect.gen(function* () {
      const chat = yield* makeChat();
      const { session } = yield* chat.open();
      chat.connection.emit(snapshotEvent({ activeRunId: 'run-1' }));
      yield* settle;
      const drafts = new TestDraftState();
      const firstUpload = yield* Deferred.make<void>();
      drafts.compose = (_threadId, next) => {
        if (next.text === 'первое') return Effect.as(Deferred.await(firstUpload), { status: 'composed' as const });
        if (next.text === 'второе')
          return Effect.succeed({ status: 'failed' as const, notice: { tone: 'error' as const, message: 'upload' } });
        return Effect.succeed({ status: 'composed' as const });
      };
      const commands = yield* chat.holder(session, { draft: drafts });
      const pressed = [];
      for (const text of ['первое', 'второе', 'третье']) {
        drafts.set(draft(text));
        pressed.push(yield* Effect.forkChild(commands.send(), { startImmediately: true }));
      }
      yield* settle;
      expect(chat.connection.called('send')).toEqual([]);
      yield* Deferred.succeed(firstUpload, undefined);
      expect(yield* Fiber.joinAll(pressed)).toEqual([true, false, true]);
      expect(chat.connection.called('send').map((call) => (call.input as { text: string }).text)).toEqual(['первое', 'третье']);
    }),
  );
  it.effect('a first send that fails to upload keeps the thread it bore for the send that follows into it', () =>
    Effect.gen(function* () {
      const chat = yield* makeChat();
      const drafts = new TestDraftState();
      const discarded: string[] = [];
      const firstUpload = yield* Deferred.make<void>();
      drafts.compose = (_threadId, next) =>
        next.text === 'первое'
          ? Effect.as(Deferred.await(firstUpload), { status: 'failed' as const, notice: { tone: 'error' as const, message: 'upload' } })
          : Effect.succeed({ status: 'composed' as const });
      const birth = { ...bornAs('thread-1'), discard: (threadId: string) => Effect.sync(() => void discarded.push(threadId)) };
      const commands = yield* chat.holder(new ThreadOpening(), { draft: drafts, birth });
      drafts.set(draft('первое'));
      const first = yield* Effect.forkChild(commands.send(), { startImmediately: true });
      drafts.set(draft('второе'));
      const second = yield* Effect.forkChild(commands.send(), { startImmediately: true });
      yield* settle;
      yield* Deferred.succeed(firstUpload, undefined);
      expect(yield* Fiber.joinAll([first, second])).toEqual([false, true]);
      expect(discarded).toEqual([]);
      expect(chat.connection.called('send').map((call) => call.threadId)).toEqual(['thread-1']);
    }),
  );
  it.effect('a draft choice still being written holds the birth of the first turn until it answers', () =>
    Effect.gen(function* () {
      const chat = yield* makeChat();
      const drafts = new TestDraftState();
      let births = 0;
      const birth = {
        ...bornAs('thread-1'),
        born: () =>
          Effect.andThen(
            Effect.sync(() => void (births += 1)),
            bornAs('thread-1').born(),
          ),
      };
      const commands = yield* chat.holder(new ThreadOpening(), { draft: drafts, birth });
      const written = chat.shaping.hold(drafts.key);
      drafts.set(draft('первое'));
      const sent = yield* Effect.forkChild(commands.send(), { startImmediately: true });
      yield* settle;
      expect(births).toBe(0);
      written();
      expect(yield* Fiber.join(sent)).toBe(true);
      expect(births).toBe(1);
    }),
  );
  it.effect('a second send pressed before the first is delivered reaches the thread the first bore, after it', () =>
    Effect.gen(function* () {
      const chat = yield* makeChat();
      const drafts = new TestDraftState();
      let births = 0;
      const birth = {
        ...bornAs('thread-1'),
        born: () =>
          Effect.andThen(
            Effect.sync(() => void (births += 1)),
            bornAs('thread-1').born(),
          ),
      };
      const commands = yield* chat.holder(new ThreadOpening(), { draft: drafts, birth });
      const reached = chat.connection.hold('send');
      drafts.set(draft('первое'));
      const first = yield* Effect.forkChild(commands.send(), { startImmediately: true });
      yield* Effect.promise(() => reached);
      drafts.set(draft('второе'));
      expect(commands.canSend).toBe(true);
      const second = yield* Effect.forkChild(commands.send(), { startImmediately: true });
      yield* settle;
      expect(chat.connection.called('send')).toHaveLength(1);
      chat.connection.release('send');
      expect(yield* Fiber.joinAll([first, second])).toEqual([true, true]);
      expect(births).toBe(1);
      expect(
        chat.connection.called('send').map((call) => [
          call.threadId,
          (
            call.input as {
              text: string;
            }
          ).text,
        ]),
      ).toEqual([
        ['thread-1', 'первое'],
        ['thread-1', 'второе'],
      ]);
    }),
  );
  it.effect('a confirmation waiting on its answer leaves the composer free to send', () =>
    Effect.gen(function* () {
      const chat = yield* makeChat();
      const { session } = yield* chat.open();
      chat.connection.emit(
        snapshotEvent({
          activeRunId: 'run-1',
          life: 'awaiting',
          transcript: [
            {
              type: 'question',
              id: 'entry-1',
              runId: 'run-1',
              questionId: 'question-1',
              questions: [{ id: 'prompt-1', toolCallId: 'prompt-1', kind: THREAD_TOOL_CONFIRM_KIND, prompt: 'Commit?' }],
              toolCalls: [{ toolCallId: 'prompt-1', toolName: 'submit_work' }],
              status: 'open',
            },
          ],
        }),
      );
      yield* settle;
      const drafts = new TestDraftState();
      drafts.set(draft('подожди'));
      const commands = yield* chat.holder(session, { draft: drafts });
      expect(session.fold.openQuestion).toBe(true);
      expect(commands.canSend).toBe(true);
      expect(yield* commands.send()).toBe(true);
      expect(chat.connection.called('send')).toHaveLength(1);
    }),
  );
  it.effect('the holder is told once when a send bore a thread, and never when the thread already existed', () =>
    Effect.gen(function* () {
      const chat = yield* makeChat();
      let told = 0;
      const birth = { ...bornAs('thread-1'), settled: () => Effect.sync(() => void (told += 1)) };
      const drafts = new TestDraftState();
      drafts.set(draft('начни'));
      const unborn = yield* chat.holder(new ThreadOpening(), { draft: drafts, birth });
      expect(yield* unborn.send()).toBe(true);
      expect(told).toBe(1);
      const { session } = yield* chat.open();
      chat.connection.emit(snapshotEvent());
      yield* settle;
      drafts.set(draft('ещё'));
      const existing = yield* chat.holder(session, { draft: drafts, birth });
      expect(yield* existing.send()).toBe(true);
      expect(told).toBe(1);
    }),
  );
  it.effect('an older page the channel refused is shown as the notice, and the ask answers that nothing came', () =>
    Effect.gen(function* () {
      const chat = yield* makeChat();
      chat.connection.stub('entriesBefore', () => Effect.fail(new ChatReadRefused({ message: 'the channel refused' })));
      const { session } = yield* chat.open();
      chat.connection.emit(snapshotEvent({ position: 9, before: 6 }));
      yield* settle;
      const commands = yield* chat.holder(session);
      expect(yield* commands.loadOlder()).toBe(false);
      expect(commands.notice).toEqual({ tone: 'error', message: 'the channel refused' });
    }),
  );
  it.effect('a refusal of an older page lands on no thread but the one that asked', () =>
    Effect.gen(function* () {
      const chat = yield* makeChat();
      chat.connection.stub('entriesBefore', () => Effect.fail(new ChatReadRefused({ message: 'the channel refused' })));
      const { session } = yield* chat.open();
      chat.connection.emit(snapshotEvent({ position: 9, before: 6 }));
      yield* settle;
      const commands = yield* chat.holder(session);
      const reached = chat.connection.hold('entriesBefore');
      const asking = yield* Effect.forkChild(commands.loadOlder(), { startImmediately: true });
      yield* Effect.promise(() => reached);
      yield* commands.aim(new ThreadOpening());
      chat.connection.release('entriesBefore');
      yield* Fiber.join(asking);
      expect(commands.notice).toBeNull();
    }),
  );
});
