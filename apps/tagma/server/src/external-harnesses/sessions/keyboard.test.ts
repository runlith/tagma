import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Duration, Effect, Fiber } from 'effect';
import { TestClock } from 'effect/testing';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { ScreenAsk, HarnessWidgetKey } from '@runlith/tagma/adapter/harness';
import { readHarnessFrame, sameWidget, typeHarnessKeys, typeHarnessWords, waitForWidget } from './keyboard.js';
import {
  cellScreen,
  keyboardRig,
  keyboardFrame,
  keyboardLane,
  unavailableScreen,
  WIDGET_ASK,
  WIDGET_GONE,
  widgetTarget,
  type CapturedInput,
} from '../testing/keyboard.js';

const EXECUTION = { execution: 'exec-1', incarnation: 0 };
const ESC = String.fromCharCode(0x1b);
const textOf = (inputs: readonly CapturedInput[]): readonly string[] => inputs.map((input) => Buffer.from(input.bytes).toString('binary'));

const codeOf = Effect.fnUntraced(function* (work: Effect.Effect<unknown, unknown>) {
  const result = yield* Effect.result(work);
  expect(result._tag).toBe('Failure');
  const failure = result._tag === 'Failure' ? result.failure : undefined;
  expect(failure).toBeInstanceOf(GateRefusal);
  return failure instanceof GateRefusal ? failure.code : '';
});

it.effect('widget strokes encode against the live cursor mode, on the session’s own lane', () =>
  Effect.gen(function* () {
    const face = keyboardRig({ frames: [keyboardFrame(WIDGET_GONE)] });
    const lane = yield* keyboardLane(face, 'session-1');
    const typed = yield* typeHarnessKeys(
      face.terminals,
      face.screens,
      face.writing,
      lane,
      EXECUTION,
      ['down', 'up', 'enter', 'esc'],
      'answer:q:3',
    );
    expect(typed).toMatchObject({ bytes: 8 });
    expect(face.opened).toEqual(['harness']);
    expect(textOf(face.inputs)).toEqual([`${ESC}[B`, `${ESC}[A`, '\r', ESC]);
    expect(face.inputs.map((input) => input.sequence)).toEqual([0, 1, 2, 3]);
    expect(face.inputs.map((input) => input.cause)).toEqual(['typed', 'typed', 'typed', 'typed']);
    expect(face.inputs.map((input) => input.profile)).toEqual([3, 3, 3, 3]);
  }),
);

it.effect('a second act counts on from the first, and a retry of one act re-presents its own sequences', () =>
  Effect.gen(function* () {
    const face = keyboardRig({ frames: [keyboardFrame(WIDGET_GONE)] });
    const lane = yield* keyboardLane(face, 'session-1');
    const answer: readonly HarnessWidgetKey[] = [{ _tag: 'char', char: '1' }, 'enter'];
    yield* typeHarnessKeys(face.terminals, face.screens, face.writing, lane, EXECUTION, answer, 'answer:q:1');
    yield* typeHarnessKeys(face.terminals, face.screens, face.writing, lane, EXECUTION, ['esc'], 'cancel:q:2');
    expect(face.inputs.map((input) => input.sequence)).toEqual([0, 1, 2]);
    expect(lane.spent('answer:q:1')).toBe(true);
    expect(lane.spent('answer:q:9')).toBe(false);
    yield* typeHarnessKeys(face.terminals, face.screens, face.writing, lane, EXECUTION, answer, 'answer:q:1');
    expect(face.inputs.map((input) => input.sequence)).toEqual([0, 1, 2, 0, 1]);
  }),
);

it.effect('a refused admission leaves the lane where it stood, and the retry lands at the same sequence', () =>
  Effect.gen(function* () {
    const face = keyboardRig({ frames: [keyboardFrame(WIDGET_GONE)], unsupported: 1 });
    const lane = yield* keyboardLane(face, 'session-1');
    expect(yield* codeOf(typeHarnessWords(face.terminals, face.screens, face.writing, lane, EXECUTION, 'hello'))).toBe('input-unsupported');
    expect(lane.frontier()).toBe(0);
    yield* typeHarnessWords(face.terminals, face.screens, face.writing, lane, EXECUTION, 'hello');
    expect(face.inputs.map((input) => input.sequence)).toEqual([0, 0, 1]);
  }),
);

