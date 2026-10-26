import { Effect } from 'effect';
import { BindingId, Principal } from '@runlith/executions/protocol/custody';
import { ExecutionId, InstallationId, type ExecutionRef } from '@runlith/executions/protocol/execution';
import type { InputRequest } from '@runlith/executions/protocol/input';
import type { XtermInputProfile } from '@runlith/executions/protocol/inputProfile';
import type { CellStyle, ScreenAnswer, ScreenFrame, ScreenTextFrame } from '@runlith/executions/protocol/presentation';
import { byteOffset } from '@runlith/executions/protocol/record';
import { TargetKey } from '../../executions/contract/wire/targets.js';
import { TerminalRefused } from '../../executions/contract/wire/refusals.js';
import type { TerminalRecord } from '../../executions/contract/wire/terminals.js';
import type { ScreenAsk } from '../contract/service/adapter.js';
import type { Terminals } from '../../executions/contract/service/terminals.js';
import type { TerminalScreens } from '../../executions/contract/service/records.js';
import type { TerminalWriting } from '../../executions/contract/service/writing.js';
import type { TerminalGrants } from '../../executions/contract/service/grants.js';
import { HarnessLanes } from '../sessions/lanes.js';

export const WIDGET_ASK: readonly string[] = [
  'Fetching https://wttr.in/x',
  '❭ 1 Yes',
  '· 2 Maybe',
  '· 3 No',
  '↑↓ select · ↵ confirm · esc cancel',
];

export const WIDGET_GONE: readonly string[] = ['Fetching https://wttr.in/x', 'done'];

export const widgetTarget = (): ScreenAsk => ({
  kind: 'choice',
  prompt: 'Fetching https://wttr.in/x',
  header: null,
  subject: 'https://wttr.in/x',
  options: [
    { value: '1', label: 'Yes' },
    { value: '2', label: 'Maybe' },
    { value: '3', label: 'No' },
  ],
  selected: null,
});

export const keyboardRecord = (): TerminalRecord => ({
  projectId: 7,
  execution: { installation: InstallationId.make('keyboard-test'), execution: ExecutionId.make('exec-1'), incarnation: 0 },
  transport: 'pty',
  lifetime: 'held',
  targetKey: TargetKey.make('keyboard-test'),
  holder: Principal.make('operator'),
  origin: Principal.make('operator'),
  revision: 0,
  holdings: {},
  acceptedAt: 0,
});

export const keyboardProfile = (applicationCursor: boolean, revision = 3): XtermInputProfile => ({
  _tag: 'Available',
  revision,
  profile: 'xterm-256color-unicode11',
  encoding: 'utf-8',
  terminal: 'xterm-256color',
  unicodeVersion: '11',
  applicationCursor,
  applicationKeypad: false,
  bracketedPaste: true,
  sendFocus: false,
  mouseTracking: 'none',
  mouseEncoding: 'default',
  alternateScreen: false,
  kittyKeyboardFlags: 1,
});

const STYLE: CellStyle = {
  foreground: { _tag: 'Default' },
  background: { _tag: 'Default' },
  underlineColor: { _tag: 'Default' },
  underline: 'none',
  bold: false,
  dim: false,
  italic: false,
  blink: false,
  inverse: false,
  invisible: false,
  strikethrough: false,
  overline: false,
};

const PROVENANCE = {
  ref: { installation: InstallationId.make('keyboard-test'), execution: ExecutionId.make('exec-1'), incarnation: 0 },
  revision: 1,
  parsedThrough: byteOffset(0n),
};

export const keyboardFrame = (lines: readonly string[], applicationCursor = false): ScreenTextFrame => ({
  _tag: 'ScreenTextFrame',
  provenance: PROVENANCE,
  buffer: 'normal',
  geometry: { rows: lines.length, columns: 80, firstLine: 0, viewportLine: 0 },
  rows: lines.map((text, line) => ({ line, wrapped: false, text })),
  cursor: { line: 0, column: 0 },
  input: keyboardProfile(applicationCursor),
  title: '',
});

