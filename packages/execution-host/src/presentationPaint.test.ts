import { expect, test } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Schema } from 'effect';
import { Terminal } from '@xterm/headless';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { ExecutionRef } from '@runlith/executions/protocol/execution';
import type { CellStyle, ScreenCell, ScreenFrame, ScreenPatch, ScreenRow, PaintProgram } from '@runlith/executions/protocol/presentation';
import { ByteOffset, offsetValue } from '@runlith/executions/protocol/record';
import type { ScreenAppearance } from '@runlith/executions/protocol/appearance';
import {
  presentationPaint,
  scrollText,
  presentationEncodePatch,
  refusalAsUnavailable,
} from '@runlith/executions/protocol/presentationPaint';
import { makeInterpretation, type Interpretation } from './Interpretation';
import { type Presentation, makePresentation } from './Presentation';
import { runtimeProfile } from './runtimeFixture';

const decodeRef = Schema.decodeUnknownSync(ExecutionRef);
const ref = decodeRef({ installation: 'installation-1', execution: 'execution-1', incarnation: 0 });

const COLORS = {
  palette: Array.from({ length: 256 }, (_, index) => index * 0x010101),
  foreground: 0xe5e5e5,
  background: 0x000000,
  cursor: 0xe5e5e5,
};

const profile = runtimeProfile({ rows: 4, columns: 20, scrollbackRows: 2, transports: ['pty'] });
const COLUMNS = profile.execution.geometry.columns;
const ROWS = profile.execution.geometry.rows;
const SCROLLBACK = profile.execution.geometry.scrollbackRows;

const bytes = (text: string) => new TextEncoder().encode(text);

type Screen = { readonly interpretation: Interpretation; readonly presentation: Presentation };

const withScreen = Effect.fnUntraced(function* <A, E, R>(body: (screen: Screen) => Effect.Effect<A, E, R>) {
  const interpretation = yield* makeInterpretation({
    mode: 'open',
    ref,
    geometry: { rows: profile.execution.geometry.rows, columns: profile.execution.geometry.columns },
    limits: profile.execution,
    colors: COLORS,
    reply: () => Effect.succeed({ delivered: true, ending: false, detail: '' }),
  });
  const presentation = yield* makePresentation({ interpretation, limits: profile.execution, ref });
  return yield* body({ interpretation, presentation });
});

const fed = (screen: Screen, text: string) =>
  Effect.flatMap(screen.interpretation.feed(bytes(text)), () => screen.presentation.invalidate());

const shown = Effect.fnUntraced(function* (presentation: Presentation) {
  const viewer = yield* presentation.openViewer();
  yield* presentation.grant(viewer, 1);
  return yield* presentation.next(viewer);
});

const consumer = Effect.acquireRelease(
  Effect.sync(() => {
    const terminal = new Terminal({
      cols: COLUMNS,
      rows: ROWS,
      scrollback: SCROLLBACK,
      convertEol: false,
      allowProposedApi: true,
    });
    terminal.loadAddon(new Unicode11Addon());
    terminal.unicode.activeVersion = '11';
    return terminal;
  }),
  (terminal) => Effect.sync(() => terminal.dispose()),
);

const written = (terminal: Terminal, data: string) =>
  Effect.callback<void>((resume) => {
    terminal.write(data, () => resume(Effect.void));
  });

const rgb = (value: number): string => `#${value.toString(16).padStart(6, '0')}`;

const apply = Effect.fnUntraced(function* (terminal: Terminal, program: PaintProgram) {
  for (const step of program.steps) {
    switch (step._tag) {
      case 'Theme':
        terminal.options.theme = {
          foreground: rgb(step.colors.foreground),
          background: rgb(step.colors.background),
          cursor: rgb(step.colors.cursor),
        };
        break;
      case 'Resize':
        terminal.resize(step.columns, step.rows);
        break;
      case 'Reset':
        terminal.reset();
        break;
      case 'Scroll':
        yield* written(terminal, scrollText(step.top, step.bottom, step.lines));
        break;
      case 'Write':
        yield* written(terminal, step.data);
        break;
      case 'Cursor':
        terminal.options.cursorStyle = step.cursor.style;
        terminal.options.cursorBlink = step.cursor.blink;
        break;
      case 'Title':
        break;
    }
  }
});

