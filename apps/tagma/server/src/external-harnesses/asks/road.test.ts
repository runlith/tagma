import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Fiber } from 'effect';
import { Principal } from '@runlith/executions/protocol/custody';
import type { TerminalScreens } from '../../executions/contract/service/records.js';
import type { ThreadRunRef } from '@runlith/agent/thread/run/ThreadRunLedger';
import type { ThreadInteractionAnswer, ThreadQuestionEntry } from '@runlith/agent/transcript/entries';
import type { ScreenAsk } from '@runlith/tagma/adapter/harness';
import type { HarnessSessionStore } from '../store/sessions.js';
import { HarnessLanes } from '../sessions/lanes.js';
import { keyboardFrame, keyboardRig, KEYBOARD_EXECUTION, WIDGET_ASK, WIDGET_GONE } from '../testing/keyboard.js';
import { terminalFaces } from './faces.js';
import { builtinHarness, shippedHarnessAdapters } from '../testing/builtin.js';
import { TerminalAsks, type AskLedger } from './terminal.js';

const RUN: ThreadRunRef = { id: 'run-1', threadId: 't' };
const CALL = { id: 'toolu_fetch', tool: 'bash', subject: 'https://wttr.in/x' };
const ESC = String.fromCharCode(0x1b);

const road = Effect.fnUntraced(function* (options: { readonly lostReplyAt?: number } = {}) {
  const face = keyboardRig({ frames: [keyboardFrame(WIDGET_GONE)], ...options });
  const lanes = new HarnessLanes(face.grants, face.writing);
  yield* lanes.open('s1', 7, KEYBOARD_EXECUTION, Principal.make('operator'));
  const shown = { ask: false };
  const screens = {
    screen: () => Effect.succeed(keyboardFrame(shown.ask && face.accepted.length === 0 ? WIDGET_ASK : WIDGET_GONE)),
  } as unknown as TerminalScreens['Service'];
  const sessions = {
    read: () =>
      Effect.succeed({
        name: 'devin',
        presentation: { install: null },
        session: { id: 's1', state: 'running' },
        execution: { execution: 'exec-1', incarnation: 0 },
      }),
    wait: () => Effect.never,
  } as unknown as HarnessSessionStore;
  const faces = terminalFaces(sessions, face.terminals, screens, face.writing, lanes, yield* shippedHarnessAdapters);
  const entries: ThreadQuestionEntry[] = [];
  const update = (questionId: string, change: Partial<ThreadQuestionEntry>) => {
    const at = entries.findIndex((entry) => entry.questionId === questionId);
    if (at >= 0) entries[at] = { ...entries[at]!, ...change };
  };
  const ledger: AskLedger = {
    current: () => Effect.succeed(RUN),
    asked: (_run, entry) => Effect.sync(() => entries.push(entry) > 0),
    get: (_run, questionId) => Effect.succeed(entries.find((entry) => entry.questionId === questionId) ?? null),
    resolved: (_run, questionId, _evidence, closing) =>
      Effect.sync(() => update(questionId, { status: closing === 'answered' ? 'answered' : 'cleared' })),
    open: () => Effect.succeed(entries.filter((entry) => entry.status === 'open')),
    routed: () => Effect.void,
  };
  const asks: TerminalAsks = new TerminalAsks(
    {
      verdict: () => Effect.succeed({ _tag: 'Asks', ruleId: 'mode:review', reason: null, asked: ['review'] }),
      prompt: (_name, call) => `Devin asks to run \`${call.subject}\``,
    },
    () => Effect.succeed(builtinHarness('devin')),
    ledger,
    faces,
    (threadId, questionId, answers: readonly ThreadInteractionAnswer[]) =>
      Effect.suspend(() => {
        update(questionId, { answers });
        return Effect.flatMap(
          asks.answer(
            threadId,
            entries.find((entry) => entry.questionId === questionId)!,
            answers,
          ),
          (delivery) =>
            Effect.sync(() => {
              if (delivery === 'delivered') update(questionId, { status: 'answered' });
              if (delivery === 'unknown') update(questionId, { deliveryUnknown: true });
            }),
        );
      }),
  );
  const asked = Effect.fnUntraced(function* () {
    const decision = yield* asks.judge('t', CALL, true);
    const requestId = decision._tag === 'Asked' ? decision.requestId : '';
    const waiting = yield* Effect.forkChild(asks.outcome('t', requestId, 10_000));
    yield* Effect.yieldNow;
    yield* Fiber.interrupt(waiting);
    return requestId;
  });
  let seen: ScreenAsk | null = null;
  const sits = Effect.fnUntraced(function* () {
    shown.ask = true;
    seen ??= yield* faces.widget('t');
    if (seen === null) return yield* Effect.die('the fixture screen shows no widget');
    yield* asks.widgetSeen('t', seen);
  });
  const reply = (questionId: string, value: string): readonly ThreadInteractionAnswer[] => [{ questionId, values: [value] }];
  const give = (questionId: string, value: string) =>
    Effect.suspend(() => {
      const answers = reply(questionId, value);
      update(questionId, { answers });
      return Effect.flatMap(
        asks.answer(
          't',
          entries.find((entry) => entry.questionId === questionId)!,
          answers,
        ),
        (delivery) =>
          Effect.sync(() => {
            if (delivery === 'delivered') update(questionId, { status: 'answered' });
            if (delivery === 'unknown') update(questionId, { deliveryUnknown: true });
            return delivery;
          }),
      );
    });
  const text = () => face.inputs.map((input) => Buffer.from(input.bytes).toString('binary'));
  return { asks, entries, face, asked, sits, give, text };
});