it.effect('an unavailable interpreter and an unsupported input capability remain different refusals', () =>
  Effect.gen(function* () {
    for (const [tag, code] of [
      ['InterpretationUnavailable', 'interpretation-unavailable'],
      ['UnsupportedCapability', 'input-unsupported'],
    ] as const) {
      const face = keyboardRig({
        frames: [keyboardFrame(WIDGET_GONE)],
        unavailable: tag === 'InterpretationUnavailable' ? 1 : 0,
        unsupported: tag === 'UnsupportedCapability' ? 1 : 0,
      });
      const lane = yield* keyboardLane(face, 'session-1');
      expect(yield* codeOf(typeHarnessWords(face.terminals, face.screens, face.writing, lane, EXECUTION, 'hello'))).toBe(code);
      expect(face.accepted).toEqual([]);
    }
  }),
);

it.effect('a paste that changes the input profile is submitted once without repeating words', () =>
  Effect.gen(function* () {
    const face = keyboardRig({ frames: [keyboardFrame(WIDGET_GONE)], profiles: [3, 4] });
    const lane = yield* keyboardLane(face, 'session-1');
    const typed = yield* typeHarnessWords(face.terminals, face.screens, face.writing, lane, EXECUTION, 'hello');
    expect(typed.bytes).toBeGreaterThan(5);
    expect(textOf(face.inputs)).toEqual([`${ESC}[200~hello${ESC}[201~`, '\r']);
    expect(face.inputs.map((input) => input.profile)).toEqual([3, 4]);
  }),
);

it.effect('a profile conflict retries only the refused submit, while repeated conflicts leave delivery unconfirmed', () =>
  Effect.gen(function* () {
    for (const submitConflicts of [1, 3]) {
      const face = keyboardRig({ frames: [keyboardFrame(WIDGET_GONE)], submitConflicts });
      const lane = yield* keyboardLane(face, 'session-1');
      const typed = yield* typeHarnessWords(face.terminals, face.screens, face.writing, lane, EXECUTION, 'hello');
      expect(face.inputs.filter((input) => input.cause === 'paste').map((input) => Buffer.from(input.bytes).toString())).toEqual([
        `${ESC}[200~hello${ESC}[201~`,
      ]);
      if (submitConflicts === 1) expect(typed).toMatchObject({ bytes: 18 });
      else expect(typed).toMatchObject({ bytes: 17, failure: { code: 'input-profile-conflict' } });
    }
  }),
);

it.effect('a submit refused after a paste returns its partial delivery and never pastes again', () =>
  Effect.gen(function* () {
    const face = keyboardRig({ frames: [keyboardFrame(WIDGET_GONE)], firstLaneAdmits: 1 });
    const lane = yield* keyboardLane(face, 'session-1');
    const typed = yield* typeHarnessWords(face.terminals, face.screens, face.writing, lane, EXECUTION, 'hello');
    expect(typed).toMatchObject({ bytes: 17, failure: { _tag: 'ThreadCallBroke' } });
    expect(textOf(face.inputs)).toEqual([`${ESC}[200~hello${ESC}[201~`, '\r']);
    expect(lane.frontier()).toBe(1);
  }),
);

it.effect('a lost first admission reply retains uncertain delivery instead of inviting a duplicate', () =>
  Effect.gen(function* () {
    const face = keyboardRig({ frames: [keyboardFrame(WIDGET_GONE)], lostReplyAt: 1 });
    const lane = yield* keyboardLane(face, 'session-1');
    const result = yield* typeHarnessWords(face.terminals, face.screens, face.writing, lane, EXECUTION, 'hello');
    expect(result).toMatchObject({ bytes: 0, failure: { code: 'input-uncertain' } });
    expect(textOf(face.accepted)).toEqual([`${ESC}[200~hello${ESC}[201~`]);
    expect(lane.frontier()).toBe(1);
  }),
);