type PaintedCell = { readonly chars: string; readonly width: number };

const screenLines = (terminal: Terminal): readonly (readonly PaintedCell[])[] => {
  const buffer = terminal.buffer.active;
  const lines: PaintedCell[][] = [];
  for (let line = 0; line < buffer.length; line += 1) {
    const row = buffer.getLine(line);
    if (row === undefined) throw new Error(`the painted viewer holds no line ${line} of ${buffer.length}`);
    const cells: PaintedCell[] = [];
    for (let column = 0; column < COLUMNS; column += 1) {
      const cell = row.getCell(column);
      cells.push({ chars: cell?.getChars() ?? '', width: cell?.getWidth() ?? 1 });
    }
    lines.push(cells);
  }
  return lines;
};

const expectReproduced = (frame: ScreenFrame, terminal: Terminal): void => {
  expect(terminal.buffer.active.type).toBe(frame.buffer);
  const lines = screenLines(terminal);
  expect(lines.length).toBe(frame.rows.length);
  frame.rows.forEach((row, index) => {
    const line = lines[index] ?? [];
    row.cells.forEach((cell, column) => {
      expect(line[column]?.chars).toBe(cell.chars);
      expect(line[column]?.width).toBe(cell.width);
    });
  });
  const buffer = terminal.buffer.active;
  expect(buffer.cursorY).toBe(frame.cursor.line - frame.geometry.viewportLine);
  expect(buffer.cursorX).toBe(frame.cursor.column);
};

const expectViewportReproduced = (frame: ScreenFrame, terminal: Terminal): void => {
  expect(terminal.buffer.active.type).toBe(frame.buffer);
  const buffer = terminal.buffer.active;
  const viewport = frame.rows.filter((row) => row.line >= frame.geometry.viewportLine);
  viewport.forEach((row, index) => {
    const held = buffer.getLine(buffer.baseY + index);
    if (held === undefined) throw new Error(`the painted viewer holds no viewport line ${index}`);
    row.cells.forEach((cell, column) => {
      const painted = held.getCell(column);
      expect(painted?.getChars() ?? '').toBe(cell.chars);
      expect(painted?.getWidth() ?? 1).toBe(cell.width);
    });
  });
  expect(buffer.cursorY).toBe(frame.cursor.line - frame.geometry.viewportLine);
  expect(buffer.cursorX).toBe(frame.cursor.column);
};

const COMBINING_ACUTE = String.fromCodePoint(0x301);
const ASTRAL_SMILE = String.fromCodePoint(0x1f600);
const WIDE_LINE = `AB${COMBINING_ACUTE}${ASTRAL_SMILE}Z`;
const WIDE_GLYPH = ASTRAL_SMILE;
const CLUSTERED = `B${COMBINING_ACUTE}`;