it.effect(
  'an allow given after the hook was lost is kept, then typed once into the widget of its call and delivered when the widget leaves',
  () =>
    Effect.gen(function* () {
      const { entries, asked, sits, give, text } = yield* road();
      const questionId = yield* asked();
      expect(yield* give(questionId, 'allow-once')).toBe('gone');
      expect(text()).toEqual([]);
      yield* sits();
      expect(text()).toEqual(['\r']);
      expect(entries[0]!.status).toBe('answered');
      yield* sits();
      expect(text()).toEqual(['\r']);
    }),
);

it.effect('a deny given after the hook was lost cancels the widget of its call', () =>
  Effect.gen(function* () {
    const { entries, asked, sits, give, text } = yield* road();
    const questionId = yield* asked();
    yield* give(questionId, 'deny');
    yield* sits();
    expect(text()).toEqual([ESC]);
    expect(entries[0]!.status).toBe('answered');
  }),
);

it.effect('a print whose receipt is lost marks the question unknown and the widget is never typed into again', () =>
  Effect.gen(function* () {
    const { entries, asked, sits, give, text } = yield* road({ lostReplyAt: 1 });
    const questionId = yield* asked();
    yield* give(questionId, 'allow-once');
    yield* sits();
    expect(entries[0]!).toMatchObject({ status: 'open', deliveryUnknown: true });
    const typed = text().length;
    yield* sits();
    expect(text()).toHaveLength(typed);
  }),
);

it.effect('a widget about another call is a second question and receives no keys', () =>
  Effect.gen(function* () {
    const { asks, entries, asked, give, text, face } = yield* road();
    const questionId = yield* asked();
    yield* give(questionId, 'allow-once');
    const other = { ...CALL, id: 'toolu_other', subject: 'https://elsewhere.example/y' };
    const widget = {
      kind: 'choice' as const,
      prompt: `Fetching ${other.subject}`,
      header: null,
      subject: other.subject,
      options: [{ value: '1', label: 'Yes' }],
      selected: '1',
    };
    yield* asks.widgetSeen('t', widget);
    expect(entries.map((entry) => entry.questionId)).toEqual([questionId, expect.stringMatching(/^harness-screen:/)]);
    expect(text()).toEqual([]);
    expect(face.inputs).toHaveLength(0);
  }),
);