export const cellScreen = (lines: readonly string[], applicationCursor = false): ScreenFrame => ({
  _tag: 'ScreenFrame',
  provenance: PROVENANCE,
  buffer: 'normal',
  geometry: { rows: lines.length, columns: 80, firstLine: 0, viewportLine: 0 },
  rows: lines.map((text, line) => ({
    line,
    wrapped: false,
    cells: [...text].map((chars) => ({ chars, width: 1, style: STYLE })),
  })),
  cursor: { line: 0, column: 0 },
  appearance: {
    colors: { palette: Array.from({ length: 256 }, () => 0), foreground: 0, background: 0, cursor: 0 },
    cursor: { visible: true, style: 'block', blink: false },
    title: '',
  },
  input: keyboardProfile(applicationCursor),
});

export const unavailableScreen = (): ScreenAnswer => ({
  _tag: 'ScreenUnavailable',
  ref: { installation: InstallationId.make('keyboard-test'), execution: ExecutionId.make('exec-1'), incarnation: 0 },
  parsedThrough: byteOffset(0n),
  reason: 'transport',
  detail: 'a fixture publishes no screen',
});

export type CapturedInput = {
  readonly binding: string;
  readonly sequence: number;
  readonly cause: string;
  readonly profile: number | undefined;
  readonly act: string;
  readonly bytes: Uint8Array;
};

export const KEYBOARD_BINDING = BindingId.make('keyboard-test');

export type KeyboardRig = {
  readonly terminals: Terminals['Service'];
  readonly screens: TerminalScreens['Service'];
  readonly writing: TerminalWriting['Service'];
  readonly grants: TerminalGrants['Service'];
  readonly opened: string[];
  readonly inputs: CapturedInput[];
  readonly accepted: CapturedInput[];
  readonly revoked: string[];
};