it.live('a full frame rebuilds the display it was copied from', () =>
  withScreen(({ presentation, ...rest }) =>
    Effect.gen(function* () {
      const screen = { presentation, ...rest };
      yield* fed(screen, '\x1b[1;31mred\x1b[0m\r\ntwo\r\nthree\r\nfour\r\nfive');
      const update = yield* shown(presentation);
      expect(update?._tag).toBe('ScreenProgramFrame');
      if (update?._tag !== 'ScreenProgramFrame') return;
      const oracle = yield* presentation.update();
      expect(oracle._tag).toBe('ScreenFrame');
      if (oracle._tag !== 'ScreenFrame') return;
      expect(oracle.rows.length).toBe(5);
      expect(oracle.rows[0]?.line).toBe(0);

      const outcome = presentationPaint(update);
      expect(outcome._tag).toBe('PaintProgram');
      if (outcome._tag !== 'PaintProgram') return;
      expect(outcome.steps.map((step) => step._tag)).toEqual(['Theme', 'Resize', 'Reset', 'Write', 'Cursor', 'Title']);
      const write = outcome.steps[3];
      expect(write?._tag).toBe('Write');
      if (write?._tag !== 'Write') return;
      expect(write.data.startsWith('\x1b[?1049l\x1b[1;1H')).toBe(true);
      expect(outcome.steps[4]).toMatchObject({ _tag: 'Cursor', cursor: oracle.appearance.cursor });
      expect(outcome.steps[5]).toMatchObject({ _tag: 'Title', title: oracle.appearance.title });

      const term = yield* consumer;
      yield* apply(term, outcome);
      expectReproduced(oracle, term);
      expect(oracle.rows[0]?.cells[0]).toMatchObject({
        chars: 'r',
        style: { bold: true, foreground: { _tag: 'Palette', index: 1 } },
      });
      const painted = term.buffer.active.getLine(0);
      expect(painted?.getCell(0)?.isBold() !== 0).toBe(true);
      expect(painted?.getCell(0)?.isFgPalette()).toBe(true);
      expect(painted?.getCell(0)?.getFgColor()).toBe(1);
    }),
  ),
);

it.live('a second frame leaves nothing of the first underneath', () =>
  withScreen(({ presentation, ...rest }) =>
    Effect.gen(function* () {
      const screen = { presentation, ...rest };
      yield* fed(screen, 'one\r\ntwo\r\nthree\r\nfour\r\nfive\r\nsix');
      const first = yield* shown(presentation);
      expect(first?._tag).toBe('ScreenProgramFrame');
      if (first?._tag !== 'ScreenProgramFrame') return;
      const painted = presentationPaint(first);
      expect(painted._tag).toBe('PaintProgram');
      if (painted._tag !== 'PaintProgram') return;
      const term = yield* consumer;
      yield* apply(term, painted);
      const oracle = yield* presentation.update();
      expect(oracle._tag).toBe('ScreenFrame');
      if (oracle._tag !== 'ScreenFrame') return;
      expectReproduced(oracle, term);

      yield* fed(screen, '\x1bcshort');
      const second = yield* shown(presentation);
      expect(second?._tag).toBe('ScreenProgramFrame');
      if (second?._tag !== 'ScreenProgramFrame') return;
      expect(second.provenance.revision).toBeGreaterThan(first.provenance.revision);
      const repainted = presentationPaint(second);
      expect(repainted._tag).toBe('PaintProgram');
      if (repainted._tag !== 'PaintProgram') return;
      yield* apply(term, repainted);
      const oracle2 = yield* presentation.update();
      expect(oracle2._tag).toBe('ScreenFrame');
      if (oracle2._tag !== 'ScreenFrame') return;
      expect(oracle2.rows.length).toBeLessThan(oracle.rows.length);
      expectReproduced(oracle2, term);
    }),
  ),
);

it.live('a patch replaces its declared rows against the base it names', () =>
  withScreen(({ presentation, ...rest }) =>
    Effect.gen(function* () {
      const screen = { presentation, ...rest };
      yield* fed(screen, 'l1\r\nl2\r\nl3\r\nl4');
      const viewer = yield* presentation.openViewer();
      yield* presentation.grant(viewer, 1);
      const base = yield* presentation.next(viewer);
      expect(base?._tag).toBe('ScreenProgramFrame');
      if (base?._tag !== 'ScreenProgramFrame') return;
      const term = yield* consumer;
      yield* apply(term, base.program);
      const premise = yield* presentation.update();
      expect(premise._tag).toBe('ScreenFrame');
      if (premise._tag !== 'ScreenFrame') return;
      expectReproduced(premise, term);

      yield* fed(screen, '\x1b[1;1HAA\x1b[4;1HBB');
      yield* presentation.grant(viewer, 1);
      const update = yield* presentation.next(viewer);
      expect(update?._tag).toBe('ScreenProgramPatch');
      if (update?._tag !== 'ScreenProgramPatch') return;
      expect(update.provenance.base).toBe(base.provenance.revision);
      expect(update.provenance.revision).toBeGreaterThan(update.provenance.base);
      expect(offsetValue(update.provenance.parsedThrough) >= offsetValue(base.provenance.parsedThrough)).toBe(true);

      expect(update.program.steps.some((step) => step._tag === 'Reset')).toBe(false);
      yield* apply(term, update.program);
      const oracle = yield* presentation.update();
      expect(oracle?._tag).toBe('ScreenFrame');
      if (oracle?._tag !== 'ScreenFrame') return;
      expectReproduced(oracle, term);
    }),
  ),
);

