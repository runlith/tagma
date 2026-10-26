import { Clock, Effect } from 'effect';
import { threadCallFailed } from '../../threads/contract/service/failure.js';
import type { ExecutionRef } from '@runlith/executions/protocol/execution';
import type { InputAnswer } from '@runlith/executions/protocol/input';
import type { ScreenTextFrame } from '@runlith/executions/protocol/presentation';
import { screenLines } from '@runlith/executions/protocol/presentationText';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { ScreenAsk, HarnessWidgetKey } from '../contract/service/adapter.js';
import type { HarnessName } from '../../threads/contract/wire/harness/names.js';
import { sameScreenAsk } from '../adapter/screenAsk.js';
import type { HarnessExecutionRef } from '../../threads/contract/wire/harness/observation.js';
import { harnessAdapter } from '../contract/service/table.js';
import { TERMINAL_PERMISSION_REVISION } from '../../executions/contract/service/subjectPolicy.js';
import type { TerminalFailure, Terminals } from '../../executions/contract/service/terminals.js';
import type { TerminalScreens } from '../../executions/contract/service/records.js';
import type { TerminalWriting } from '../../executions/contract/service/writing.js';
import type { HarnessLane } from './lanes.js';
import type { HarnessFailure } from '../../threads/contract/service/failure.js';
import { LEASE_RHYTHM } from '../../threads/contract/wire/rhythm.js';

const ESC = String.fromCharCode(0x1b);
const INERT_ESCAPE = '␛';
const BRACKETED_PASTE_START = `${ESC}[200~`;
const BRACKETED_PASTE_END = `${ESC}[201~`;
const SUBMIT = '\r';
const ADMISSION_BYTES = 16 * 1024;

export type HarnessTyped = {
  readonly bytes: number;
  readonly failure?: HarnessFailure;
};

export type HarnessKeyed = {
  readonly bytes: number;
};

export const widgetOn = (name: HarnessName, frame: ScreenTextFrame): ScreenAsk | null =>
  harnessAdapter(name).screenAskOf(screenLines(frame));

export const sameWidget = (live: ScreenAsk, target: ScreenAsk): boolean => sameScreenAsk(target, live);

export const keysOperation = (act: 'answer' | 'cancel', askId: string, value?: string): string =>
  value === undefined ? `${act}:${askId}` : `${act}:${askId}:${value}`;

export const waitForWidget = Effect.fnUntraced(function* (
  terminals: Terminals['Service'],
  screens: TerminalScreens['Service'],
  execution: HarnessExecutionRef,
  name: HarnessName,
  target: ScreenAsk,
) {
  const started = yield* Clock.currentTimeMillis;
  let looked = false;
  while (true) {
    const frame = yield* readHarnessFrame(terminals, screens, execution).pipe(Effect.catch(() => Effect.succeed(null)));
    if (frame !== null) {
      looked = true;
      const live = widgetOn(name, frame);
      if (live === null || !sameWidget(live, target)) return 'gone' as const;
    }
    const now = yield* Clock.currentTimeMillis;
    if (now - started >= LEASE_RHYTHM.takeoverAfterMs) return looked ? ('standing' as const) : ('unreadable' as const);
    yield* Effect.sleep(LEASE_RHYTHM.heartbeatIntervalMs);
  }
});

const PROFILE_ATTEMPTS = 3;

const withProfile = Effect.fnUntraced(function* <A, R>(write: Effect.Effect<A, HarnessFailure, R>) {
  for (let attempt = 1; ; attempt++) {
    const outcome = yield* Effect.result(write);
    if (outcome._tag === 'Success') return outcome.success;
    if (!(outcome.failure instanceof GateRefusal) || outcome.failure.code !== 'input-profile-conflict' || attempt >= PROFILE_ATTEMPTS) {
      return yield* Effect.fail(outcome.failure);
    }
  }
});

const utf8Length = (text: string): number => Buffer.byteLength(text, 'utf8');

const splitUtf8 = (text: string, maxBytes: number): readonly string[] => {
  if (utf8Length(text) <= maxBytes) return text === '' ? [] : [text];
  const chunks: string[] = [];
  let chunk = '';
  let bytes = 0;
  for (const char of text) {
    const size = utf8Length(char);
    if (bytes + size > maxBytes) {
      chunks.push(chunk);
      chunk = '';
      bytes = 0;
    }
    chunk += char;
    bytes += size;
  }
  if (chunk !== '') chunks.push(chunk);
  return chunks;
};

