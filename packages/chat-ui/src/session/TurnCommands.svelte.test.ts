import { Clock, Effect, Exit, Fiber, Scope } from 'effect';
import { TestClock } from 'effect/testing';
import { it } from '@runlith/effect-test/vitest';
import { describe, expect } from 'vitest';
import type { ChatEntry } from '../entries';
import { PromptHistory, type PromptHistoryEntry, type PromptHistoryStore } from '../PromptHistory';
import { type ChatAnswer, ChatCommandLost, ChatCommandRefused } from '../wire/ChatConnection';
import {
  at,
  bornAs,
  draft,
  openEvent,
  type HolderOptions,
  MEASURED_AT,
  RUN_STARTED_AT,
  settle,
  type SnapshotInput,
  snapshotEvent,
  state,
  stateEvent,
  makeChat,
  type TestChat,
  type TestSession,
  TestDraftState,
} from '../testing/chatHarness.svelte';
import { ChatFold } from '../ChatFold.svelte';
import { MemoryShelf } from '../testing/pendingShelf';
import { ThreadOpening } from './ThreadOpening.svelte';
import { ChatBirthFailed, type ChatBorn, type ChatTurnFailure } from './TurnCommands.svelte';
describe('what says a chat is working', () => {
  it.effect.each(['send', 'continue', 'compact', 'answer'] as const)('a failure received before the %s reply remains settled', (action) =>
    Effect.gen(function* () {
      const { chat, commands, show } = yield* opened();
      yield* show({
        transcript: [user('run-1', 'сделай')],
        latestRun: { id: 'previous-run', status: 'cut', progress: { stage: 'cut', message: null } },
      });
      let pressed: Fiber.Fiber<boolean | void>;
      switch (action) {
        case 'send': {
          const reached = chat.connection.hold('send');
          pressed = yield* Effect.forkChild(commands.sendDraft(draft('Run the task.')), { startImmediately: true });
          yield* Effect.promise(() => reached);
          break;
        }
        case 'continue': {
          chat.connection.answers('continue', { status: 'started', runId: 'run-1' });
          const reached = chat.connection.hold('continue');
          pressed = yield* Effect.forkChild(commands.continue(), { startImmediately: true });
          yield* Effect.promise(() => reached);
          break;
        }
        case 'compact': {
          chat.connection.answers('compact', { status: 'started', runId: 'run-1' });
          const reached = chat.connection.hold('compact');
          pressed = yield* Effect.forkChild(commands.compact(), { startImmediately: true });
          yield* Effect.promise(() => reached);
          break;
        }
        case 'answer': {
          yield* show({ activeRunId: 'run-1' });
          commands.target.fold.entries = [openQuestionEntry()];
          const reached = chat.connection.hold('answer');
          pressed = yield* Effect.forkChild(commands.answerQuestion('question-1', [{ questionId: 'prompt-1', values: ['answer-a'] }]), {
            startImmediately: true,
          });
          yield* Effect.promise(() => reached);
          break;
        }
      }
      yield* show(failedInput());
      chat.connection.release(action);
      yield* Fiber.join(pressed);
      const session = commands.session!;
      expect(session.activeRunId).toBeNull();
      expect(session.life).toBe('idle');
      expect(session.ending).toMatchObject({ kind: 'failed', runId: 'run-1', failure: FAILURE });
      expect(session.fold.entries.map((entry) => entry.kind)).toEqual(['user', 'run-end']);
    }),
  );
  it.effect('a command reply preserves the live waiting state received while it was in flight', () =>
    Effect.gen(function* () {
      const { chat, commands, show } = yield* opened();
      chat.connection.answers('continue', { status: 'already-running', runId: 'run-1' });
      const reached = chat.connection.hold('continue');
      const pressed = yield* Effect.forkChild(commands.continue(), { startImmediately: true });
      yield* Effect.promise(() => reached);
      yield* show({ activeRunId: 'run-1', life: 'awaiting' });
      chat.connection.release('continue');
      yield* Fiber.join(pressed);
      expect(commands.session?.life).toBe('awaiting');
      expect(commands.runId).toBe('run-1');
    }),
  );
  it.effect(
    'a run the server no longer measures as alive leaves the chat idle, and one waiting on its reader is neither working nor over',
    () =>
      Effect.gen(function* () {
        const { commands, show } = yield* opened();
        yield* show({ activeRunId: 'run-1' });
        expect(commands.session?.life).toBe('working');
        yield* show({ activeRunId: 'run-1', life: 'idle' });
        expect(commands.session?.life).toBe('idle');
        expect(commands.runId).toBe('run-1');
        yield* show({ activeRunId: 'run-1', life: 'awaiting' });
        expect(commands.session?.life).toBe('awaiting');
      }),
  );
  it.effect('a stop leaves the chat as working as the server reports it', () =>
    Effect.gen(function* () {
      const { chat, commands, show } = yield* opened();
      yield* show({ activeRunId: 'run-1' });
      yield* commands.stop();
      expect(commands.session?.life).toBe('working');
      expect(commands.runId).toBe('run-1');
      yield* show({});
      expect(commands.session?.life).toBe('idle');
      expect(commands.runId).toBeNull();
      yield* show({ activeRunId: 'run-2' });
      expect(commands.session?.life).toBe('working');
    }),
  );
});
describe('a thread whose work was left standing', () => {
  it.effect('a cut offers the ending in the words the run row carries, or none when it carries none', () =>
    Effect.gen(function* () {
      const { commands, show } = yield* opened();
      yield* show(cutInput('The process left while this run was working; 4 minutes passed.'));
      expect(commands.session?.ending).toMatchObject({
        kind: 'cut',
        runId: 'run-1',
        words: 'The process left while this run was working; 4 minutes passed.',
        failure: null,
      });
      yield* show({ ...cutInput(null), transcript: [] });
      expect(commands.session?.ending).toMatchObject({ kind: 'cut', runId: 'run-1', words: null });
    }),
  );
  it.effect('a failure offers the ending with the row’s reason, record and model', () =>
    Effect.gen(function* () {
      const { commands, show } = yield* opened();
      yield* show(failedInput());
      expect(commands.session?.ending).toEqual({
        kind: 'failed',
        runId: 'run-1',
        words: 'Automatic retry stopped: requested wait 2608000 ms exceeds the 60000 ms ceiling (6 model attempts).',
        failure: FAILURE,
        finishedAt: '2026-01-01T00:04:00.000Z',
        provider: 'subscription',
        model: 'claude-opus-5',
        reasoning: 'xhigh',
      });
    }),
  );
  it.effect('offers nothing for a run somebody stopped, one that completed, or one still going', () =>
    Effect.gen(function* () {
      const { commands, show } = yield* opened();
      yield* show({
        ...cutInput('gone'),
        latestRun: { id: 'run-1', status: 'aborted', progress: { stage: 'cut', message: 'gone' }, settledBy: 'reader' },
      });
      expect(commands.session?.ending).toBeNull();
      yield* show({ ...cutInput('gone'), latestRun: { id: 'run-1', status: 'completed', progress: { stage: null, message: null } } });
      expect(commands.session?.ending).toBeNull();
      yield* show({ activeRunId: 'run-2', latestRun: { id: 'run-2', status: 'running', progress: { stage: 'streaming', message: null } } });
      expect(commands.session?.ending).toBeNull();
    }),
  );
  it.effect('continue opens exactly one run, and the ending stops standing with it', () =>
    Effect.gen(function* () {
      for (const standing of [cutInput('gone'), failedInput()]) {
        const { chat, commands, show } = yield* opened();
        chat.connection.answers('continue', { status: 'started', runId: 'run-2' });
        yield* show(standing);
        expect(yield* commands.continue()).toBe(true);
        yield* show({ activeRunId: 'run-2' });
        expect(chat.connection.called('continue').map((call) => call.threadId)).toEqual(['thread-1']);
        expect(commands.runId).toBe('run-2');
        expect(commands.session?.ending).toBeNull();
        expect(commands.notice).toBeNull();
      }
    }),
  );
  it.effect('a second press while the first is in flight opens nothing', () =>
    Effect.gen(function* () {
      const { chat, commands, show } = yield* opened();
      chat.connection.answers('continue', { status: 'started', runId: 'run-2' });
      yield* show(cutInput('gone'));
      const reached = chat.connection.hold('continue');
      const first = yield* Effect.forkChild(commands.continue(), { startImmediately: true });
      yield* Effect.promise(() => reached);
      expect(commands.busy).toBe('continue');
      expect(yield* commands.continue()).toBe(false);
      chat.connection.release('continue');
      expect(yield* Fiber.join(first)).toBe(true);
      expect(chat.connection.called('continue')).toHaveLength(1);
    }),
  );
  it.effect('a refusal keeps the ending and answers in the producer’s words', () =>
    Effect.gen(function* () {
      const { chat, commands, show } = yield* opened({ notice: (failure) => ({ tone: 'error', message: `no: ${failure.kind}` }) });
      chat.connection.refuses('continue', 'this thread was not cut');
      yield* show(cutInput('gone'));
      expect(yield* commands.continue()).toBe(false);
      expect(commands.busy).toBeNull();
      expect(commands.session?.ending).not.toBeNull();
      expect(commands.notice).toEqual({ tone: 'error', message: 'no: continue-refused' });
    }),
  );
  it.effect('losing the race to another surface follows the winner and shows no refusal', () =>
    Effect.gen(function* () {
      const { chat, commands, show } = yield* opened({ notice: (failure) => ({ tone: 'error', message: failure.kind }) });
      chat.connection.answers('continue', { status: 'already-running', runId: 'run-9' });
      yield* show(cutInput('gone'));
      expect(yield* commands.continue()).toBe(false);
      yield* show({ activeRunId: 'run-9' });
      expect(commands.runId).toBe('run-9');
      expect(commands.session?.ending).toBeNull();
      expect(commands.notice).toBeNull();
    }),
  );
});
describe('sending words', () => {
  it.effect('a started run stays active until a snapshot settles it', () =>
    Effect.gen(function* () {
      const { chat, commands, show } = yield* opened();
      chat.connection.answers('send', { status: 'started', runId: 'run-2', acted: true });
      expect(yield* commands.sendDraft(draft('привет'))).toBe(true);
      yield* show({ activeRunId: 'run-2' });
      expect(commands.runId).toBe('run-2');
      expect(commands.session?.life).toBe('working');
      expect(commands.pending).toBe(false);
      yield* show({});
      expect(commands.runId).toBeNull();
      expect(commands.session?.life).toBe('idle');
    }),
  );
  it.effect('words the thread read into the running run leave no bubble and name that run', () =>
    Effect.gen(function* () {
      const { chat, commands, show } = yield* running('дай задание');
      chat.connection.answers('send', { status: 'steered', runId: 'run-9', itemId: 'steer-9', acted: true });
      expect(yield* commands.send()).toBe(true);
      expect(sentTexts(chat, 'send')).toEqual(['дай задание']);
      expect(commands.target.fold.entries).toHaveLength(0);
      expect(commands.draft.current.text).toBe('');
      expect(commands.notice).toBeNull();
      yield* show({ activeRunId: 'run-9', steers: [{ id: 'steer-1', text: 'дай задание' }] });
      expect(commands.session?.pendingSteers.map((item) => item.text)).toEqual(['дай задание']);
      expect(commands.session?.queued).toEqual([]);
    }),
  );
  it.effect('words the server took stand as the next step until a frame lists them as its own', () =>
    Effect.gen(function* () {
      const { chat, commands, show } = yield* running('дай задание');
      chat.connection.answers('send', { status: 'steered', runId: 'run-1', itemId: 'steer-1', acted: true });
      expect(yield* commands.send()).toBe(true);
      const key = (chat.connection.called('send')[0]!.input as { key: string }).key;
      yield* show({ activeRunId: 'run-1' });
      expect(commands.session?.pendingSteers.map((item) => item.text)).toEqual(['дай задание']);
      yield* show({
        activeRunId: 'run-1',
        steers: [{ id: 'steer-1', text: 'дай задание' }],
        receipts: [{ key, status: 'steered', runId: 'run-1', itemId: 'steer-1', occurredAt: '2026-01-01T00:00:00.000Z' }],
      });
      expect(commands.session?.pendingSteers.map((item) => item.id)).toEqual(['steer-1']);
    }),
  );
  it.effect('a draft carrying attachments takes the same one road', () =>
    Effect.gen(function* () {
      const { chat, commands } = yield* running('Check this screenshot.', ['screenshot.png']);
      chat.connection.answers('send', { status: 'steered', runId: 'run-1', itemId: 'steer-1', acted: true });
      expect(yield* commands.send()).toBe(true);
      expect(chat.connection.called('send').map((call) => call.input)).toEqual([
        expect.objectContaining({ text: 'Check this screenshot.', attachments: [{ id: 'screenshot.png' }] }),
      ]);
      expect(commands.target.fold.entries).toHaveLength(0);
    }),
  );
  it.effect('the queue press issues the queue verb and lists what waits instead of drawing it', () =>
    Effect.gen(function* () {
      const { chat, commands, show } = yield* running('и ещё вот это');
      chat.connection.answers('queue', { status: 'queued', runId: 'run-1', acted: true, queued: queuedRow('и ещё вот это') });
      const reached = chat.connection.hold('queue');
      const queueing = yield* Effect.forkChild(commands.queueDraft(), { startImmediately: true });
      yield* Effect.promise(() => reached);
      expect(commands.target.fold.entries).toHaveLength(0);
      chat.connection.release('queue');
      expect(yield* Fiber.join(queueing)).toBe(true);
      expect(sentTexts(chat, 'queue')).toEqual(['и ещё вот это']);
      expect(chat.connection.called('send')).toEqual([]);
      expect(commands.draft.current.text).toBe('');
      expect(commands.target.fold.entries).toHaveLength(0);
      yield* show({ activeRunId: 'run-1', queued: [{ id: 'queued-1', text: 'и ещё вот это' }] });
      expect(commands.session?.queued.map((item) => item.text)).toEqual(['и ещё вот это']);
    }),
  );
  it.effect('the composer empties at the press, before the server has answered', () =>
    Effect.gen(function* () {
      const { chat, commands } = yield* opened({ text: 'начни' });
      const reached = chat.connection.hold('send');
      const sending = yield* Effect.forkChild(commands.send(), { startImmediately: true });
      yield* Effect.promise(() => reached);
      expect(commands.draft.current.text).toBe('');
      chat.connection.release('send');
      expect(yield* Fiber.join(sending)).toBe(true);
      expect(commands.draft.current.text).toBe('');
    }),
  );
  it.effect('the draft is told its message was accepted only when the thread took it, and what it says is the notice', () =>
    Effect.gen(function* () {
      const taken = yield* opened({ text: 'начни', attachments: ['doc-1'] });
      taken.draft.late = { tone: 'error', message: 'the mark did not move' };
      expect(yield* taken.commands.send()).toBe(true);
      expect(taken.draft.delivered).toEqual([{ text: 'начни', attachments: ['doc-1'] }]);
      expect(taken.commands.notice).toEqual({ tone: 'error', message: 'the mark did not move' });
      const refused = yield* opened({ text: 'начни', attachments: ['doc-1'] });
      refused.chat.connection.refuses('send', 'нет');
      expect(yield* refused.commands.send()).toBe(false);
      expect(refused.draft.delivered).toEqual([]);
    }),
  );
  it.effect('a refused send hands the draft back whole, ahead of whatever the reader wrote meanwhile', () =>
    Effect.gen(function* () {
      const { chat, commands, draft: drafts } = yield* opened({ text: 'начни', attachments: ['image-1'] });
      chat.connection.refuses('send', 'нет');
      const reached = chat.connection.hold('send');
      const sending = yield* Effect.forkChild(commands.send(), { startImmediately: true });
      yield* Effect.promise(() => reached);
      drafts.set(draft('уже другое'));
      chat.connection.release('send');
      expect(yield* Fiber.join(sending)).toBe(false);
      expect(commands.draft.current).toEqual({ text: 'начни\n\nуже другое', attachments: ['image-1'] });
      expect(commands.target.fold.entries).toHaveLength(0);
    }),
  );
  it.effect('a snapshot without the turn keeps its opening on screen until the echo replaces it', () =>
    Effect.gen(function* () {
      const { chat, commands, show } = yield* opened({ text: 'начни' });
      const reached = chat.connection.hold('send');
      const sending = yield* Effect.forkChild(commands.send(), { startImmediately: true });
      yield* Effect.promise(() => reached);
      yield* show({});
      expect(commands.target.fold.entries.map((entry) => entry.kind)).toEqual(['user']);
      chat.connection.release('send');
      expect(yield* Fiber.join(sending)).toBe(true);
      yield* show({ activeRunId: 'run-1', transcript: [user('run-1', 'начни')] });
      expect(ids(commands.target.fold.entries)).toEqual(['message:user:run-1']);
    }),
  );
  it.effect('words the run has not read are listed as waiting and drawn from their journal record', () =>
    Effect.gen(function* () {
      const { commands, show } = yield* opened();
      const steered = {
        type: 'signal',
        id: 'transcript:signal:steer-1',
        runId: 'run-1',
        signalType: 'user-message',
        addressee: 'reader',
        text: 'use the other table',
      };
      yield* show({
        activeRunId: 'run-1',
        steers: [{ id: 'steer-1', text: 'use the other table' }],
        transcript: [user('run-1', 'начни'), steered],
      });
      expect(commands.session?.pendingSteers.map((item) => item.text)).toEqual(['use the other table']);
      expect(ids(commands.target.fold.entries)).toEqual(['message:user:run-1', 'transcript:signal:steer-1']);
      yield* show({ activeRunId: 'run-1', transcript: [user('run-1', 'начни'), steered] });
      expect(commands.session?.pendingSteers).toEqual([]);
      expect(ids(commands.target.fold.entries)).toEqual(['message:user:run-1', 'transcript:signal:steer-1']);
    }),
  );
  it.effect('a clean settle restores the durable transcript without an interruption or a duplicate', () =>
    Effect.gen(function* () {
      const { chat, commands, show } = yield* opened();
      yield* show({
        activeRunId: 'run-1',
        transcript: [user('run-1', 'привет как дела')],
        open: [{ type: 'message', id: 'assistant:run-1', role: 'assistant', runId: 'run-1', text: 'Здраво!' }],
      });
      yield* show({
        transcript: [
          user('run-1', 'привет как дела'),
          { type: 'message', id: 'assistant:run-1', role: 'assistant', runId: 'run-1', text: 'Здраво!' },
        ],
      });
      expect(commands.target.fold.entries.some((entry) => entry.kind === 'interruption')).toBe(false);
      expect(ids(commands.target.fold.entries)).toEqual(['message:user:run-1', 'assistant:run-1']);
    }),
  );
});
describe('the run clock', () => {
  it.effect('reports the run’s age on the server’s clock, whatever this tab’s clock says', () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse('2026-01-01T09:00:00.000Z'));
      const { commands, show } = yield* opened();
      yield* show({ activeRunId: 'run-1' });
      expect((yield* Clock.currentTimeMillis) - (commands.session?.runStartedAt ?? 0)).toBe(
        Date.parse(MEASURED_AT) - Date.parse(RUN_STARTED_AT),
      );
    }),
  );
  it.effect('a newer phase from the open stream outlives the state frames that follow it', () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse('2026-01-01T09:00:00.000Z'));
      const { chat, commands, show } = yield* opened();
      const since = Date.parse(MEASURED_AT) - 78000;
      yield* show({ activeRunId: 'run-1', progress: { phase: { phase: 'compacting', since } as never, estimate: null } });
      const session = commands.session!;
      expect(session.runPhase?.phase).toBe('compacting');
      expect((yield* Clock.currentTimeMillis) - session.runPhase!.since).toBe(78000);
      const start = session.runStartedAt;
      chat.connection.emit(
        openEvent({ op: 'progress', progress: { phase: { phase: 'calling', since: since + 77000 } as never, estimate: null } }, at(0, 2)),
      );
      yield* settle;
      chat.connection.emit(stateEvent({ activeRunId: 'run-1' }, at(0, 3)));
      yield* settle;
      expect(session.runPhase?.phase).toBe('calling');
      expect((yield* Clock.currentTimeMillis) - session.runPhase!.since).toBe(1000);
      expect(session.runStartedAt).toBe(start);
    }),
  );
});
describe('stopping a run', () => {
  it.effect('stop shows the interruption the server recorded, never one of its own, and leaves what waits', () =>
    Effect.gen(function* () {
      const { chat, commands, show } = yield* opened();
      yield* show({
        activeRunId: 'run-1',
        transcript: [user('run-1', 'Создай 16 задач')],
        queued: [{ id: 'queued-1', text: 'and check the second card' }],
      });
      yield* commands.stop();
      expect(commands.session?.queued.map((item) => item.text)).toEqual(['and check the second card']);
      yield* show({ transcript: [user('run-1', 'Создай 16 задач'), { id: 'interruption:run-1', type: 'interruption', runId: 'run-1' }] });
      expect(commands.target.fold.entries.map((entry) => entry.kind)).toContain('interruption');
    }),
  );
  it.effect('a stop names no run, asks for the turn back, and the words return from the frame that ends it', () =>
    Effect.gen(function* () {
      const { chat, commands, show } = yield* opened();
      yield* show({ activeRunId: 'run-1', transcript: [user('run-1', 'как дела')] });
      yield* commands.stop();
      expect(chat.connection.called('stop').map((call) => call.input)).toEqual([{ withdraw: true }]);
      expect(commands.draft.current.text).toBe('');
      yield* show({ withdrawn: 'run-1', withdrawnWords: 'как дела' });
      expect(commands.draft.current.text).toBe('как дела');
    }),
  );
  it.effect('a turn withdrawn before the journal kept it leaves the feed and returns to the field', () =>
    Effect.gen(function* () {
      const { commands, show } = yield* opened({ text: 'как дела' });
      expect(yield* commands.send()).toBe(true);
      yield* show({ activeRunId: 'run-1' });
      expect(ids(commands.target.fold.entries)).toEqual(['message:user:run-1']);
      yield* commands.stop();
      yield* show({ withdrawn: 'run-1', withdrawnWords: 'как дела' });
      expect(commands.target.fold.entries).toEqual([]);
      expect(commands.draft.current.text).toBe('как дела');
    }),
  );
  it.effect('Stopping… stands from the press to the frame that ends the run, and a second press sends nothing', () =>
    Effect.gen(function* () {
      const { chat, commands, show } = yield* opened();
      yield* show({ activeRunId: 'run-1' });
      expect(commands.halt).toBe('stop');
      const reached = chat.connection.hold('stop');
      const first = yield* Effect.forkChild(commands.stop(), { startImmediately: true });
      expect(commands.halt).toBe('stopping');
      yield* Effect.promise(() => reached);
      yield* commands.stop();
      chat.connection.release('stop');
      yield* Fiber.join(first);
      expect(chat.connection.called('stop')).toHaveLength(1);
      expect(commands.halt).toBe('stopping');
      yield* show({});
      expect(commands.halt).toBeNull();
    }),
  );
  it.effect('a run another process owns reads as being stopped until its end arrives', () =>
    Effect.gen(function* () {
      const { chat, commands, show } = yield* opened();
      chat.connection.answers('stop', { status: 'requested', runId: 'run-1' });
      yield* show({ activeRunId: 'run-1' });
      yield* commands.stop();
      expect(commands.halt).toBe('requested');
      expect(commands.notice).toBeNull();
      yield* show({});
      expect(commands.halt).toBeNull();
    }),
  );
  it.effect('a stop that found nothing running says so and stops standing', () =>
    Effect.gen(function* () {
      const { chat, commands, show } = yield* opened({ notice: (failure) => ({ tone: 'success', message: failure.kind }) });
      chat.connection.answers('stop', { status: 'nothing-running' });
      yield* show({ activeRunId: 'run-1' });
      yield* commands.stop();
      expect(commands.notice).toEqual({ tone: 'success', message: 'nothing-running' });
      expect(commands.halt).toBe('stop');
    }),
  );
  it.effect('a stop the feed has not settled while it reconnects still goes, by the run the session last saw', () =>
    Effect.gen(function* () {
      const { chat, commands, show } = yield* opened();
      yield* show({ activeRunId: 'run-1' });
      chat.connection.emit({ type: 'interrupted', message: 'the socket closed' });
      yield* settle;
      expect(commands.session?.feed.kind).toBe('lost');
      expect(commands.halt).toBe('stop');
      yield* commands.stop();
      expect(chat.connection.called('stop')).toHaveLength(1);
    }),
  );
  it.effect('a turn the server kept leaves the field alone, whether or not the run already answered', () =>
    Effect.gen(function* () {
      for (const answered of [false, true]) {
        const { chat, commands, show } = yield* opened();
        const transcript = [
          user('run-1', 'как дела'),
          ...(answered ? [{ id: 'assistant:run-1', type: 'message', role: 'assistant', runId: 'run-1', text: 'Уже' }] : []),
        ];
        yield* show({ activeRunId: 'run-1', transcript });
        yield* commands.stop();
        yield* show({
          transcript,
          latestRun: { id: 'run-1', status: 'aborted', progress: { stage: null, message: null }, settledBy: 'reader' },
        });
        expect(commands.draft.current.text).toBe('');
        expect(ids(commands.target.fold.entries)).toContain('message:user:run-1');
      }
    }),
  );
  it.effect('the end of a newer run than the one on screen, arriving before the answer, still returns its words', () =>
    Effect.gen(function* () {
      const { chat, commands, show } = yield* opened();
      chat.connection.answers('stop', { status: 'stopped', runId: 'run-2' });
      yield* show({ activeRunId: 'run-1' });
      const reached = chat.connection.hold('stop');
      const pressed = yield* Effect.forkChild(commands.stop(), { startImmediately: true });
      yield* Effect.promise(() => reached);
      yield* show({ withdrawn: 'run-2', withdrawnWords: 'новое слово' });
      expect(commands.draft.current.text).toBe('');
      chat.connection.release('stop');
      yield* Fiber.join(pressed);
      yield* settle;
      expect(commands.draft.current.text).toBe('новое слово');
    }),
  );
  it.effect('a refused stop says why and arms no return', () =>
    Effect.gen(function* () {
      const { chat, commands, show } = yield* opened({ notice: (failure) => ({ tone: 'error', message: failure.kind }) });
      chat.connection.refuses('stop', 'no');
      yield* show({ activeRunId: 'run-1' });
      yield* commands.stop();
      expect(commands.notice).toEqual({ tone: 'error', message: 'stop-refused' });
      expect(commands.halt).toBe('stop');
      yield* show({ withdrawn: 'run-1', withdrawnWords: 'как дела' });
      expect(commands.draft.current.text).toBe('');
    }),
  );
  it.effect('words come back once, though every later frame still carries the ending', () =>
    Effect.gen(function* () {
      const { chat, commands, show, draft: drafts } = yield* opened();
      chat.connection.answers('stop', { status: 'stopped', runId: 'run-2' });
      yield* show({ activeRunId: 'run-2', transcript: [user('run-2', 'почему ты здесь')] });
      yield* commands.stop();
      yield* show({ activeRunId: 'run-2', transcript: [user('run-2', 'почему ты здесь')] });
      expect(commands.draft.current.text).toBe('');
      yield* show({ withdrawn: 'run-2', withdrawnWords: 'почему ты здесь' });
      expect(commands.draft.current.text).toBe('почему ты здесь');
      drafts.set(draft('совсем другое'));
      yield* show({ withdrawn: 'run-2', withdrawnWords: 'почему ты здесь' });
      expect(commands.draft.current.text).toBe('совсем другое');
    }),
  );
  it.effect('withdrawn words land in a field that is no longer empty without losing either', () =>
    Effect.gen(function* () {
      const { commands, show } = yield* opened({ text: 'уже пишу другое' });
      yield* show({ activeRunId: 'run-1', transcript: [user('run-1', 'как дела')] });
      yield* commands.stop();
      yield* show({ withdrawn: 'run-1', withdrawnWords: 'как дела' });
      expect(commands.draft.current.text).toBe('как дела\n\nуже пишу другое');
    }),
  );
});
describe('queued words', () => {
  it.effect('unqueues words the reader took back, and a row the server did not take stays', () =>
    Effect.gen(function* () {
      for (const status of ['unqueued', 'not-queued'] as const) {
        const { chat, commands, show } = yield* opened();
        chat.connection.answers('unqueue', { status });
        yield* show({ activeRunId: 'run-1', queued: [{ id: 'queued-1', text: 'never mind' }] });
        yield* commands.waiting.unqueue('queued-1');
        expect(chat.connection.called('unqueue').map((call) => call.input)).toEqual([{ inputId: 'queued-1' }]);
        expect(commands.session?.queued.map((item) => item.id)).toEqual(status === 'unqueued' ? [] : ['queued-1']);
      }
    }),
  );
  it.effect('words taken back to edit return to the field with their attachments unless the run already read them', () =>
    Effect.gen(function* () {
      for (const answer of ['unqueued', 'not-queued', 'lost'] as const) {
        const { chat, commands, draft: drafts, show } = yield* opened();
        if (answer === 'lost') chat.connection.stub('unqueue', () => Effect.fail(new ChatCommandLost({ message: 'dropped' })));
        else chat.connection.answers('unqueue', { status: answer });
        yield* show({
          activeRunId: 'run-1',
          steers: [{ id: 'steer-1', text: 'look here', attachments: [{ id: 'a.png', mime: 'image/png', url: '/a.png' }] }],
        });
        yield* commands.waiting.edit('steer-1');
        expect(drafts.current).toEqual(answer === 'not-queued' ? draft('') : draft('look here', ['/a.png']));
      }
    }),
  );
  it.effect('a follow-up moved to the next step leaves the queue and goes into the run with the same attachments', () =>
    Effect.gen(function* () {
      const { chat, commands, show } = yield* opened();
      chat.connection.answers('send', { status: 'steered', runId: 'run-1', itemId: 'steer-1', acted: true });
      yield* show({
        activeRunId: 'run-1',
        queued: [{ id: 'queued-1', text: 'then the tests', attachments: [{ id: 'b.pdf', mime: 'application/pdf', url: '/b.pdf' }] }],
      });
      yield* commands.waiting.promote('queued-1');
      expect(chat.connection.called('unqueue').map((call) => call.input)).toEqual([{ inputId: 'queued-1' }]);
      expect(chat.connection.called('send').map((call) => call.input)).toMatchObject([
        { text: 'then the tests', attachments: [{ id: 'b.pdf' }] },
      ]);
      expect(commands.notice).toBeNull();
    }),
  );
});
describe('answers and compaction', () => {
  it.effect('submits an answer into the run that asked, and keeps pending while it resumes', () =>
    Effect.gen(function* () {
      const { chat, commands, show } = yield* opened();
      yield* show({ activeRunId: 'run-1' });
      commands.target.fold.entries = [openQuestionEntry()];
      const reached = chat.connection.hold('answer');
      const answered = yield* Effect.forkChild(commands.answerQuestion('question-1', [{ questionId: 'prompt-1', values: ['answer-a'] }]), {
        startImmediately: true,
      });
      yield* Effect.promise(() => reached);
      expect(commands.pending).toBe(true);
      chat.connection.release('answer');
      yield* Fiber.join(answered);
      expect(chat.connection.called('answer').map((call) => call.input)).toEqual([
        { questionId: 'question-1', answers: [{ questionId: 'prompt-1', values: ['answer-a'] }], key: expect.any(String) },
      ]);
      expect(commands.notice).toBeNull();
    }),
  );
  it.effect('a refused answer takes back only its own marks on the question', () =>
    Effect.gen(function* () {
      const { chat, commands, show } = yield* opened();
      yield* show({ activeRunId: 'run-1' });
      commands.target.fold.entries = [openQuestionEntry(), { id: 'assistant-1', kind: 'assistant', runId: 'run-1', text: 'after' }];
      chat.connection.refuses('answer', 'no');
      yield* commands.answerQuestion('question-1', [{ questionId: 'prompt-1', values: ['answer-a'] }]);
      expect(commands.target.fold.entries.map((entry) => entry.id)).toEqual(['entry-1', 'assistant-1']);
      expect(commands.target.fold.openQuestion).toBe(true);
    }),
  );
  it.effect('a lost answer is sent again under its own key and settles once the server takes it', () =>
    Effect.gen(function* () {
      const { chat, commands, show } = yield* opened();
      yield* show({ activeRunId: 'run-1' });
      commands.target.fold.entries = [openQuestionEntry()];
      let lost = true;
      chat.connection.stub('answer', () => {
        if (!lost) return Effect.succeed({ status: 'started', runId: 'run-1' } as const);
        lost = false;
        return Effect.fail(new ChatCommandLost({ message: 'closed' }));
      });
      yield* commands.answerQuestion('question-1', [{ questionId: 'prompt-1', values: ['answer-a'] }]);
      expect(commands.target.fold.entries[0]).toMatchObject({ sending: { unconfirmed: true } });
      expect(questionOf(commands.target.fold.entries[0]).answers).toBeUndefined();
      yield* TestClock.adjust(5);
      const keys = chat.connection.called('answer').map((call) => (call.input as ChatAnswer).key);
      expect(keys).toEqual([keys[0], keys[0]]);
      expect(commands.target.fold.entries[0]).toMatchObject({ answers: [{ questionId: 'prompt-1', values: ['answer-a'] }] });
      expect(chat.shelf.kept()).toEqual([]);
    }),
  );
  it.effect('an answer the server never confirms reads as unsent until the question the server settles ends it', () =>
    Effect.gen(function* () {
      const { chat, commands, show } = yield* opened();
      yield* show({ activeRunId: 'run-1', transcript: [openQuestionRecord()] });
      chat.connection.stub('answer', () => Effect.fail(new ChatCommandLost({ message: 'closed' })));
      yield* commands.answerQuestion('question-1', [{ questionId: 'prompt-1', values: ['answer-a'] }]);
      yield* TestClock.adjust('1 second');
      expect(questionOf(commands.target.fold.entries[0]).answers).toBeUndefined();
      expect(chat.shelf.kept()).toHaveLength(1);
      const answered = [{ questionId: 'prompt-1', values: ['answer-b'] }];
      yield* show({ activeRunId: 'run-1', transcript: [{ ...openQuestionRecord(), status: 'answered', answers: answered }] });
      expect(commands.target.fold.entries[0]).toMatchObject({ answers: answered });
      expect(chat.shelf.kept()).toEqual([]);
    }),
  );
  it.effect('a question the feed shows settled ends the answer still in flight', () =>
    Effect.gen(function* () {
      const { chat, commands, show } = yield* opened();
      yield* show({ activeRunId: 'run-1', transcript: [openQuestionRecord()] });
      const reached = chat.connection.hold('answer');
      yield* Effect.forkChild(commands.answerQuestion('question-1', [{ questionId: 'prompt-1', values: ['answer-a'] }]), {
        startImmediately: true,
      });
      yield* Effect.promise(() => reached);
      yield* show({ activeRunId: 'run-1', transcript: [{ ...openQuestionRecord(), status: 'lapsed' }] });
      expect(chat.shelf.kept()).toEqual([]);
      expect(chat.pending.answersOf('thread-1')).toEqual([]);
    }),
  );
  it.effect('an answer outlives the session that sent it and still reaches the server', () =>
    Effect.gen(function* () {
      const chat = yield* makeChat();
      const thread = yield* chat.open();
      const commands = yield* chat.holder(thread.session);
      chat.connection.emit(snapshotEvent({ activeRunId: 'run-1', transcript: [openQuestionRecord()] }));
      yield* settle;
      const taken: string[] = [];
      chat.connection.stub('answer', (answer) =>
        Effect.sync(() => {
          taken.push(answer.key);
          return { status: 'started', runId: 'run-1' } as const;
        }),
      );
      const reached = chat.connection.hold('answer');
      const pressed = yield* Effect.forkChild(commands.answerQuestion('question-1', [{ questionId: 'prompt-1', values: ['answer-a'] }]), {
        startImmediately: true,
      });
      yield* Effect.promise(() => reached);
      yield* Fiber.interrupt(pressed);
      yield* thread.dispose();
      chat.connection.release('answer');
      yield* settle;
      expect(taken).toEqual([(chat.connection.called('answer')[0]!.input as ChatAnswer).key]);
      expect(chat.shelf.kept()).toEqual([]);
    }),
  );
  it.effect('a thread opened again from the shelf sends the answer to the question it shows', () =>
    Effect.gen(function* () {
      const chat = yield* makeChat();
      let fold!: ChatFold;
      const leave = $effect.root(() => {
        fold = new ChatFold();
      });
      const first = yield* chat.open('thread-1', { detached: { fold, at: at(0, 1), state: state(), readAt: 0 } });
      chat.connection.emit(snapshotEvent({ activeRunId: 'run-1', transcript: [user('run-1', 'начни')] }));
      yield* settle;
      expect(first.session.fold.openQuestion).toBe(false);
      yield* first.detach();
      leave();
      const again = yield* chat.open('thread-1', { detached: chat.detached.take('thread-1') });
      chat.connection.emit(snapshotEvent({ activeRunId: 'run-1', transcript: [user('run-1', 'начни'), openQuestionRecord()] }));
      yield* settle;
      const commands = yield* chat.holder(again.session);
      yield* commands.answerQuestion('question-1', [{ questionId: 'prompt-1', values: ['answer-a'] }]);
      expect(chat.connection.called('answer').map((call) => call.input)).toEqual([
        { questionId: 'question-1', answers: [{ questionId: 'prompt-1', values: ['answer-a'] }], key: expect.any(String) },
      ]);
    }),
  );
  it.effect('a notice raised in one thread is not shown in the thread the holder moves to', () =>
    Effect.gen(function* () {
      const { chat, commands } = yield* opened();
      yield* commands.answerQuestion('question-1', [{ questionId: 'prompt-1', values: ['answer-a'] }]);
      expect(commands.notice).not.toBeNull();
      yield* commands.aim((yield* chat.open('thread-2')).session);
      expect(commands.notice).toBeNull();
    }),
  );
  it.effect('starts and stops manual compaction through the ordinary run controls', () =>
    Effect.gen(function* () {
      const { chat, commands, show } = yield* opened();
      chat.connection.answers('compact', { status: 'started', runId: 'run-compact-1' });
      expect(yield* commands.compact()).toBe(true);
      yield* show({
        activeRunId: 'run-compact-1',
        transcript: [{ id: 'compaction:run-compact-1', type: 'compaction', runId: 'run-compact-1', mode: 'manual', status: 'running' }],
      });
      expect(commands.runId).toBe('run-compact-1');
      expect(commands.target.fold.entries).toContainEqual(
        expect.objectContaining({ kind: 'compaction', runId: 'run-compact-1', compactionStatus: 'running' }),
      );
      yield* commands.stop();
      expect(chat.connection.called('stop')).toHaveLength(1);
      yield* show({
        transcript: [{ id: 'compaction:run-compact-1', type: 'compaction', runId: 'run-compact-1', mode: 'manual', status: 'aborted' }],
      });
      expect(commands.target.fold.entries).toContainEqual(expect.objectContaining({ kind: 'compaction', compactionStatus: 'aborted' }));
      expect(commands.target.fold.entries.some((entry) => entry.kind === 'interruption')).toBe(false);
    }),
  );
  it.effect('a compaction pressed under a going run asks the server with its point and draws only what the server lists', () =>
    Effect.gen(function* () {
      const { chat, commands, show } = yield* opened();
      chat.connection.answers('compact', { status: 'requested', requestId: 'compact-1', at: 'end', runId: 'run-1' });
      yield* show({ activeRunId: 'run-1' });
      expect(yield* commands.compact('end')).toBe(true);
      expect(chat.connection.called('compact').map((call) => call.input)).toEqual([{ at: 'end' }]);
      expect(commands.target.fold.entries.some((entry) => entry.kind === 'compaction')).toBe(false);
      yield* show({ activeRunId: 'run-1', queued: [{ id: 'compact-1', text: '', kind: 'compaction', keep: 'the plan in hand' }] });
      expect(commands.session?.queued).toEqual([
        expect.objectContaining({ id: 'compact-1', kind: 'compaction', text: 'the plan in hand' }),
      ]);
    }),
  );
  it.effect('reports a refusal as structure and says nothing when the product words it as silence', () =>
    Effect.gen(function* () {
      const failures: ChatTurnFailure<unknown>[] = [];
      const { chat, commands } = yield* opened({
        notice: (failure) => {
          failures.push(failure);
          return failure.kind === 'question-settled' ? { tone: 'error', message: 'product words' } : null;
        },
      });
      commands.target.fold.entries = [openQuestionEntry()];
      yield* commands.answerQuestion('question-1', [{ questionId: 'prompt-1', values: ['a'] }]);
      expect(failures).toEqual([{ kind: 'question-settled' }]);
      expect(commands.notice).toEqual({ tone: 'error', message: 'product words' });
      expect(commands.target.fold.openQuestion).toBe(false);
      chat.connection.refuses('compact', 'no', 'no-summarizer');
      expect(yield* commands.compact()).toBe(false);
      expect(failures.at(-1)).toEqual({ kind: 'compact-refused', message: 'no', code: 'no-summarizer' });
      expect(commands.notice).toBeNull();
    }),
  );
});
describe('every turn is its own transaction', () => {
  it.effect('a refusal of one of two turns takes back only that one', () =>
    Effect.gen(function* () {
      const { chat, commands, show } = yield* opened({ text: 'первый' });
      const second = yield* chat.holder(commands.target, { draft: new TestDraftState() });
      second.draft.handBack(second.draft.key, draft('второй'));
      let sent = 0;
      chat.connection.stub('send', () =>
        ++sent === 1
          ? Effect.fail(new ChatCommandRefused({ message: 'нет' }))
          : Effect.succeed({ status: 'started' as const, runId: 'run-2', acted: true }),
      );
      const reached = chat.connection.hold('send');
      const refused = yield* Effect.forkChild(commands.send(), { startImmediately: true });
      yield* Effect.promise(() => reached);
      const accepted = yield* Effect.forkChild(second.send(), { startImmediately: true });
      expect(commands.target.fold.entries.map((entry) => entry.kind === 'user' && entry.text)).toEqual(['первый', 'второй']);
      chat.connection.release('send');
      expect(yield* Fiber.joinAll([refused, accepted])).toEqual([false, true]);
      expect(ids(commands.target.fold.entries)).toEqual(['message:user:run-2']);
      expect(commands.draft.current.text).toBe('первый');
      expect(second.draft.current.text).toBe('');
      yield* show({ activeRunId: 'run-2', transcript: [user('run-2', 'второй')] });
      expect(ids(commands.target.fold.entries)).toEqual(['message:user:run-2']);
    }),
  );
  it.effect(
    'an outcome nobody knows stays unconfirmed and on screen; the producer’s record swaps the bubble but the receipt settles the turn',
    () =>
      Effect.gen(function* () {
        const { chat, commands, show } = yield* opened({ text: 'дошло ли' });
        chat.connection.stub('send', () => Effect.fail(new ChatCommandLost({ message: 'the socket closed mid-send' })));
        expect(yield* commands.send()).toBe(false);
        expect(commands.notice).toEqual({ tone: 'error', message: 'refused' });
        expect(commands.draft.current.text).toBe('');
        yield* show({});
        expect(commands.target.fold.entries.map((entry) => entry.kind === 'user' && entry.text)).toEqual(['дошло ли']);
        expect(chat.pending.of('thread-1').map((turn) => turn.state)).toEqual(['unconfirmed']);
        const sent = chat.connection.called('send')[0]!.input as {
          key: string;
        };
        yield* show({ activeRunId: 'run-1', transcript: [{ ...user('run-1', 'дошло ли'), turnKey: sent.key }] });
        expect(ids(commands.target.fold.entries)).toEqual(['message:user:run-1']);
        expect(chat.pending.of('thread-1').map((turn) => turn.state)).toEqual(['unconfirmed']);
        yield* show({
          activeRunId: 'run-1',
          transcript: [{ ...user('run-1', 'дошло ли'), turnKey: sent.key }],
          receipts: [{ key: sent.key, status: 'queued', runId: 'run-1', itemId: 'i-1', occurredAt: '2026-01-01T00:00:00.000Z' }],
        });
        expect(chat.pending.of('thread-1')).toEqual([]);
      }),
  );
  it.effect('an unconfirmed turn is marked as such, and removing it gives its words back once', () =>
    Effect.gen(function* () {
      const { chat, commands, show } = yield* opened({ text: 'дошло ли' });
      chat.connection.stub('send', () => Effect.fail(new ChatCommandLost({ message: 'closed' })));
      yield* commands.send();
      yield* show({});
      const bubble = commands.target.fold.entries[0];
      expect(bubble).toMatchObject({ kind: 'user', unconfirmed: true });
      const turnKey = bubble?.kind === 'user' ? (bubble.turnKey ?? '') : '';
      commands.forget(turnKey);
      commands.forget(turnKey);
      expect(commands.draft.current.text).toBe('дошло ли');
      expect(commands.target.fold.entries).toHaveLength(0);
    }),
  );
  describe('a turn nobody confirmed is resolved by the producer’s receipt, never by the absence of its record', () => {
    const lost = () => Effect.fail(new ChatCommandLost({ message: 'closed' }));
    it.effect('the resend of the same key returns the recorded receipt and confirms the turn', () =>
      Effect.gen(function* () {
        {
          const { chat, commands, show } = yield* opened({ text: 'дошло ли' });
          chat.connection.stub('send', lost);
          yield* commands.send();
          yield* show({});
          expect(chat.pending.of('thread-1').map((turn) => turn.state)).toEqual(['unconfirmed']);
          chat.connection.answers('send', { status: 'started', runId: 'run-1', acted: false });
          yield* TestClock.adjust(20);
          const keys = chat.connection.called('send').map(
            (call) =>
              (
                call.input as {
                  key: string;
                }
              ).key,
          );
          expect(keys).toHaveLength(2);
          expect(keys[1]).toBe(keys[0]);
          expect(chat.pending.of('thread-1')).toEqual([]);
          expect(ids(commands.target.fold.entries)).toEqual(['message:user:run-1']);
        }
      }),
    );
    it.effect('a resend the producer refuses rolls the turn back and gives its words back', () =>
      Effect.gen(function* () {
        {
          const { chat, commands, show } = yield* opened({ text: 'дошло ли' });
          chat.connection.stub('send', lost);
          yield* commands.send();
          yield* show({});
          chat.connection.refuses('send', 'the thread was archived');
          yield* TestClock.adjust(20);
          expect(chat.pending.of('thread-1')).toEqual([]);
          expect(commands.target.fold.entries).toHaveLength(0);
          expect(commands.draft.current.text).toBe('дошло ли');
        }
      }),
    );
    it.effect('a receipt the status carries confirms the turn without a resend, and a state that lacks the turn decides nothing', () =>
      Effect.gen(function* () {
        const { chat, commands, show } = yield* opened({ text: 'дошло ли' });
        chat.connection.stub('send', lost);
        yield* commands.send();
        yield* show({});
        expect(chat.pending.of('thread-1').map((turn) => turn.state)).toEqual(['unconfirmed']);
        const key = (
          chat.connection.called('send')[0]!.input as {
            key: string;
          }
        ).key;
        yield* show({ activeRunId: 'run-1' });
        expect(chat.pending.of('thread-1').map((turn) => turn.state)).toEqual(['unconfirmed']);
        yield* show({
          activeRunId: 'run-1',
          receipts: [{ key, status: 'queued', runId: 'run-1', itemId: 'queued-1', occurredAt: '2026-01-01T00:00:00.000Z' }],
        });
        expect(chat.pending.of('thread-1')).toEqual([]);
        expect(commands.target.fold.entries).toHaveLength(0);
      }),
    );
    it.effect('a words sent into a running run that nobody confirmed stays on screen and can be sent again', () =>
      Effect.gen(function* () {
        const { chat, commands, show } = yield* opened({ text: 'ещё' });
        yield* show({ activeRunId: 'run-1' });
        chat.connection.stub('send', lost);
        expect(yield* commands.send()).toBe(false);
        yield* show({ activeRunId: 'run-1' });
        expect(commands.target.fold.entries.map((entry) => entry.kind === 'user' && entry.unconfirmed)).toEqual([true]);
        const inputId = chat.pending.of('thread-1')[0]!.inputId;
        yield* TestClock.adjust(120);
        chat.connection.answers('send', { status: 'steered', runId: 'run-1', itemId: 'i-1', acted: false });
        yield* commands.resend(inputId);
        yield* TestClock.adjust(40);
        expect(chat.pending.of('thread-1')).toEqual([]);
        expect(commands.target.fold.entries).toHaveLength(0);
      }),
    );
    it.effect('a turn whose holder is gone is still resolved by the receipt its thread publishes', () =>
      Effect.gen(function* () {
        const chat = yield* makeChat();
        const held = yield* chat.open();
        chat.connection.emit(snapshotEvent({ activeRunId: 'run-1' }));
        yield* settle;
        const drafts = new TestDraftState();
        drafts.key = 'thread:thread-1';
        drafts.set(draft('ещё'));
        const commands = yield* chat.holder(held.session, { draft: drafts });
        chat.connection.stub('send', lost);
        yield* commands.send();
        yield* held.dispose();
        const feeds = chat.connection.feeds.length;
        yield* TestClock.adjust(20);
        const key = (
          chat.connection.called('send')[0]!.input as {
            key: string;
          }
        ).key;
        expect(chat.connection.feeds.length).toBeGreaterThan(feeds - 1);
        chat.connection.emit(
          snapshotEvent({
            activeRunId: 'run-1',
            receipts: [{ key, status: 'steered', runId: 'run-1', itemId: 'i-1', occurredAt: '2026-01-01T00:00:00.000Z' }],
          }),
          'thread-1',
        );
        yield* TestClock.adjust(20);
        expect(chat.pending.of('thread-1')).toEqual([]);
      }),
    );
    it.effect('resends are finite; the turn stays visible and unconfirmed, and the reader can send it again with the same key', () =>
      Effect.gen(function* () {
        {
          const { chat, commands, show } = yield* opened({ text: 'дошло ли' });
          chat.connection.stub('send', lost);
          yield* commands.send();
          yield* show({});
          yield* TestClock.adjust(200);
          const attempts = chat.connection.called('send').length;
          yield* TestClock.adjust(200);
          expect(chat.connection.called('send')).toHaveLength(attempts);
          expect(chat.pending.of('thread-1').map((turn) => turn.state)).toEqual(['unconfirmed']);
          chat.connection.answers('send', { status: 'queued', runId: 'run-1', acted: false, queued: queuedRow('дошло ли') });
          const inputId = chat.pending.of('thread-1')[0]!.inputId;
          yield* chat.pending.resend(inputId);
          yield* TestClock.adjust(40);
          const keys = new Set(
            chat.connection.called('send').map(
              (call) =>
                (
                  call.input as {
                    key: string;
                  }
                ).key,
            ),
          );
          expect(keys.size).toBe(1);
          expect(chat.pending.of('thread-1')).toEqual([]);
        }
      }),
    );
  });
  it.effect('a reply that lands after the holder moved on starts no run in the thread it moved to', () =>
    Effect.gen(function* () {
      const { chat, commands, show } = yield* opened({ text: 'первый' });
      yield* show({});
      const other = yield* chat.open('thread-2');
      const reached = chat.connection.hold('send');
      const sending = yield* Effect.forkChild(commands.send(), { startImmediately: true });
      yield* Effect.promise(() => reached);
      yield* commands.aim(other.session);
      chat.connection.release('send');
      yield* Fiber.join(sending);
      expect(other.session.activeRunId).toBeNull();
    }),
  );
  it.effect('a stop whose holder and session are both gone still takes its answer and brings the words back when the turn leaves', () =>
    Effect.gen(function* () {
      const chat = yield* makeChat();
      const held = yield* chat.open();
      chat.connection.emit(snapshotEvent({ activeRunId: 'run-1', transcript: [user('run-1', 'как дела')] }));
      yield* settle;
      const drafts = new TestDraftState();
      drafts.key = 'thread:thread-1';
      const holderScope = yield* Scope.fork(chat.scope);
      const commands = yield* chat.holder(held.session, { draft: drafts }, holderScope);
      chat.connection.answers('stop', { status: 'requested', runId: 'run-1' });
      const reached = chat.connection.hold('stop');
      yield* Effect.forkIn(commands.stop(), holderScope);
      yield* Effect.promise(() => reached);
      yield* Scope.close(holderScope, Exit.void);
      yield* held.dispose();
      chat.connection.release('stop');
      yield* settle;
      expect(chat.stops.phase('thread-1', 'run-1')).toBe('requested');
      chat.connection.emit(snapshotEvent({ withdrawn: 'run-1', withdrawnWords: 'как дела' }), 'thread-1');
      yield* settle;
      expect(drafts.current.text).toBe('как дела');
      expect(chat.stops.phase('thread-1', 'run-1')).toBeNull();
    }),
  );
  it.effect('a holder closed while its words are in flight changes nothing on screen, and the draft gets them back exactly once', () =>
    Effect.gen(function* () {
      const chat = yield* makeChat();
      const held = yield* chat.open();
      chat.connection.emit(snapshotEvent({ position: 2 }));
      yield* settle;
      const drafts = new TestDraftState();
      drafts.key = 'thread:thread-1';
      drafts.set(draft('отправь'));
      const holderScope = yield* Scope.fork(chat.scope);
      const commands = yield* chat.holder(held.session, { draft: drafts }, holderScope);
      chat.connection.refuses('send', 'нет');
      const reached = chat.connection.hold('send');
      yield* Effect.forkIn(commands.send(), holderScope);
      yield* Effect.promise(() => reached);
      yield* held.detach();
      yield* Scope.close(holderScope, Exit.void);
      const shownBefore = commands.notice;
      chat.connection.release('send');
      yield* settle;
      expect(drafts.current.text).toBe('отправь');
      expect(chat.pending.of('thread-1')).toEqual([]);
      expect(commands.notice).toBe(shownBefore);
      const { session } = yield* chat.open('thread-1', { detached: chat.detached.take('thread-1') });
      expect(session.fold.entries).toHaveLength(0);
    }),
  );
});
describe('a thread before it is born', () => {
  it.effect('its first words stand on screen before the thread exists, and the session that is born shows them', () =>
    Effect.gen(function* () {
      const chat = yield* makeChat();
      const opening = new ThreadOpening();
      let release!: () => void;
      const released = new Promise<void>((resolve) => (release = resolve));
      const drafts = new TestDraftState();
      drafts.set(draft('начни'));
      let born: TestSession | null = null;
      const commands = yield* chat.holder(opening, {
        draft: drafts,
        birth: {
          born: Effect.fnUntraced(function* (): Effect.fn.Return<ChatBorn> {
            yield* Effect.promise(() => released);
            born = yield* chat.open('thread-1');
            yield* commands.aim(born.session);
            return { threadId: 'thread-1', draftKey: 'thread:thread-1' };
          }),
          discard: () => Effect.void,
          settled: () => Effect.void,
        },
      });
      const sending = yield* Effect.forkChild(commands.send(), { startImmediately: true });
      expect(opening.fold.entries.map((entry) => (entry.kind === 'user' ? entry.text : entry.kind))).toEqual(['начни']);
      expect(opening.phase).toBe('opening');
      release();
      expect(yield* Fiber.join(sending)).toBe(true);
      expect(ids(commands.target.fold.entries)).toEqual(['message:user:run-1']);
      expect(born).not.toBeNull();
    }),
  );
  it.effect('a failure before sending deletes the thread this attempt bore, a refusal or a lost answer does not', () =>
    Effect.gen(function* () {
      for (const ending of ['uncomposed', 'refused', 'lost'] as const) {
        const chat = yield* makeChat();
        const discarded: string[] = [];
        const drafts = new TestDraftState();
        drafts.set(draft('начни'));
        if (ending === 'uncomposed') drafts.composeFails = { tone: 'error', message: 'the upload failed' };
        if (ending === 'refused') chat.connection.refuses('send', 'нет');
        if (ending === 'lost') chat.connection.stub('send', () => Effect.fail(new ChatCommandLost({ message: 'closed' })));
        const commands = yield* chat.holder(new ThreadOpening(), {
          draft: drafts,
          birth: { ...bornAs('thread-1'), discard: (threadId) => Effect.sync(() => void discarded.push(threadId)) },
        });
        expect(yield* commands.send()).toBe(false);
        expect(discarded).toEqual(ending === 'uncomposed' ? ['thread-1'] : []);
      }
    }),
  );
  it.effect('a birth that fails gives the words back and leaves no bubble', () =>
    Effect.gen(function* () {
      const chat = yield* makeChat();
      const opening = new ThreadOpening();
      const drafts = new TestDraftState();
      drafts.set(draft('начни'));
      const failed = { ...bornAs('thread-1'), born: () => Effect.fail(new ChatBirthFailed({ message: 'no room' })) };
      const commands = yield* chat.holder(opening, { draft: drafts, birth: failed });
      expect(yield* commands.send()).toBe(false);
      expect(drafts.current.text).toBe('начни');
      expect(opening.fold.entries).toHaveLength(0);
    }),
  );
  it.effect('a birth that stalls frees the press and says the opening is late', () =>
    Effect.gen(function* () {
      const chat = yield* makeChat();
      const opening = new ThreadOpening();
      const drafts = new TestDraftState();
      drafts.set(draft('начни'));
      const commands = yield* chat.holder(opening, {
        draft: drafts,
        birth: { ...bornAs('thread-1'), born: () => Effect.never },
        birthDeadlineMs: 5,
      });
      const pressed = yield* Effect.forkChild(commands.send(), { startImmediately: true });
      yield* TestClock.adjust(5);
      expect(yield* Fiber.join(pressed)).toBe(false);
      expect(commands.pending).toBe(false);
      expect(opening.phase).toBe('unreadable');
    }),
  );
  it.effect('a birth that outlives the deadline is settled once when it finishes, though the press gave up waiting', () =>
    Effect.gen(function* () {
      const chat = yield* makeChat();
      const drafts = new TestDraftState();
      drafts.set(draft('начни'));
      let release!: () => void;
      const released = new Promise<void>((resolve) => (release = resolve));
      let told = 0;
      const birth = {
        ...bornAs('thread-1'),
        born: () =>
          Effect.andThen(
            Effect.promise(() => released),
            bornAs('thread-1').born(),
          ),
        settled: () => Effect.sync(() => void (told += 1)),
      };
      const commands = yield* chat.holder(new ThreadOpening(), { draft: drafts, birth, birthDeadlineMs: 5 });
      const pressed = yield* Effect.forkChild(commands.send(), { startImmediately: true });
      yield* TestClock.adjust(5);
      expect(yield* Fiber.join(pressed)).toBe(false);
      expect(told).toBe(0);
      release();
      yield* Effect.andThen(
        settle,
        Effect.sync(() => expect(told).toBe(1)),
      );
      yield* settle;
      expect(told).toBe(1);
    }),
  );
});
describe('the prompts a chat takes are the ones it recalls', () => {
  it.effect('a turn the thread took leaves its words on record, a refused one does not', () =>
    Effect.gen(function* () {
      for (const refused of [false, true]) {
        const record = new Record();
        const { chat, commands } = yield* opened({ history: new PromptHistory(record) });
        if (refused) chat.connection.refuses('send', 'нет');
        yield* commands.sendDraft(draft('  дай задание  '));
        expect(record.texts).toEqual(refused ? [] : ['дай задание']);
      }
    }),
  );
  it.effect('words the run read and words waiting behind it are the reader’s just the same', () =>
    Effect.gen(function* () {
      const steered = new Record();
      const steering = yield* running('посмотри сюда', [], { history: new PromptHistory(steered) });
      steering.chat.connection.answers('send', { status: 'steered', runId: 'run-1', itemId: 'steer-1', acted: true });
      expect(yield* steering.commands.send()).toBe(true);
      expect(steered.texts).toEqual(['посмотри сюда']);
      const waiting = new Record();
      const queueing = yield* running('и потом это', [], { history: new PromptHistory(waiting) });
      queueing.chat.connection.answers('queue', { status: 'queued', runId: 'run-1', acted: true, queued: queuedRow('и потом это') });
      expect(yield* queueing.commands.queueDraft()).toBe(true);
      expect(waiting.texts).toEqual(['и потом это']);
    }),
  );
});
describe('a turn the server has not taken outlives the page that sent it', () => {
  it.effect('the next page delivers it once under its own key and forgets it when the server answers', () =>
    Effect.gen(function* () {
      const { chat, commands } = yield* opened({ text: 'проверь, работает ли' });
      const reached = chat.connection.hold('send');
      yield* Effect.forkChild(commands.send(), { startImmediately: true });
      yield* Effect.promise(() => reached);
      const key = (
        chat.connection.called('send')[0]!.input as {
          key: string;
        }
      ).key;
      const next = yield* makeChat(chat.shelf);
      yield* TestClock.adjust('1 second');
      expect(next.shelf.kept()).toEqual([]);
      expect(next.connection.called('send').map((call) => call.input)).toEqual([{ text: 'проверь, работает ли', key }]);
      expect(next.pending.of('thread-1')).toEqual([]);
    }),
  );
  it.effect('an answer the page never heard back on is delivered by the next page under its own key', () =>
    Effect.gen(function* () {
      const { chat, commands, show } = yield* opened();
      yield* show({ activeRunId: 'run-1', transcript: [openQuestionRecord()] });
      const reached = chat.connection.hold('answer');
      yield* Effect.forkChild(commands.answerQuestion('question-1', [{ questionId: 'prompt-1', values: ['answer-a'] }]), {
        startImmediately: true,
      });
      yield* Effect.promise(() => reached);
      const sent = chat.connection.called('answer')[0]!.input;
      const next = yield* makeChat(chat.shelf);
      yield* TestClock.adjust('1 second');
      expect(next.connection.called('answer').map((call) => call.input)).toEqual([sent]);
      expect(next.shelf.kept()).toEqual([]);
    }),
  );
  it.effect('words the page never handed to the server return to their draft', () =>
    Effect.gen(function* () {
      const unsent = new TestDraftState();
      unsent.compose = () => Effect.never;
      const { chat, commands } = yield* opened({ text: 'ещё не ушло', draft: unsent });
      yield* Effect.forkChild(commands.send(), { startImmediately: true });
      yield* settle;
      const next = yield* makeChat(chat.shelf);
      yield* Effect.andThen(
        settle,
        Effect.sync(() => expect(next.shelf.kept()).toEqual([])),
      );
      expect(next.shelf.handedBack.map((turn) => [turn.draftKey, turn.text])).toEqual([['thread:thread-1', 'ещё не ушло']]);
      expect(next.connection.called('send')).toEqual([]);
    }),
  );
  it.effect('a send the server does not answer ends the press without a second call, and its late answer settles the turn', () =>
    Effect.gen(function* () {
      const chat = yield* makeChat(new MemoryShelf(), { answerMs: 10 });
      const { session } = yield* chat.open();
      const drafts = new TestDraftState();
      drafts.key = 'thread:thread-1';
      drafts.set(draft('ответишь?'));
      const commands = yield* chat.holder(session, { draft: drafts });
      const reached = chat.connection.hold('send');
      const pressed = yield* Effect.forkChild(commands.send(), { startImmediately: true });
      yield* Effect.promise(() => reached);
      yield* TestClock.adjust(10);
      expect(yield* Fiber.join(pressed)).toBe(false);
      expect(chat.pending.of('thread-1').map((turn) => turn.state)).toEqual(['unconfirmed']);
      yield* TestClock.adjust(30);
      expect(chat.connection.called('send')).toHaveLength(1);
      chat.connection.release('send');
      yield* Effect.andThen(
        settle,
        Effect.sync(() => expect(chat.pending.of('thread-1')).toEqual([])),
      );
      expect(chat.shelf.kept()).toEqual([]);
    }),
  );
});
type Opened = {
  readonly text?: string;
  readonly attachments?: readonly string[];
} & HolderOptions;
const opened = Effect.fnUntraced(function* (options: Opened = {}) {
  const chat = yield* makeChat();
  const { session } = yield* chat.open();
  const drafts = options.draft ?? new TestDraftState();
  drafts.key = 'thread:thread-1';
  if (options.text !== undefined) drafts.set(draft(options.text, options.attachments ?? []));
  const commands = yield* chat.holder(session, { ...options, draft: drafts });
  const show = Effect.fnUntraced(function* (input: SnapshotInput) {
    chat.connection.emit(snapshotEvent(input));
    yield* settle;
  });
  return { chat, session, commands, draft: drafts, show };
});
const running = Effect.fnUntraced(function* (text: string, attachments: readonly string[] = [], options: HolderOptions = {}) {
  const held = yield* opened({ text, attachments, ...options });
  yield* held.show({ activeRunId: 'run-1' });
  return held;
});
function sentTexts(chat: TestChat, command: 'send' | 'queue'): string[] {
  return chat.connection.called(command).map(
    (call) =>
      (
        call.input as {
          text: string;
        }
      ).text,
  );
}
function user(
  runId: string,
  text: string,
): {
  id: string;
  type: 'message';
  role: 'user';
  runId: string;
  text: string;
} {
  return { id: `message:user:${runId}`, type: 'message', role: 'user', runId, text };
}
function ids(entries: readonly ChatEntry[]): string[] {
  return entries.map((entry) => entry.id);
}
function queuedRow(text: string) {
  return { id: 'queued-1', runId: 'run-1', text, occurredAt: '2026-01-01T00:00:00.000Z' };
}
function cutInput(words: string | null): SnapshotInput {
  return { transcript: [user('run-1', 'сделай')], latestRun: { id: 'run-1', status: 'cut', progress: { stage: 'cut', message: words } } };
}
const FAILURE = {
  provider: 'subscription',
  account: null,
  stage: 'AgentRunner.step',
  type: 'RateLimit',
  httpStatus: 429,
  retryable: true,
  modelStarted: false,
  rateLimit: { retryAfterMs: 2608000 },
  record: { threadId: 'thread-1', runId: 'run-1', entryId: 'transcript:error:run-1' },
};
function failedInput(): SnapshotInput {
  return {
    transcript: [
      user('run-1', 'сделай'),
      {
        type: 'run-end',
        id: 'run-end:run-1',
        runId: 'run-1',
        status: 'failed',
        startedAt: RUN_STARTED_AT,
        finishedAt: '2026-01-01T00:04:00.000Z',
        occurredAt: '2026-01-01T00:04:00.000Z',
      },
    ],
    latestRun: {
      id: 'run-1',
      status: 'failed',
      progress: { stage: 'failed', message: null },
      startedAt: RUN_STARTED_AT,
      finishedAt: '2026-01-01T00:04:00.000Z',
      failureReason: 'Automatic retry stopped: requested wait 2608000 ms exceeds the 60000 ms ceiling (6 model attempts).',
      failure: FAILURE as never,
      settledBy: null,
      provider: 'subscription',
      model: 'claude-opus-5',
      reasoning: 'xhigh',
    },
  };
}
function questionOf(entry: ChatEntry | undefined): Extract<ChatEntry, { kind: 'question' }> {
  if (entry?.kind !== 'question') throw new Error('expected a question entry');
  return entry;
}
function openQuestionEntry(): ChatEntry {
  return {
    id: 'entry-1',
    kind: 'question',
    questionId: 'question-1',
    runId: 'run-1',
    prompts: [{ id: 'prompt-1', toolCallId: 'prompt-1', kind: 'test.choice', prompt: 'pick' }],
    toolCalls: [{ toolCallId: 'prompt-1', toolName: 'choice' }],
  };
}
function openQuestionRecord() {
  return {
    type: 'question',
    id: 'entry-1',
    runId: 'run-1',
    questionId: 'question-1',
    questions: [{ id: 'prompt-1', toolCallId: 'prompt-1', kind: 'test.choice', prompt: 'pick' }],
    toolCalls: [{ toolCallId: 'prompt-1', toolName: 'choice' }],
    status: 'open',
  };
}
class Record implements PromptHistoryStore {
  private entries: readonly PromptHistoryEntry[] = [];
  read(): readonly PromptHistoryEntry[] {
    return this.entries;
  }
  write(entries: readonly PromptHistoryEntry[]): void {
    this.entries = entries;
  }
  get texts(): readonly string[] {
    return this.entries.map((entry) => entry.text);
  }
}
