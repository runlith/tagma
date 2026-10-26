import { describe, expect, test } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Clock, Duration, Effect, Fiber } from 'effect';
import { TestClock } from 'effect/testing';
import type { ThreadRunRef } from '@runlith/agent/thread/run/ThreadRunLedger';
import type { ThreadInteractionAnswer, ThreadQuestionEntry } from '@runlith/agent/transcript/entries';
import type { HarnessWidgetKey, ScreenAsk } from '../contract/service/adapter.js';
import type { HarnessCall } from '../contract/wire/call.js';
import { threadCallFailed } from '../../threads/contract/service/failure.js';
import { widgetAsksAbout } from './routes.js';
import { askEntry, TerminalAsks, type AskFaces, type AskLedger, type Typed } from './terminal.js';

const RUN: ThreadRunRef = { id: 'run-1', threadId: 'thread-1' };
const CALL: HarnessCall = { id: 'toolu_A', tool: 'bash', subject: 'git push origin main' };
const SAME_TEXT: HarnessCall = { id: 'toolu_B', tool: 'bash', subject: 'git push origin main' };

const widgetFor = (subject: string): ScreenAsk => ({
  kind: 'choice',
  prompt: `Claude wants to run ${subject}`,
  header: null,
  subject,
  options: [
    { value: '1', label: 'Yes' },
    { value: '2', label: 'No' },
  ],
  selected: '1',
});

const rig = () => {
  const entries: ThreadQuestionEntry[] = [];
  const resolved: [string, string | undefined][] = [];
  const typed: (readonly HarnessWidgetKey[])[] = [];
  const state: { widget: ScreenAsk | null; typing: Typed; left: 'gone' | 'standing' | 'unreadable'; owned: boolean; unreadable: boolean } =
    {
      widget: null,
      typing: 'admitted',
      left: 'gone',
      owned: true,
      unreadable: false,
    };
  const update = (questionId: string, change: Partial<ThreadQuestionEntry>) => {
    const index = entries.findIndex((entry) => entry.questionId === questionId);
    if (index >= 0) entries[index] = { ...entries[index]!, ...change };
  };
  const ledger: AskLedger = {
    current: (threadId) => Effect.succeed(threadId === RUN.threadId ? RUN : { id: `run-${threadId}`, threadId }),
    asked: (_run, entry) =>
      Effect.sync(() => {
        if (!state.owned) return false;
        if (!entries.some((each) => each.questionId === entry.questionId && each.runId === entry.runId)) entries.push(entry);
        return true;
      }),
    get: (run, questionId) => Effect.succeed(entries.find((entry) => entry.questionId === questionId && entry.runId === run.id) ?? null),
    resolved: (_run, questionId, _evidence, closing) =>
      Effect.sync(() => {
        resolved.push([questionId, closing]);
        update(questionId, { status: closing === 'answered' ? 'answered' : 'cleared' });
      }),
    open: (_thread, run) => Effect.succeed(entries.filter((entry) => entry.status === 'open' && entry.runId === run.id)),
    routed: () => Effect.void,
  };
  const faces: AskFaces = {
    widget: () => (state.unreadable ? Effect.fail(threadCallFailed(new Error('screen unreadable'))) : Effect.succeed(state.widget)),
    keys: (_thread, _widget, values) => Effect.succeed(values.map((char) => ({ _tag: 'char', char }) as const)),
    type: (_thread, keys) =>
      Effect.sync(() => {
        typed.push(keys);
        return state.typing;
      }),
    left: () => Effect.succeed(state.left),
  };
  const asks: TerminalAsks = new TerminalAsks(
    {
      verdict: () => Effect.succeed({ _tag: 'Asks', ruleId: 'mode:review', reason: null, asked: ['review'] }),
      prompt: (_name, call) => `Claude asks to run \`${call.subject}\``,
    },
    () => Effect.succeed('claude-code' as const),
    ledger,
    faces,
    (threadId, questionId, answers: readonly ThreadInteractionAnswer[]) =>
      Effect.suspend(() => {
        update(questionId, { answers });
        const entry = entries.find((each) => each.questionId === questionId)!;
        return Effect.flatMap(asks.answer(threadId, entry, answers), (delivery) =>
          Effect.sync(() => {
            if (delivery === 'delivered') update(questionId, { status: 'answered' });
            if (delivery === 'unknown') update(questionId, { deliveryUnknown: true });
          }),
        );
      }),
  );
  return { asks, entries, resolved, typed, state, update };
};