const pasted = (words: string, bracketed: boolean): string => {
  const inert = words.includes(ESC) ? words.split(ESC).join(INERT_ESCAPE) : words;
  const returns = inert.replace(/\r?\n/g, '\r');
  return bracketed ? `${BRACKETED_PASTE_START}${returns}${BRACKETED_PASTE_END}` : returns;
};

const inputProfile = Effect.fnUntraced(function* (screens: TerminalScreens['Service'], execution: ExecutionRef) {
  const update = yield* screens.screen(execution).pipe(broke);
  if (update._tag === 'ScreenUnavailable')
    return yield* new GateRefusal('unreadable-input-profile', update.detail, ['read this execution’s input profile before sending input']);
  if (update.input._tag !== 'Available')
    return yield* new GateRefusal('unreadable-input-profile', update.input.reason, [
      'read this execution’s input profile before sending input',
    ]);
  return { bracketed: update.input.bracketedPaste, applicationCursor: update.input.applicationCursor, revision: update.input.revision };
});

export const readHarnessFrame = Effect.fnUntraced(function* (
  terminals: Terminals['Service'],
  screens: TerminalScreens['Service'],
  execution: HarnessExecutionRef,
) {
  const record = yield* terminals.record(execution.execution, execution.incarnation).pipe(broke);
  if (record === null) {
    return yield* new GateRefusal(
      'execution-gone',
      `This installation holds no projection of ${execution.execution}; there is no screen to read a widget from.`,
      ['start this session again so its CLI is running', 'read this project’s terminal inventory for that execution'],
    );
  }
  const update = yield* screens.screen(record.execution).pipe(broke);
  if (update._tag === 'ScreenTextFrame') return update;
  if (update._tag === 'ScreenUnavailable') {
    return yield* new GateRefusal(
      'screen-unavailable',
      `The screen of ${execution.execution} cannot be presented (${update.reason}): ${update.detail}`,
      ['read this session again once its CLI is drawing'],
    );
  }
  return yield* new GateRefusal(
    'screen-unreadable',
    `The screen of ${execution.execution} arrived as ${update._tag}, and this road asked for text.`,
    ['read this session again; a point read answers the display as text'],
  );
});

const encoded = (key: HarnessWidgetKey, applicationCursor: boolean): string => {
  if (typeof key !== 'string') return key._tag === 'text' ? key.text.replaceAll(ESC, INERT_ESCAPE) : key.char;
  if (key === 'enter') return SUBMIT;
  if (key === 'esc') return ESC;
  const arrow = key === 'up' ? 'A' : 'B';
  return applicationCursor ? `${ESC}O${arrow}` : `${ESC}[${arrow}`;
};

const admitted = (outcome: InputAnswer, at: number): GateRefusal | null => {
  if (outcome._tag === 'InputAdmitted') return null;
  if (outcome._tag === 'InputBackpressure') {
    return new GateRefusal(
      'input-backpressure',
      `The interpreter holds ${outcome.pendingBytes} bytes of unread input against its limit of ${outcome.limit}; nothing of this delivery at sequence ${at} was taken.`,
      ['send these words again once the CLI has read what it already holds'],
    );
  }
  if (outcome._tag === 'InputConflict') {
    return new GateRefusal(
      'input-conflict',
      `Sequence ${outcome.sequence} on this session's lane already carries other bytes; this delivery was not taken.`,
      ['send this again once the act that took that sequence first has settled'],
    );
  }
  if (outcome._tag === 'InputReceiptExpired') {
    return new GateRefusal(
      'input-uncertain',
      `Sequence ${outcome.sequence} is below the retained window (from ${outcome.retainedFrom}), so what happened to it cannot be read back.`,
      ['read the CLI hook, transcript or screen; do not resend this input'],
    );
  }
  if (outcome._tag === 'InputEnded') {
    return new GateRefusal('input-ended', "This execution's input was closed; nothing types into it again.", [
      'start this session again so its CLI has an input to read',
    ]);
  }
  return new GateRefusal('input-unsupported', `The interpreter cannot take a ${outcome.act} here (${outcome.reason}): ${outcome.detail}`, [
    'deliver these words at the CLI’s own turn boundary instead',
  ]);
};