it.effect('rejected middle chunks and keys retry against fresh profiles without duplicating admitted input', () =>
  Effect.gen(function* () {
    const words = 'Я'.repeat(20_000);
    const face = keyboardRig({ frames: [keyboardFrame(WIDGET_GONE)], conflictAt: new Set([2]), profiles: [3, 3, 4] });
    const lane = yield* keyboardLane(face, 'session-1');
    const result = yield* typeHarnessWords(face.terminals, face.screens, face.writing, lane, EXECUTION, words);
    const admittedWords = face.accepted
      .filter((input) => input.cause === 'paste')
      .map((input) => Buffer.from(input.bytes).toString().replace(`${ESC}[200~`, '').replace(`${ESC}[201~`, ''))
      .join('');
    expect(admittedWords).toBe(words);
    expect(result.bytes).toBe(Buffer.byteLength(words) + 3 * 12 + 1);
    const keys = keyboardRig({
      frames: [keyboardFrame(WIDGET_GONE, false), keyboardFrame(WIDGET_GONE, true)],
      conflictAt: new Set([1]),
      profiles: [3, 4],
    });
    const keyed = yield* keyboardLane(keys, 'session-2');
    yield* typeHarnessKeys(keys.terminals, keys.screens, keys.writing, keyed, EXECUTION, ['down', 'enter'], 'choice');
    expect(textOf(keys.accepted)).toEqual([`${ESC}OB`, '\r']);
  }),
);

it.effect('keys refused before admission leave the act retryable at the current frontier', () =>
  Effect.gen(function* () {
    for (const unreadable of [true, false]) {
      const face = keyboardRig({
        frames: unreadable ? [unavailableScreen(), keyboardFrame(WIDGET_GONE)] : [keyboardFrame(WIDGET_GONE)],
        conflictAt: unreadable ? new Set() : new Set([1, 2, 3]),
      });
      const lane = yield* keyboardLane(face, 'session-1');
      const keys = typeHarnessKeys(face.terminals, face.screens, face.writing, lane, EXECUTION, ['down'], 'answer');
      expect(yield* codeOf(keys)).toBe(unreadable ? 'unreadable-input-profile' : 'input-profile-conflict');
      expect(lane.spent('answer')).toBe(false);
      yield* typeHarnessKeys(face.terminals, face.screens, face.writing, lane, EXECUTION, ['esc'], 'other');
      yield* keys;
      expect(textOf(face.accepted)).toEqual([ESC, `${ESC}[B`]);
      expect(face.accepted.map((input) => input.sequence)).toEqual([0, 1]);
      expect(lane.spent('answer')).toBe(true);
    }
  }),
);

it.effect('a second stroke refused after the first was taken leaves the act uncertain, never unwritten', () =>
  Effect.gen(function* () {
    const face = keyboardRig({ frames: [keyboardFrame(WIDGET_GONE)], conflictAt: new Set([2, 3, 4]) });
    const lane = yield* keyboardLane(face, 'session-1');
    expect(yield* codeOf(typeHarnessKeys(face.terminals, face.screens, face.writing, lane, EXECUTION, ['down', 'enter'], 'answer'))).toBe(
      'input-uncertain',
    );
    expect(textOf(face.accepted)).toEqual([`${ESC}[B`]);
    expect(lane.spent('answer')).toBe(true);
  }),
);

it.effect('a lost key receipt spends its act and sequence without colliding with the next operation', () =>
  Effect.gen(function* () {
    const face = keyboardRig({ frames: [keyboardFrame(WIDGET_GONE)], lostReplyAt: 1 });
    const lane = yield* keyboardLane(face, 'session-1');
    expect(yield* codeOf(typeHarnessKeys(face.terminals, face.screens, face.writing, lane, EXECUTION, ['down'], 'first'))).toBe(
      'input-uncertain',
    );
    expect(lane.spent('first')).toBe(true);
    yield* typeHarnessKeys(face.terminals, face.screens, face.writing, lane, EXECUTION, ['enter'], 'next');
    expect(textOf(face.accepted)).toEqual([`${ESC}[B`, '\r']);
    expect(face.accepted.map((input) => input.sequence)).toEqual([0, 1]);
  }),
);

it.effect('keys refuse without a readable profile and admit against a measured one', () =>
  Effect.gen(function* () {
    const blocked = keyboardRig({ frames: [unavailableScreen()] });
    const blockedLane = yield* keyboardLane(blocked, 'session-1');
    expect(
      yield* codeOf(typeHarnessKeys(blocked.terminals, blocked.screens, blocked.writing, blockedLane, EXECUTION, ['down'], 'answer:q:3')),
    ).toBe('unreadable-input-profile');
    expect(blocked.inputs).toEqual([]);
    const free = keyboardRig({ frames: [keyboardFrame(WIDGET_GONE)] });
    const freeLane = yield* keyboardLane(free, 'session-1');
    yield* typeHarnessKeys(
      free.terminals,
      free.screens,
      free.writing,
      freeLane,
      EXECUTION,
      [{ _tag: 'char', char: '1' }, { _tag: 'char', char: '2' }, 'enter', 'esc'],
      'answer:q:12',
    );
    expect(textOf(free.inputs)).toEqual(['1', '2', '\r', ESC]);
    expect(free.inputs.map((input) => input.sequence)).toEqual([0, 1, 2, 3]);
  }),
);