const lost = Effect.fnUntraced(function* (asks: TerminalAsks, questionId: string) {
  const waiting = yield* Effect.forkChild(asks.outcome('thread-1', questionId, 10_000));
  yield* Effect.yieldNow;
  yield* Fiber.interrupt(waiting);
});

const reply = (questionId: string, value: string): readonly ThreadInteractionAnswer[] => [{ questionId, values: [value] }];

const asked = (asks: TerminalAsks, call: HarnessCall) =>
  Effect.map(asks.judge('thread-1', call, true), (decision) => (decision._tag === 'Asked' ? decision.requestId : ''));

describe('a terminal permission question', () => {
  it.effect('a live hook takes the answer once and the question is delivered without keys', () =>
    Effect.gen(function* () {
      const { asks, entries, typed } = rig();
      const questionId = yield* asked(asks, CALL);
      const waiting = yield* Effect.forkChild(asks.outcome('thread-1', questionId, 5_000));
      yield* Effect.yieldNow;
      expect(yield* asks.answer('thread-1', entries[0]!, reply(questionId, 'allow-once'))).toBe('delivered');
      expect(yield* Fiber.join(waiting)).toMatchObject({ _tag: 'Allowed' });
      expect(typed).toEqual([]);
    }),
  );

  it.effect('a hook still waiting after fifteen seconds takes the answer', () =>
    Effect.gen(function* () {
      const { asks, entries } = rig();
      const questionId = yield* asked(asks, CALL);
      const first = yield* Effect.forkChild(asks.outcome('thread-1', questionId, 10_000));
      yield* TestClock.adjust(Duration.seconds(10));
      expect(yield* Fiber.join(first)).toEqual({ _tag: 'Waiting' });
      const second = yield* Effect.forkChild(asks.outcome('thread-1', questionId, 10_000));
      yield* TestClock.adjust(Duration.seconds(6));
      const delivery = yield* Effect.forkChild(asks.answer('thread-1', entries[0]!, reply(questionId, 'deny')));
      yield* TestClock.adjust(Duration.millis(1));
      expect(yield* Fiber.join(second)).toMatchObject({ _tag: 'Denied' });
      expect(yield* Fiber.join(delivery)).toBe('delivered');
    }),
  );

  it.effect('the same permission request again is the same question', () =>
    Effect.gen(function* () {
      const { asks, entries } = rig();
      const first = yield* asked(asks, CALL);
      const again = yield* asked(asks, CALL);
      expect(again).toBe(first);
      expect(entries).toHaveLength(1);
      expect(yield* asked(asks, SAME_TEXT)).not.toBe(first);
      expect(entries).toHaveLength(2);
    }),
  );

  it.effect('a hook that was lost leaves the answer for the widget of the same call, typed once', () =>
    Effect.gen(function* () {
      const { asks, entries, state, typed } = rig();
      const questionId = yield* asked(asks, CALL);
      yield* lost(asks, questionId);
      expect(yield* asks.answer('thread-1', entries[0]!, reply(questionId, 'deny'))).toBe('gone');
      expect(typed).toEqual([]);

      state.widget = widgetFor('rm -rf build');
      yield* asks.widgetSeen('thread-1', state.widget);
      expect(entries.filter((entry) => entry.questionId.startsWith('harness-screen:'))).toHaveLength(1);
      expect(typed).toEqual([]);

      state.widget = widgetFor(CALL.subject);
      entries[0] = { ...entries[0]!, answers: reply(questionId, 'allow-once') };
      yield* asks.widgetSeen('thread-1', state.widget);
      expect(typed).toEqual([[{ _tag: 'char', char: 'allow-once' }]]);
      expect(entries[0]!.status).toBe('answered');
    }),
  );

  it.effect('two open calls the widget could be about receive no keys', () =>
    Effect.gen(function* () {
      const { asks, entries, state, typed } = rig();
      const first = yield* asked(asks, CALL);
      yield* asked(asks, SAME_TEXT);
      yield* lost(asks, first);
      state.widget = widgetFor(CALL.subject);
      expect(yield* asks.answer('thread-1', entries[0]!, reply(first, 'deny'))).toBe('gone');
      expect(typed).toEqual([]);
    }),
  );

  it.effect('a print whose receipt is unknown stays on the question and is never typed again', () =>
    Effect.gen(function* () {
      const { asks, entries, state, typed } = rig();
      const questionId = yield* asked(asks, CALL);
      state.widget = widgetFor(CALL.subject);
      state.typing = 'unknown';
      yield* asks.widgetSeen('thread-1', state.widget);
      expect(yield* asks.answer('thread-1', entries[0]!, reply(questionId, 'allow-once'))).toBe('unknown');
      entries[0] = { ...entries[0]!, deliveryUnknown: true, answers: reply(questionId, 'allow-once') };
      yield* asks.widgetSeen('thread-1', state.widget);
      expect(yield* asks.answer('thread-1', entries[0]!, reply(questionId, 'allow-once'))).toBe('unknown');
      expect(typed).toHaveLength(1);
    }),
  );

  it.effect('the result of the same call resolves its question and the result of a parallel call does not', () =>
    Effect.gen(function* () {
      const { asks, resolved } = rig();
      const questionId = yield* asked(asks, CALL);
      yield* asks.callEnded('thread-1', SAME_TEXT.id!);
      expect(resolved).toEqual([]);
      yield* asks.callEnded('thread-1', CALL.id!);
      expect(resolved).toEqual([[questionId, 'cleared']]);
    }),
  );

  it.effect('a widget that vanishes without our keys resolves its question, and one that vanishes after them does not', () =>
    Effect.gen(function* () {
      const { asks, entries, state, resolved, update } = rig();
      state.widget = widgetFor('npm test');
      yield* asks.widgetSeen('thread-1', state.widget);
      const screenId = entries[0]!.questionId;
      yield* asks.widgetGone('thread-1');
      expect(resolved).toEqual([[screenId, 'cleared']]);

      state.widget = widgetFor('npm run build');
      yield* asks.widgetSeen('thread-1', state.widget);
      const typedId = entries[1]!.questionId;
      expect(yield* asks.answer('thread-1', entries[1]!, reply(typedId, '1'))).toBe('delivered');
      update(typedId, { status: 'answered' });
      yield* asks.widgetGone('thread-1');
      expect(resolved).toHaveLength(1);
    }),
  );

  test('a widget is matched to a call by the whole of its subject text', () => {
    expect(widgetAsksAbout(widgetFor(CALL.subject), CALL)).toBe(true);
    expect(widgetAsksAbout(widgetFor('git status'), CALL)).toBe(false);
    const long = { ...CALL, subject: `echo ${'x'.repeat(200)}` };
    expect(widgetAsksAbout(widgetFor(`${long.subject.slice(0, 150)}`), long)).toBe(false);
  });

  test('a longer command that begins with the subject, or one that differs inside quotes, is another invocation', () => {
    expect(widgetAsksAbout(widgetFor(`${CALL.subject} --force`), CALL)).toBe(false);
    const quoted = { ...CALL, subject: 'echo "a  b"' };
    expect(widgetAsksAbout(widgetFor('echo "a b"'), quoted)).toBe(false);
    expect(widgetAsksAbout(widgetFor(`echo ${CALL.subject}`), CALL)).toBe(false);
    expect(widgetAsksAbout({ ...widgetFor(CALL.subject), subject: null }, CALL)).toBe(false);
    expect(widgetAsksAbout(widgetFor('echo "a  b"'), quoted)).toBe(true);
  });

  it.effect('equal vendor call ids in two threads each deliver to their own hook', () =>
    Effect.gen(function* () {
      const { asks, entries } = rig();
      const first = yield* asked(asks, CALL);
      const other = yield* Effect.map(asks.judge('thread-2', CALL, true), (decision) =>
        decision._tag === 'Asked' ? decision.requestId : '',
      );
      expect(other).toBe(first);
      expect(entries).toHaveLength(2);
      const one = yield* Effect.forkChild(asks.outcome('thread-1', first, 5_000));
      const two = yield* Effect.forkChild(asks.outcome('thread-2', first, 5_000));
      yield* Effect.yieldNow;
      expect(yield* asks.answer('thread-2', entries[1]!, reply(first, 'deny'))).toBe('delivered');
      expect(yield* asks.answer('thread-1', entries[0]!, reply(first, 'allow-once'))).toBe('delivered');
      expect(yield* Fiber.join(one)).toMatchObject({ _tag: 'Allowed' });
      expect(yield* Fiber.join(two)).toMatchObject({ _tag: 'Denied' });
      entries[0] = { ...entries[0]!, status: 'answered' };
      expect(yield* asks.outcome('thread-1', first, 5_000)).toEqual({ _tag: 'Unanswered' });
    }),
  );

  it.effect('a stored answer that was never delivered reaches the hook that reattaches, and an unknown one is never sent again', () =>
    Effect.gen(function* () {
      const { asks, entries } = rig();
      const now = new Date(yield* Clock.currentTimeMillis).toISOString();
      const stored = {
        ...askEntry('run-thread-4', 'harness-permission:kept', 'Allow it?', null, [], { ruleId: 'mode:review' }, now),
        answers: reply('harness-permission:kept', 'deny'),
      };
      const unknown = {
        ...askEntry('run-thread-4', 'harness-permission:sent', 'Allow it?', null, [], { ruleId: 'mode:review' }, now),
        answers: reply('harness-permission:sent', 'allow-once'),
        deliveryUnknown: true,
      };
      entries.push(stored, unknown);
      expect(yield* asks.outcome('thread-4', stored.questionId, 5_000)).toMatchObject({ _tag: 'Denied' });
      expect(entries[0]!.status).toBe('answered');
      expect(yield* asks.outcome('thread-4', unknown.questionId, 5_000)).toEqual({ _tag: 'Unanswered' });
      expect(entries[1]!.status).toBe('open');
    }),
  );

  it.effect('a question the core did not take is not announced as asked', () =>
    Effect.gen(function* () {
      const { asks, state } = rig();
      state.owned = false;
      expect(yield* asks.judge('thread-1', CALL, true)).toEqual({ _tag: 'Unspoken' });
      state.widget = widgetFor('npm test');
      expect(yield* asks.widgetSeen('thread-1', state.widget)).toBe(false);
    }),
  );

  it.effect('a screen that cannot be read before any key leaves the answer retryable, then delivered', () =>
    Effect.gen(function* () {
      const { asks, entries, state, typed } = rig();
      state.widget = widgetFor('npm test');
      yield* asks.widgetSeen('thread-1', state.widget);
      const questionId = entries[0]!.questionId;
      state.unreadable = true;
      expect(yield* asks.answer('thread-1', entries[0]!, reply(questionId, '1'))).toBe('unwritten');
      expect(typed).toEqual([]);
      state.unreadable = false;
      expect(yield* asks.answer('thread-1', entries[0]!, reply(questionId, '1'))).toBe('delivered');
      expect(typed).toHaveLength(1);
    }),
  );

  it.effect('a hook still polling a question the server holds without a route reattaches to it under the same request id', () =>
    Effect.gen(function* () {
      const { asks, entries } = rig();
      const now = new Date(yield* Clock.currentTimeMillis).toISOString();
      const migrated = askEntry('run-thread-3', 'harness-permission:old', 'Allow it?', null, [], { ruleId: 'mode:review' }, now);
      entries.push(migrated);
      const polling = yield* Effect.forkChild(asks.outcome('thread-3', migrated.questionId, 5_000));
      yield* Effect.yieldNow;
      expect(yield* asks.answer('thread-3', migrated, reply(migrated.questionId, 'deny'))).toBe('delivered');
      expect(yield* Fiber.join(polling)).toMatchObject({ _tag: 'Denied' });
    }),
  );

  it.effect('a widget replaced by another without a blank frame closes only the first question', () =>
    Effect.gen(function* () {
      const { asks, entries, state } = rig();
      state.widget = widgetFor('npm test');
      yield* asks.widgetSeen('thread-1', state.widget);
      state.widget = widgetFor('npm run build');
      yield* asks.widgetGone('thread-1', state.widget);
      yield* asks.widgetSeen('thread-1', state.widget);
      expect(entries.map((entry) => entry.status)).toEqual(['cleared', 'open']);
    }),
  );

  it.effect('a CLI question taking typed words and several picks stands as one that takes them, and several values are answered', () =>
    Effect.gen(function* () {
      const { asks, entries, state, typed } = rig();
      state.widget = { ...widgetFor('npm test'), subject: null, freeform: { value: '3', draft: '' }, picks: { checked: [] } };
      yield* asks.widgetSeen('thread-1', state.widget);
      expect(entries[0]!.questions[0]).toMatchObject({ allowFreeform: true, allowMultiple: true });
      const questionId = entries[0]!.questionId;
      expect(yield* asks.answer('thread-1', entries[0]!, [{ questionId, values: ['1', 'in my own words'] }])).toBe('delivered');
      expect(typed).toHaveLength(1);
    }),
  );

  it.effect('a single choice refuses several values before any key', () =>
    Effect.gen(function* () {
      const { asks, entries, state, typed } = rig();
      state.widget = widgetFor('npm test');
      yield* asks.widgetSeen('thread-1', state.widget);
      const questionId = entries[0]!.questionId;
      const refused = yield* Effect.flip(asks.answer('thread-1', entries[0]!, [{ questionId, values: ['1', '2'] }]));
      expect(refused).toMatchObject({ code: 'answer-invalid' });
      expect(typed).toEqual([]);
    }),
  );

  it.effect('an answer in flight is not resolved by the vanishing of its widget', () =>
    Effect.gen(function* () {
      const { asks, entries, state, update } = rig();
      state.widget = widgetFor('npm test');
      yield* asks.widgetSeen('thread-1', state.widget);
      update(entries[0]!.questionId, { deliveryUnknown: true, answers: reply(entries[0]!.questionId, '1') });
      expect(yield* asks.widgetGone('thread-1')).toBe(false);
      expect(entries[0]!.status).toBe('open');
      expect(entries[0]!.answers).toBeDefined();
      update(entries[0]!.questionId, { deliveryUnknown: undefined, answers: undefined });
      expect(yield* asks.widgetGone('thread-1')).toBe(true);
      expect(entries[0]!.status).toBe('cleared');
    }),
  );

  it.effect('an answer to a screen question the CLI no longer shows clears it and types nothing', () =>
    Effect.gen(function* () {
      const { asks, entries, state, typed, resolved } = rig();
      state.widget = widgetFor('npm test');
      yield* asks.widgetSeen('thread-1', state.widget);
      const questionId = entries[0]!.questionId;
      state.widget = widgetFor('npm run build');
      expect(yield* asks.answer('thread-1', entries[0]!, reply(questionId, '1'))).toBe('gone');
      expect(resolved).toEqual([[questionId, 'cleared']]);
      expect(typed).toEqual([]);
    }),
  );
});