export const typeHarnessWords = Effect.fnUntraced(function* (
  terminals: Terminals['Service'],
  screens: TerminalScreens['Service'],
  writing: TerminalWriting['Service'],
  lane: HarnessLane,
  execution: HarnessExecutionRef,
  words: string,
  submit = true,
) {
  const text = words.trim();
  if (text === '') {
    return yield* new GateRefusal('no-words', 'A typed delivery carries no words.', ['send words for this session to read']);
  }
  const record = yield* terminals.record(execution.execution, execution.incarnation).pipe(broke);
  if (record === null) {
    return yield* new GateRefusal(
      'execution-gone',
      `This installation holds no projection of ${execution.execution}; there is nothing to type these words into.`,
      ['start this session again so its CLI is running', 'read this project’s terminal inventory for that execution'],
    );
  }
  if (record.transport !== 'pty') {
    return yield* new GateRefusal(
      'not-interactive',
      `Execution ${execution.execution} runs on ${record.transport}, which has no terminal to type into.`,
      ['deliver these words at the CLI’s own turn boundary instead'],
    );
  }
  const chunks = splitUtf8(text.replaceAll(ESC, INERT_ESCAPE), ADMISSION_BYTES - utf8Length(BRACKETED_PASTE_START + BRACKETED_PASTE_END));
  let sent = 0;
  const write = (words: string, cause: 'paste' | 'typed') =>
    withProfile(
      Effect.gen(function* () {
        const profile = yield* inputProfile(screens, record.execution);
        if (cause === 'paste' && /\r|\n/.test(words) && !profile.bracketed) {
          return yield* new GateRefusal('unreadable-input-profile', 'The CLI has not enabled bracketed paste for multiline words.', [
            'deliver these words at the CLI’s own turn boundary instead',
          ]);
        }
        const bytes = cause === 'paste' ? pasted(words, profile.bracketed) : words;
        const at = lane.frontier();
        const outcome = yield* writing
          .input(
            record.execution,
            { binding: lane.binding, principal: lane.principal },
            {
              sequence: at,
              cause,
              profile: profile.revision,
              act: { _tag: 'Write', bytes: new TextEncoder().encode(bytes) },
            },
            TERMINAL_PERMISSION_REVISION,
          )
          .pipe(
            admits,
            Effect.tapError((failure) =>
              failure instanceof GateRefusal && failure.code === 'input-uncertain' ? Effect.sync(() => lane.took(at)) : Effect.void,
            ),
          );
        const refusal = admitted(outcome, at);
        if (refusal !== null) {
          if (refusal.code === 'input-uncertain') lane.took(at);
          return yield* refusal;
        }
        lane.took(at);
        sent += utf8Length(bytes);
      }),
    );
  const delivery = yield* Effect.result(
    Effect.gen(function* () {
      for (const chunk of chunks) yield* write(chunk, 'paste');
      if (submit) yield* write(SUBMIT, 'typed');
    }),
  );
  if (delivery._tag === 'Success') return { bytes: sent } satisfies HarnessTyped;
  if (sent === 0 && !(delivery.failure instanceof GateRefusal && delivery.failure.code === 'input-uncertain')) {
    return yield* Effect.fail(delivery.failure);
  }
  return { bytes: sent, failure: delivery.failure } satisfies HarnessTyped;
});