export const keyboardRig = (opts: {
  readonly frames: readonly ScreenAnswer[];
  readonly record?: TerminalRecord | null;
  readonly unsupported?: number;
  readonly firstLaneAdmits?: number;
  readonly refusedReopens?: number;
  readonly profiles?: readonly number[];
  readonly submitConflicts?: number;
  readonly lostReplyAt?: number;
  readonly conflictAt?: ReadonlySet<number>;
  readonly unavailable?: number;
}): KeyboardRig => {
  let refusing = opts.unsupported ?? 0;
  let unavailable = opts.unavailable ?? 0;
  let conflicts = opts.submitConflicts ?? 0;
  let movedProfile: number | undefined;
  let firstAdmits = opts.firstLaneAdmits ?? Number.POSITIVE_INFINITY;
  let reopensRefused = opts.refusedReopens ?? 0;
  const opened: string[] = [];
  const inputs: CapturedInput[] = [];
  const accepted: CapturedInput[] = [];
  const revoked: string[] = [];
  let shown = 0;
  const record = opts.record === undefined ? keyboardRecord() : opts.record;
  const terminals = {
    record: (_id: string, _incarnation: number) => Effect.succeed(record),
  } as unknown as Terminals['Service'];
  const writing = {
    openBinding: (_principal: unknown, open: { readonly road: string }) => {
      opened.push(open.road);
      if (opened.length > 1 && reopensRefused > 0) {
        reopensRefused -= 1;
        return Effect.fail(new TerminalRefused({ reason: 'capacity', message: 'The host would not open a lane for this caller.' }));
      }
      return Effect.succeed({
        binding: opened.length === 1 ? KEYBOARD_BINDING : BindingId.make(`${KEYBOARD_BINDING}-${opened.length}`),
      });
    },
    input: (execution: ExecutionRef, scope: { readonly binding: string }, request: InputRequest, _revision: number) => {
      const bytes = request.act._tag === 'Write' ? request.act.bytes : new Uint8Array([3]);
      inputs.push({
        binding: scope.binding,
        sequence: request.sequence,
        cause: request.cause,
        profile: request.profile,
        act: request.act._tag,
        bytes,
      });
      if (opts.lostReplyAt === inputs.length) {
        accepted.push(inputs.at(-1)!);
        return Effect.fail({ _tag: 'WireLost', reason: 'reply lost', sent: true });
      }
      if (unavailable > 0) {
        unavailable -= 1;
        return Effect.fail({ _tag: 'HostRefused', refusal: { _tag: 'InterpretationUnavailable', reason: 'interpreter unavailable' } });
      }
      if (scope.binding === KEYBOARD_BINDING) {
        if (firstAdmits <= 0) {
          return Effect.fail({
            _tag: 'HostRefused',
            refusal: { _tag: 'HostConflict', reason: 'BindingUnknown: this lane ended when its execution changed hands' },
          });
        }
        firstAdmits -= 1;
      }
      if ((request.cause === 'typed' && conflicts > 0) || opts.conflictAt?.has(inputs.length)) {
        conflicts -= 1;
        movedProfile = (request.profile ?? 0) + 1;
        return Effect.fail({
          _tag: 'HostRefused',
          refusal: {
            _tag: 'InputProfileConflict',
            expected: movedProfile,
            actual: request.profile ?? 0,
            reason: 'profile moved',
          },
        });
      }
      const profile = movedProfile ?? opts.profiles?.[Math.min(inputs.length - 1, opts.profiles.length - 1)];
      if (profile !== undefined && request.profile !== profile)
        return Effect.fail({
          _tag: 'HostRefused',
          refusal: { _tag: 'InputProfileConflict', expected: profile, actual: request.profile ?? 0, reason: 'profile moved' },
        });
      if (refusing > 0) {
        refusing -= 1;
        return Effect.fail({
          _tag: 'HostRefused',
          refusal: { _tag: 'UnsupportedCapability', reason: 'this execution has no interpreted screen' },
        });
      }
      accepted.push(inputs.at(-1)!);
      return Effect.succeed({
        _tag: 'InputAdmitted',
        receipt: {
          execution,
          sequence: request.sequence,
          cause: request.cause,
          bytes: bytes.length,
          acceptedThrough: byteOffset(0n),
        },
      });
    },
  } as unknown as TerminalWriting['Service'];
  const screens = {
    screen: (_execution: unknown, request?: { readonly cells?: boolean }) => {
      if (request?.cells === true) return Effect.die(new Error('a reader asked for cells; this fixture holds text'));
      if (opts.frames.length === 0) return Effect.die(new Error('screen read with no frames queued'));
      const frame = opts.frames[Math.min(shown, opts.frames.length - 1)]!;
      shown += 1;
      const revision = movedProfile ?? opts.profiles?.[Math.min(inputs.length, opts.profiles.length - 1)];
      return Effect.succeed(
        revision === undefined || frame._tag === 'ScreenUnavailable' ? frame : { ...frame, input: { ...frame.input, revision } },
      );
    },
  } as unknown as TerminalScreens['Service'];
  const grants = {
    revoke: (_claim: unknown, cause: string) => {
      revoked.push(cause);
      return Effect.succeed('fenced' as const);
    },
  } as unknown as TerminalGrants['Service'];
  return { terminals, screens, writing, grants, opened, inputs, accepted, revoked };
};

export const KEYBOARD_EXECUTION: ExecutionRef = {
  installation: InstallationId.make('keyboard-test'),
  execution: ExecutionId.make('exec-1'),
  incarnation: 0,
};

export const keyboardLane = Effect.fnUntraced(function* (face: KeyboardRig, sessionId: string) {
  const lanes = new HarnessLanes(face.grants, face.writing);
  yield* lanes.open(sessionId, 7, KEYBOARD_EXECUTION, Principal.make('operator'));
  return yield* lanes.of(sessionId);
});