it.live('the alternate screen is entered by its own generated control', () =>
  withScreen(({ presentation, ...rest }) =>
    Effect.gen(function* () {
      const screen = { presentation, ...rest };
      yield* fed(screen, '\x1b[?1049h\x1b[Halt-screen');
      const update = yield* shown(presentation);
      expect(update?._tag).toBe('ScreenProgramFrame');
      if (update?._tag !== 'ScreenProgramFrame') return;
      expect(update.buffer).toBe('alternate');

      const outcome = presentationPaint(update);
      expect(outcome._tag).toBe('PaintProgram');
      if (outcome._tag !== 'PaintProgram') return;
      const oracle = yield* presentation.update();
      expect(oracle._tag).toBe('ScreenFrame');
      if (oracle._tag !== 'ScreenFrame') return;
      for (const row of oracle.rows) {
        for (const cell of row.cells) expect(cell.chars.includes('\x1b')).toBe(false);
      }
      const term = yield* consumer;
      yield* apply(term, outcome);
      expectReproduced(oracle, term);
    }),
  ),
);

it.live('wide and combining cells keep their widths through the paint', () =>
  withScreen(({ presentation, ...rest }) =>
    Effect.gen(function* () {
      const screen = { presentation, ...rest };
      yield* fed(screen, WIDE_LINE);
      const update = yield* shown(presentation);
      expect(update?._tag).toBe('ScreenProgramFrame');
      if (update?._tag !== 'ScreenProgramFrame') return;
      const outcome = presentationPaint(update);
      expect(outcome._tag).toBe('PaintProgram');
      if (outcome._tag !== 'PaintProgram') return;

      const oracle = yield* presentation.update();
      expect(oracle._tag).toBe('ScreenFrame');
      if (oracle._tag !== 'ScreenFrame') return;
      const cells = oracle.rows[0]?.cells ?? [];
      const wide = cells.find((cell) => cell.chars === WIDE_GLYPH);
      expect(wide?.width).toBe(2);
      expect(cells[cells.indexOf(wide as ScreenCell) + 1]?.width).toBe(0);
      expect(cells.find((cell) => cell.chars === CLUSTERED)?.width).toBe(1);

      const term = yield* consumer;
      yield* apply(term, outcome);
      expectReproduced(oracle, term);
      const painted = screenLines(term)[0] ?? [];
      expect(painted.find((cell) => cell.chars === WIDE_GLYPH)?.width).toBe(2);
      expect(painted.find((cell) => cell.chars === CLUSTERED)?.width).toBe(1);
    }),
  ),
);