export const typeHarnessKeys = Effect.fnUntraced(function* (
  terminals: Terminals['Service'],
  screens: TerminalScreens['Service'],
  writing: TerminalWriting['Service'],
  lane: HarnessLane,
  execution: HarnessExecutionRef,
  keys: readonly HarnessWidgetKey[],
  operation: string,
) {
  if (keys.length === 0) {
    return yield* new GateRefusal('no-keys', 'A widget delivery names no strokes.', ['answer with an option this ask offers']);
  }
  const record = yield* terminals.record(execution.execution, execution.incarnation).pipe(broke);
  if (record === null) {
    return yield* new GateRefusal(
      'execution-gone',
      `This installation holds no projection of ${execution.execution}; there is nothing to type these keys into.`,
      ['start this session again so its CLI is running', 'read this project’s terminal inventory for that execution'],
    );
  }
  if (record.transport !== 'pty') {
    return yield* new GateRefusal(
      'not-interactive',
      `Execution ${execution.execution} runs on ${record.transport}, which has no terminal to type into.`,
      ['answer this ask in the CLI’s own terminal'],
    );
  }
  let sent = 0;
  const first = lane.sequenceOf(operation);
  if (first === null) {
    return yield* new GateRefusal(
      'input-doubt',
      'Keys for this act were admitted through a lane that has since ended; they are never typed twice, and whether the widget took them is read from its screen.',
      ['read the current session question'],
    );
  }
  let at = first;
  const strokes = keys.flatMap((key): readonly HarnessWidgetKey[] =>
    typeof key !== 'string' && key._tag === 'text'
      ? splitUtf8(key.text, ADMISSION_BYTES).map((text): HarnessWidgetKey => ({ _tag: 'text', text }))
      : [key],
  );
  for (const [index, key] of strokes.entries()) {
    const stroke = withProfile(
      Effect.gen(function* () {
        const profile = yield* inputProfile(screens, record.execution);
        const chunk = encoded(key, profile.applicationCursor);
        const outcome = yield* writing
          .input(
            record.execution,
            { binding: lane.binding, principal: lane.principal },
            {
              sequence: at,
              cause: 'typed',
              profile: profile.revision,
              act: { _tag: 'Write', bytes: new TextEncoder().encode(chunk) },
            },
            TERMINAL_PERMISSION_REVISION,
          )
          .pipe(
            admits,
            Effect.tapError((failure) =>
              failure instanceof GateRefusal && failure.code === 'input-uncertain'
                ? Effect.sync(() => lane.took(at, operation))
                : Effect.void,
            ),
          );
        const refused = admitted(outcome, at);
        if (refused !== null) {
          if (refused.code === 'input-uncertain') lane.took(at, operation);
          return yield* refused;
        }
        lane.took(at, operation);
        return utf8Length(chunk);
      }),
    );
    const outcome = yield* Effect.result(stroke);
    if (outcome._tag === 'Failure') {
      if (index === 0) return yield* Effect.fail(outcome.failure);
      return yield* new GateRefusal(
        'input-uncertain',
        `${index} of ${strokes.length} strokes of this act were taken and the next was not; the widget may stand half-answered.`,
        ['read the CLI screen; do not resend these keys'],
      );
    }
    sent += outcome.success;
    at += 1;
  }
  return { bytes: sent } satisfies HarnessKeyed;
});

const broke = <A, E, R>(work: Effect.Effect<A, E, R>): Effect.Effect<A, HarnessFailure, R> =>
  Effect.mapError(work, (cause) => threadCallFailed(cause));

const admits = <A, R>(work: Effect.Effect<A, TerminalFailure, R>): Effect.Effect<A, HarnessFailure, R> =>
  Effect.mapError(work, (cause) => {
    if (cause._tag !== 'HostRefused') {
      if (cause._tag === 'TerminalRefused' || ((cause._tag === 'WireLost' || cause._tag === 'WireUnavailable') && !cause.sent))
        return threadCallFailed(cause);
      return new GateRefusal('input-uncertain', `Whether the host accepted this write is unknown: ${String(cause)}`, [
        'read the CLI hook, transcript or screen; do not resend this input',
      ]);
    }
    const refused = cause.refusal;
    if (refused._tag === 'InputProfileConflict')
      return new GateRefusal('input-profile-conflict', refused.reason, [
        `read profile revision ${refused.expected}; only the refused stroke encoded at revision ${refused.actual} may be retried`,
      ]);
    if (refused._tag === 'UnsupportedCapability') {
      return new GateRefusal('input-unsupported', refused.reason, ['deliver these words at the CLI’s own turn boundary']);
    }
    if (refused._tag === 'InterpretationUnavailable') {
      return new GateRefusal('interpretation-unavailable', refused.reason, ['read this execution’s screen and its input profile']);
    }
    return threadCallFailed(cause);
  });