it.effect('arrow strokes follow application-cursor mode', () =>
  Effect.gen(function* () {
    const face = keyboardRig({ frames: [keyboardFrame(WIDGET_GONE, true)], profiles: [5] });
    const lane = yield* keyboardLane(face, 'session-1');
    yield* typeHarnessKeys(face.terminals, face.screens, face.writing, lane, EXECUTION, ['down', 'up'], 'answer:q:3');
    expect(textOf(face.inputs)).toEqual([`${ESC}OB`, `${ESC}OA`]);
    expect(face.inputs.map((input) => input.profile)).toEqual([5, 5]);
  }),
);

it.effect('sameWidget ignores the cursor and nothing else', () =>
  Effect.sync(() => {
    const question = widgetTarget();
    const live: ScreenAsk = {
      kind: 'choice',
      prompt: question.prompt,
      header: question.header,
      subject: question.subject,
      options: [...question.options],
      selected: '1',
    };
    expect(sameWidget(live, question)).toBe(true);
    expect(sameWidget({ ...live, selected: '3' }, question)).toBe(true);
    expect(sameWidget({ ...live, selected: null }, question)).toBe(true);
    expect(sameWidget({ ...live, prompt: 'other' }, question)).toBe(false);
    expect(sameWidget({ ...live, options: [...question.options, { value: '4', label: 'Extra' }] }, question)).toBe(false);
    expect(
      sameWidget(
        { ...live, options: question.options.map((option) => (option.value === '2' ? { ...option, label: 'Changed' } : option)) },
        question,
      ),
    ).toBe(false);
  }),
);

it.effect('readHarnessFrame answers the text frame, and refuses what a widget reader cannot read', () =>
  Effect.gen(function* () {
    const frame = keyboardFrame(WIDGET_ASK);
    const shown = keyboardRig({ frames: [frame] });
    expect(yield* readHarnessFrame(shown.terminals, shown.screens, EXECUTION)).toBe(frame);
    const gone = keyboardRig({ frames: [], record: null });
    expect(yield* codeOf(readHarnessFrame(gone.terminals, gone.screens, EXECUTION))).toBe('execution-gone');
    const unavailable = keyboardRig({ frames: [unavailableScreen()] });
    expect(yield* codeOf(readHarnessFrame(unavailable.terminals, unavailable.screens, EXECUTION))).toBe('screen-unavailable');
    const celled = keyboardRig({ frames: [cellScreen(WIDGET_ASK)] });
    expect(yield* codeOf(readHarnessFrame(celled.terminals, celled.screens, EXECUTION))).toBe('screen-unreadable');
  }),
);

it.effect('a widget gone on the first read is taken without waiting', () =>
  Effect.gen(function* () {
    const face = keyboardRig({ frames: [keyboardFrame(WIDGET_GONE)] });
    expect(yield* waitForWidget(face.terminals, face.screens, EXECUTION, 'devin', widgetTarget())).toBe('gone');
  }),
);

it.effect('a widget that leaves between beats is taken', () =>
  Effect.gen(function* () {
    const face = keyboardRig({ frames: [keyboardFrame(WIDGET_ASK), keyboardFrame(WIDGET_GONE)] });
    const fiber = yield* Effect.forkChild(waitForWidget(face.terminals, face.screens, EXECUTION, 'devin', widgetTarget()));
    yield* Effect.yieldNow;
    yield* TestClock.adjust(Duration.seconds(20));
    expect(yield* Fiber.join(fiber)).toBe('gone');
  }),
);

it.effect('a widget still standing at the takeover bound is not taken', () =>
  Effect.gen(function* () {
    const face = keyboardRig({ frames: [keyboardFrame(WIDGET_ASK)] });
    const fiber = yield* Effect.forkChild(waitForWidget(face.terminals, face.screens, EXECUTION, 'devin', widgetTarget()));
    yield* Effect.yieldNow;
    yield* TestClock.adjust(Duration.seconds(20));
    expect(yield* Fiber.join(fiber)).toBe('standing');
  }),
);