const plainStyle: CellStyle = {
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

const cell = (chars: string, width = 1): ScreenCell => ({ chars, width, style: plainStyle });

const textRow = (line: number, text: string): ScreenRow => ({
  line,
  wrapped: false,
  cells: Array.from(text, (chars) => cell(chars)),
});

const appearanceOf: ScreenAppearance = {
  colors: COLORS,
  cursor: { visible: true, style: 'block', blink: false },
  title: '',
};

const inputOf = {
  _tag: 'Available',
  revision: 0,
  profile: 'xterm-256color-unicode11',
  encoding: 'utf-8',
  terminal: 'xterm-256color',
  unicodeVersion: '11',
  applicationCursor: false,
  applicationKeypad: false,
  bracketedPaste: false,
  sendFocus: false,
  mouseTracking: 'none',
  mouseEncoding: 'default',
  alternateScreen: false,
  kittyKeyboardFlags: 0,
} as const;

const viewportOf = {
  rows: ROWS,
  columns: COLUMNS,
  firstLine: 0,
  viewportLine: 0,
};

const validFrame = (over: Partial<ScreenFrame> = {}): ScreenFrame => ({
  _tag: 'ScreenFrame',
  provenance: { ref, revision: 7, parsedThrough: ByteOffset.make('7') },
  buffer: 'normal',
  geometry: viewportOf,
  rows: [textRow(0, 'AB')],
  cursor: { line: 0, column: 2 },
  appearance: appearanceOf,
  input: inputOf,
  ...over,
});

test('a control character refuses the whole program', () => {
  expect(presentationPaint(validFrame())._tag).toBe('PaintProgram');
  for (const control of ['\x07', '\x7f', String.fromCodePoint(0x85)]) {
    const poisoned = validFrame({
      rows: [{ line: 0, wrapped: false, cells: [cell('A'), cell(control)] }],
    });
    const outcome = presentationPaint(poisoned);
    expect(outcome._tag).toBe('PaintRefused');
    if (outcome._tag === 'PaintRefused') expect(outcome.reason).toBe('unprintable');
  }
});

const scrolledViewport = { rows: ROWS, columns: COLUMNS, firstLine: 3, viewportLine: 5 };

const validPatch = (over: Partial<ScreenPatch> = {}): ScreenPatch => ({
  _tag: 'ScreenPatch',
  provenance: { ref, base: 7, revision: 8, parsedThrough: ByteOffset.make('9') },
  buffer: 'normal',
  geometry: scrolledViewport,
  rows: [textRow(6, 'hi')],
  cursor: { line: 5, column: 0 },
  appearance: appearanceOf,
  input: inputOf,
  ...over,
});

test('a patch naming a scrolled-out row refuses instead of painting elsewhere', () => {
  expect(presentationPaint(validPatch())._tag).toBe('PaintProgram');
  const poisoned = validPatch({ rows: [textRow(6, 'hi'), textRow(2, 'old')] });
  const outcome = presentationPaint(poisoned);
  expect(outcome._tag).toBe('PaintRefused');
  if (outcome._tag === 'PaintRefused') expect(outcome.reason).toBe('row-outside-viewport');
});

test('a frame standing outside its own display refuses as geometry', () => {
  expect(presentationPaint(validFrame())._tag).toBe('PaintProgram');
  const above = validFrame({ geometry: { ...viewportOf, firstLine: 2 } });
  const refusedAbove = presentationPaint(above);
  expect(refusedAbove._tag).toBe('PaintRefused');
  if (refusedAbove._tag === 'PaintRefused') expect(refusedAbove.reason).toBe('geometry');
  const outside = validFrame({
    geometry: scrolledViewport,
    rows: [textRow(6, 'hi')],
    cursor: { line: 2, column: 0 },
  });
  const refusedOutside = presentationPaint(outside);
  expect(refusedOutside._tag).toBe('PaintRefused');
  if (refusedOutside._tag === 'PaintRefused') expect(refusedOutside.reason).toBe('geometry');
});

test('no screen at all refuses as unavailable', () => {
  const outcome = presentationPaint({
    _tag: 'ScreenUnavailable',
    ref,
    parsedThrough: ByteOffset.make('0'),
    reason: 'engine',
    detail: 'the engine is gone',
  });
  expect(outcome._tag).toBe('PaintRefused');
  if (outcome._tag === 'PaintRefused') expect(outcome.reason).toBe('unavailable');
});

it.live('an appended line scrolls the region instead of re-keying the viewport', () =>
  withScreen(({ presentation, ...rest }) =>
    Effect.gen(function* () {
      const screen = { presentation, ...rest };
      yield* fed(screen, 'l0\r\nl1\r\nl2\r\nl3\r\nl4\r\nl5');
      const viewer = yield* presentation.openViewer();
      yield* presentation.grant(viewer, 1);
      const base = yield* presentation.next(viewer);
      expect(base?._tag).toBe('ScreenProgramFrame');
      if (base?._tag !== 'ScreenProgramFrame') return;
      const term = yield* consumer;
      yield* apply(term, base.program);

      yield* fed(screen, '\r\nl6');
      yield* presentation.grant(viewer, 1);
      const update = yield* presentation.next(viewer);
      expect(update?._tag).toBe('ScreenProgramPatch');
      if (update?._tag !== 'ScreenProgramPatch') return;
      expect(update.provenance.base).toBe(base.provenance.revision);
      expect(update.program.steps.map((step) => step._tag)).toEqual(['Scroll', 'Write']);
      expect(update.program.steps[0]).toMatchObject({ _tag: 'Scroll', top: 1, bottom: ROWS, lines: 1 });

      yield* apply(term, update.program);
      const oracle = yield* presentation.update();
      expect(oracle._tag).toBe('ScreenFrame');
      if (oracle._tag !== 'ScreenFrame') return;
      expectViewportReproduced(oracle, term);
    }),
  ),
);

it.live('a resume on a live base patches and the glass matches the interpreter', () =>
  withScreen(({ presentation, ...rest }) =>
    Effect.gen(function* () {
      const screen = { presentation, ...rest };
      yield* fed(screen, 'l1\r\nl2\r\nl3\r\nl4');
      const first = yield* presentation.openViewer();
      yield* presentation.grant(first, 1);
      const held = yield* presentation.next(first);
      expect(held?._tag).toBe('ScreenProgramFrame');
      if (held?._tag !== 'ScreenProgramFrame') return;
      const term = yield* consumer;
      yield* apply(term, held.program);

      yield* fed(screen, '\x1b[1;1HAA');
      const resumed = yield* presentation.openViewer(held.provenance.revision);
      yield* presentation.grant(resumed, 1);
      const update = yield* presentation.next(resumed);
      expect(update?._tag).toBe('ScreenProgramPatch');
      if (update?._tag !== 'ScreenProgramPatch') return;
      expect(update.provenance.base).toBe(held.provenance.revision);

      yield* apply(term, update.program);
      const oracle = yield* presentation.update();
      expect(oracle._tag).toBe('ScreenFrame');
      if (oracle._tag !== 'ScreenFrame') return;
      expectReproduced(oracle, term);
    }),
  ),
);

it.live('a reverse scroll paints downward and reproduces', () =>
  withScreen(({ presentation, ...rest }) =>
    Effect.gen(function* () {
      const screen = { presentation, ...rest };
      yield* fed(screen, 'l0\r\nl1\r\nl2\r\nl3\r\nl4\r\nl5');
      const viewer = yield* presentation.openViewer();
      yield* presentation.grant(viewer, 1);
      const base = yield* presentation.next(viewer);
      expect(base?._tag).toBe('ScreenProgramFrame');
      if (base?._tag !== 'ScreenProgramFrame') return;
      const term = yield* consumer;
      yield* apply(term, base.program);

      yield* fed(screen, '\x1b[H\x1bM');
      yield* presentation.grant(viewer, 1);
      const update = yield* presentation.next(viewer);
      expect(update?._tag).toBe('ScreenProgramPatch');
      if (update?._tag !== 'ScreenProgramPatch') return;
      expect(update.program.steps.map((step) => step._tag)).toEqual(['Scroll', 'Write']);
      expect(update.program.steps[0]).toMatchObject({ _tag: 'Scroll', top: 1, bottom: ROWS, lines: -1 });

      yield* apply(term, update.program);
      const oracle = yield* presentation.update();
      expect(oracle._tag).toBe('ScreenFrame');
      if (oracle._tag !== 'ScreenFrame') return;
      expectReproduced(oracle, term);
    }),
  ),
);

it.live('a scroll with edits inside the moved block still scrolls, then paints what differs', () =>
  withScreen(({ presentation, ...rest }) =>
    Effect.gen(function* () {
      const screen = { presentation, ...rest };
      yield* fed(screen, 'l0\r\nl1\r\nl2\r\nl3\r\nl4\r\nl5');
      const viewer = yield* presentation.openViewer();
      yield* presentation.grant(viewer, 1);
      const base = yield* presentation.next(viewer);
      expect(base?._tag).toBe('ScreenProgramFrame');
      if (base?._tag !== 'ScreenProgramFrame') return;
      const term = yield* consumer;
      yield* apply(term, base.program);

      yield* fed(screen, '\x1b[4;1HZZ\r\nl6');
      yield* presentation.grant(viewer, 1);
      const update = yield* presentation.next(viewer);
      expect(update?._tag).toBe('ScreenProgramPatch');
      if (update?._tag !== 'ScreenProgramPatch') return;
      expect(update.program.steps.map((step) => step._tag)).toEqual(['Scroll', 'Write']);
      expect(update.program.steps[0]).toMatchObject({ _tag: 'Scroll', top: 1, bottom: ROWS, lines: 1 });

      yield* apply(term, update.program);
      const oracle = yield* presentation.update();
      expect(oracle._tag).toBe('ScreenFrame');
      if (oracle._tag !== 'ScreenFrame') return;
      expectViewportReproduced(oracle, term);
    }),
  ),
);

it.live('appearance travels only where it changed since the base', () =>
  withScreen(({ presentation, ...rest }) =>
    Effect.gen(function* () {
      const screen = { presentation, ...rest };
      yield* fed(screen, 'one');
      const viewer = yield* presentation.openViewer();
      yield* presentation.grant(viewer, 1);
      const base = yield* presentation.next(viewer);
      expect(base?._tag).toBe('ScreenProgramFrame');
      if (base?._tag !== 'ScreenProgramFrame') return;
      const term = yield* consumer;
      yield* apply(term, base.program);

      yield* fed(screen, '\x1b]0;first\x07');
      yield* presentation.grant(viewer, 1);
      const titled = yield* presentation.next(viewer);
      expect(titled?._tag).toBe('ScreenProgramPatch');
      if (titled?._tag !== 'ScreenProgramPatch') return;
      expect(titled.program.steps.map((step) => step._tag)).toEqual(['Write', 'Title']);
      expect(titled.program.steps[1]).toMatchObject({ _tag: 'Title', title: 'first' });
      yield* apply(term, titled.program);
      const oracle = yield* presentation.update();
      expect(oracle._tag).toBe('ScreenFrame');
      if (oracle._tag !== 'ScreenFrame') return;
      expectReproduced(oracle, term);

      yield* fed(screen, '\x1b[1;1Hq');
      yield* presentation.grant(viewer, 1);
      const quiet = yield* presentation.next(viewer);
      expect(quiet?._tag).toBe('ScreenProgramPatch');
      if (quiet?._tag !== 'ScreenProgramPatch') return;
      expect(quiet.program.steps.map((step) => step._tag)).toEqual(['Write']);
    }),
  ),
);

test('a patch whose cells were not copied from a parsed buffer refuses whole', () => {
  const base = { rows: [textRow(0, 'AB')], viewportLine: 0, appearance: appearanceOf };
  const poisoned = {
    buffer: 'normal' as const,
    geometry: viewportOf,
    rows: [{ line: 0, wrapped: false, cells: [cell('A'), cell('')] }],
    cursor: { line: 0, column: 2 },
    appearance: appearanceOf,
  };
  const outcome = presentationEncodePatch(base, poisoned);
  expect(outcome._tag).toBe('PaintRefused');
  if (outcome._tag === 'PaintRefused') expect(outcome.reason).toBe('unprintable');
});

test('an encoder refusal reaches the wire as unavailable with its frontier and detail', () => {
  const refusal = {
    _tag: 'PaintRefused',
    reason: 'unprintable',
    detail: 'line 0 column 1 carries a control character',
  } as const;
  const update = refusalAsUnavailable({ ref, parsedThrough: ByteOffset.make('41'), refusal });
  expect(update._tag).toBe('ScreenUnavailable');
  expect(update.reason).toBe('engine');
  expect(update.detail).toBe(refusal.detail);
  expect(update.parsedThrough).toBe(ByteOffset.make('41'));
});
