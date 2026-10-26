import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Schema } from 'effect';
import type { IBuffer, Terminal } from '@xterm/headless';
import { CapabilityProfile } from '@runlith/executions/protocol/capacity';
import { ExecutionRef } from '@runlith/executions/protocol/execution';
import { byteOffset, offsetValue } from '@runlith/executions/protocol/record';
import { makeInterpretation, type Interpretation } from './Interpretation';
import { runtimeProfile } from './runtimeFixture';
import type { ScreenCheckpoint } from './ScreenCheckpoint';

const ref = Schema.decodeUnknownSync(ExecutionRef)({ installation: 'installation-1', execution: 'execution-1', incarnation: 0 });

const profileOf = (rows: number, columns: number, scrollbackRows = 20) => {
  const base = runtimeProfile({ rows, columns, scrollbackRows });
  const cells = (rows + scrollbackRows + rows) * columns;
  return Schema.decodeUnknownSync(CapabilityProfile)({
    ...base,
    execution: { ...base.execution, parser: { ...base.execution.parser, cellBytes: 2 * cells * 12 + cells * 168 } },
  }).execution;
};

const COLORS = {
  palette: Array.from({ length: 256 }, (_, index) => index * 0x010101),
  foreground: 0xe5e5e5,
  background: 0x000000,
  cursor: 0xe5e5e5,
};

const encoded = (text: string) => new TextEncoder().encode(text);

type Screen = { readonly interpretation: Interpretation; readonly replies: string[] };
type ScreenPair = { readonly original: unknown; readonly copy: unknown };

const listening = (replies: string[]) => (reply: Uint8Array) =>
  Effect.sync(() => {
    replies.push(new TextDecoder().decode(reply));
    return { delivered: true, ending: false, detail: '' };
  });

const opened = Effect.fnUntraced(function* (rows: number, columns: number) {
  const replies: string[] = [];
  const interpretation = yield* makeInterpretation({
    mode: 'open',
    ref,
    geometry: { rows, columns },
    limits: profileOf(rows, columns),
    colors: COLORS,
    reply: listening(replies),
  });
  return { interpretation, replies };
});

const restored = Effect.fnUntraced(function* (rows: number, columns: number, checkpoint: ScreenCheckpoint, frontier = checkpoint.position) {
  const replies: string[] = [];
  const interpretation = yield* makeInterpretation({
    mode: 'restore',
    ref,
    limits: profileOf(rows, columns),
    colors: COLORS,
    reply: listening(replies),
    point: { _tag: 'Checkpoint', checkpoint, frontier },
  });
  return { interpretation, replies };
});

const taken = (screen: Screen) =>
  Effect.flatMap(screen.interpretation.checkpoint(), (checkpoint) =>
    checkpoint === undefined ? Effect.die(new Error('the parser was not at rest')) : Effect.succeed(checkpoint),
  );

type Linked = { readonly extended?: { readonly urlId?: number }; isProtected(): number };
type LinkData = { readonly id?: string; readonly uri: string };
type Links = { readonly _core: { readonly _oscLinkService: { getLinkData(id: number): LinkData | undefined } } };

const linesOf = (engine: Terminal, buffer: IBuffer, links: Map<number, number>) =>
  Array.from({ length: buffer.length }, (_, row) => {
    const line = buffer.getLine(row);
    if (line === undefined) return '';
    const styled: string[] = [];
    let text = '';
    for (let column = 0; column < line.length; column += 1) {
      const cell = line.getCell(column);
      if (cell === undefined) continue;
      text += cell.getChars() === '' ? (cell.getWidth() === 0 ? '' : '·') : cell.getChars();
      const link = (cell as unknown as Linked).extended?.urlId ?? 0;
      const data = link === 0 ? undefined : (engine as unknown as Links)._core._oscLinkService.getLinkData(link);
      const uri = data === undefined ? '' : `${data.uri}#${data.id ?? ''}@${links.get(link) ?? links.set(link, links.size).size - 1}`;
      const isProtected = (cell as unknown as Linked).isProtected();
      if (cell.isAttributeDefault() && uri === '' && isProtected === 0) continue;
      styled.push(
        [column, cell.getFgColorMode(), cell.getFgColor(), cell.getBgColorMode(), cell.getBgColor(), cell.isBold(), cell.isDim()]
          .concat([cell.isItalic(), cell.isUnderline(), cell.getUnderlineStyle(), cell.getUnderlineColor(), cell.isInverse()])
          .concat([cell.isStrikethrough(), cell.isOverline(), isProtected])
          .join('/') + uri,
      );
    }
    return `${line.isWrapped ? '+' : ' '}${text}${styled.length === 0 ? '' : ` ${styled.join(' ')}`}`;
  });

const stateOf = (screen: Screen) =>
  Effect.map(
    screen.interpretation.read((engine) => {
      const links = new Map<number, number>();
      return {
        active: engine.buffer.active.type,
        modes: { ...engine.modes },
        cursor: [engine.buffer.active.cursorX, engine.buffer.active.cursorY, engine.buffer.active.baseY],
        normal: linesOf(engine, engine.buffer.normal, links),
        alternate: linesOf(engine, engine.buffer.alternate, links),
      };
    }),
    (read) => {
      const { revision: _, ...input } = read.input;
      return { screen: read.value, input, appearance: read.appearance };
    },
  );

const fed = (screen: Screen, text: string | Uint8Array) => screen.interpretation.feed(typeof text === 'string' ? encoded(text) : text);

const twins = Effect.fnUntraced(function* (rows: number, columns: number, prefix: string, steps: ReadonlyArray<string>) {
  const original = yield* opened(rows, columns);
  yield* fed(original, prefix);
  const copy = yield* restored(rows, columns, yield* taken(original));
  const states: ScreenPair[] = [{ original: yield* stateOf(original), copy: yield* stateOf(copy) }];
  for (const step of steps) {
    yield* fed(original, step);
    yield* fed(copy, step);
    states.push({ original: yield* stateOf(original), copy: yield* stateOf(copy) });
  }
  return states;
});

const expectTwins = (states: readonly ScreenPair[]) => {
  for (const state of states) expect(state.copy).toEqual(state.original);
};

describe('a screen checkpoint restored on a fresh engine', () => {
  it.live(
    'continues output inside scroll margins and in origin mode in the same cells',
    Effect.fnUntraced(function* () {
      expectTwins(
        yield* twins(6, 20, 'line1\r\nline2\r\nline3\u001b[2;5r\u001b[?6h\u001b[3;4H', ['X', ' Y\r\nZ\n\n\n\nW', '\u001b[1;1HO']),
      );
    }),
  );

  it.live(
    'pops the kitty keyboard stack and returns to the normal screen as the original does',
    Effect.fnUntraced(function* () {
      const prefix = 'prompt$ \u001b[>1u\u001b[>3u\u001b[2;4r\u001b[3;2H\u001b[?1049h\u001b[>5u\u001b[>9udrawn\u001b[4;1Hlow';
      expectTwins(yield* twins(6, 20, prefix, ['\u001b[<u', '\u001b[?1049l', '\u001b[<u', 'after\n\n\n\nend', '\u001b[<u']));
    }),
  );

  it.live(
    'carries the input modes and the appearance',
    Effect.fnUntraced(function* () {
      const prefix =
        '\u001b[?1h\u001b[?2004h\u001b[?1002h\u001b[?1006h\u001b[?1004h\u001b[?25l\u001b[5 q\u001b=' +
        '\u001b]2;work\u0007\u001b]4;1;#123456\u0007\u001b]11;#101010\u0007\u001b]12;#abcdef\u0007\u001b[20htext';
      expectTwins(yield* twins(6, 20, prefix, ['\u001b[?25h\u001b[?1006l\r\nnext', '\u001b[0 q\u001b]104;1\u0007\u001b]111\u0007']));
    }),
  );

  it.live(
    'keeps the saved cursor of the active screen with its character sets and modes',
    Effect.fnUntraced(function* () {
      const prefix = '\u001b)0\u000eqq\u001b[2;5r\u001b[?6h\u001b[2;3H\u001b7\u000f\u001b[?6l\u001b[?7lmove\u001b[6;6H';
      expectTwins(yield* twins(6, 20, prefix, ['\u001b8qq', '\u001b[20Ctail', '\u001b[?7h\r\nlast']));
    }),
  );

  it.live(
    'repeats and joins after the character the parser last printed',
    Effect.fnUntraced(function* () {
      expectTwins(yield* twins(6, 20, 'ab\u2500', ['\u001b[3b', 'e', '\u0301x']));
      expectTwins(yield* twins(6, 20, '\u001b[4habcdef\u001b[3GXY', ['Q', '\u001b[2b']));
    }),
  );

  it.live(
    'wraps a line whose last column was just printed',
    Effect.fnUntraced(function* () {
      expectTwins(yield* twins(4, 10, `${'x'.repeat(9)}\u001b[31m\u6f22`, ['Y', 'z']));
      expectTwins(yield* twins(4, 10, `${'x'.repeat(10)}\u001b[1m`, ['Y']));
    }),
  );

  it.live(
    'keeps scrollback, wrapped lines, tab stops, the pen and its link',
    Effect.fnUntraced(function* () {
      const lines = Array.from({ length: 40 }, (_, index) => `L${index}`).join('\r\n');
      const prefix =
        `${lines}\r\n${'w'.repeat(25)}\u001b[3g\u001b[3G\u001bH\u001b[7G\u001bH\r` +
        '\u001b[1;4:3;38;2;1;2;3;48;5;100;58:2::9:8:7m\u001b]8;id=a;https://example.test/x\u0007styled';
      expectTwins(yield* twins(4, 20, prefix, ['\tA\tB', '\u001b]8;;\u0007\u001b[0m plain\r\n\tC']));
    }),
  );

  it.live(
    'keeps a mark that joins no character in its own cell',
    Effect.fnUntraced(function* () {
      expectTwins(yield* twins(6, 20, 'cafe\u001b[0m\u0301', [' x']));
    }),
  );

  it.live(
    'keeps empty cells that carry a pen, wherever the engine left them',
    Effect.fnUntraced(function* () {
      expectTwins(yield* twins(4, 10, 'a\u6f22\u001b[D\u001b[31mb\u001b[9G\u6f22\u001b[9G\u001b[32mq', ['\r\n', 'z']));
      expectTwins(yield* twins(4, 10, 'q\u001b[9G\u6f22\u001b[10G\u001b[32mc\u001b[10G\u001b[33m\u6f22\r\u001b[K', ['\u001b[Az']));
      expectTwins(yield* twins(3, 10, `${'x'.repeat(9)}\u001b[44m\u6f22\r\n\r\n\u001b[31m${'y'.repeat(9)}\u001b[45m\u6f22`, ['w']));
    }),
  );

  it.live(
    'wraps after a line whose last cell was erased in place',
    Effect.fnUntraced(function* () {
      expectTwins(yield* twins(4, 10, `${'x'.repeat(20)}\u001b[1K`, ['Y']));
      expectTwins(yield* twins(4, 10, `${'x'.repeat(10)}\u001b[41m\u001b[2K`, ['Y']));
    }),
  );

  it.live(
    'restores the shift the saved cursor recorded and keeps the live one',
    Effect.fnUntraced(function* () {
      expectTwins(yield* twins(6, 20, '\u000e\u001b7\u000f', ['\u001b)0lqk', '\u001b8lqk']));
    }),
  );

  it.live(
    'keeps an underline color set while nothing is underlined',
    Effect.fnUntraced(function* () {
      expectTwins(yield* twins(6, 20, 'a\u001b[58:5:3mb', ['c\u001b[4md']));
    }),
  );

  it.live(
    'repeats the last character as it was printed, whatever the character set maps now',
    Effect.fnUntraced(function* () {
      expectTwins(yield* twins(6, 20, 'a|\u001b(4', ['\u001b[2b', 'x']));
      expectTwins(yield* twins(6, 20, '\u001b(4a]\u001b(B', ['\u001b[2b', 'x']));
    }),
  );

  it.live(
    'keeps one link without an id as one link across rows, without an underline it never had',
    Effect.fnUntraced(function* () {
      const link = '\u001b]8;;https://e.test/a\u0007';
      expectTwins(yield* twins(4, 10, `${link}${'l'.repeat(14)}\u001b]8;;\u0007 ${link}m`, ['n']));
    }),
  );

  it.live(
    'keeps protected cells and a protecting pen',
    Effect.fnUntraced(function* () {
      expectTwins(yield* twins(6, 20, 'a\u001b[1"qbc\u001b[0"qd\u001b[1"q', ['e\u001b[1G\u001b[?2K', '\u001b[0"qf\u001b[1G\u001b[?2K']));
    }),
  );

  it.live(
    'restores a cursor saved in origin mode before the margins changed',
    Effect.fnUntraced(function* () {
      expectTwins(yield* twins(8, 20, '\u001b[?6h\u001b[3;2H\u001b7\u001b[?6l\u001b[2;6r', ['\u001b8X']));
    }),
  );

  it.live(
    'restores a saved pen whose underline style the engine keeps beside it',
    Effect.fnUntraced(function* () {
      expectTwins(yield* twins(6, 20, '\u001b[4:3;58:5:2m\u001b7\u001b[0m', ['\u001b8a', '\u001b[0m\u001b[4:3mb\u001b8c']));
      expectTwins(yield* twins(6, 20, '\u001b]8;;https://e.test/a\u0007\u001b7\u001b]8;;\u0007\u001b[58:5:4m', ['\u001b8a']));
    }),
  );

  it.live(
    'keeps synchronized output open',
    Effect.fnUntraced(function* () {
      expectTwins(yield* twins(6, 20, '\u001b[?2026hab', ['\u001b[?2026lc']));
    }),
  );

  it.live(
    'keeps the cursor the alternate screen saved while the normal one is shown',
    Effect.fnUntraced(function* () {
      const prefix = '\u001b[?1047h\u001b[3;4H\u001b[31m\u001b(0\u001b7\u001b[?1047l\u001b(B\u001b[0mnormal';
      expectTwins(yield* twins(6, 20, prefix, ['\u001b[?1047h\u001b8qX']));
    }),
  );

  it.live(
    'carries a long link target once, outside the screen bytes',
    Effect.fnUntraced(function* () {
      const uri = `https://e.test/${'u'.repeat(600)}`;
      const original = yield* opened(6, 20);
      yield* fed(original, `\u001b]8;;${uri}\u0007${'l'.repeat(100)}`);
      const checkpoint = yield* taken(original);
      const copy = yield* restored(6, 20, checkpoint);
      expect(checkpoint.bytes.reduce((total, piece) => total + piece.length, 0)).toBeLessThan(uri.length);
      expect(yield* stateOf(copy)).toEqual(yield* stateOf(original));
    }),
  );
});

describe('replay after a checkpoint', () => {
  it.live(
    'answers only the queries past the frontier the previous logic handed over',
    Effect.fnUntraced(function* () {
      const original = yield* opened(6, 20);
      yield* fed(original, 'ready');
      const checkpoint = yield* taken(original);
      const tail = '\u001b[6n\u001b]10;?\u0007\u001b[c';
      yield* fed(original, tail);
      const frontier = byteOffset(offsetValue(checkpoint.position) + 4n);
      const copy = yield* restored(6, 20, checkpoint, frontier);
      const bytes = encoded(tail);
      yield* fed(copy, bytes.subarray(0, 2));
      yield* fed(copy, bytes.subarray(2));
      yield* original.interpretation.settleReplies;
      yield* copy.interpretation.settleReplies;
      expect(original.replies).toHaveLength(3);
      expect(copy.replies).toEqual(original.replies.slice(1));
    }),
  );

  it.live(
    'is taken only at rest, and replaying the bytes of an open sequence reaches the same parser state',
    Effect.fnUntraced(function* () {
      const original = yield* opened(6, 20);
      yield* fed(original, 'abc');
      const checkpoint = yield* taken(original);
      const sequences = [
        { head: '\u001b]2;ti', tail: 'tle\u0007Z' },
        { head: encoded('\u001b[1m\u042f').subarray(0, 5), tail: encoded('\u042f').subarray(1) },
        { head: '\u001b[3', tail: '1mR' },
      ];
      const atRest: boolean[] = [];
      const copy = yield* restored(6, 20, checkpoint);
      for (const { head, tail } of sequences) {
        yield* fed(original, head);
        yield* fed(copy, head);
        atRest.push((yield* original.interpretation.checkpoint()) !== undefined);
        yield* fed(original, tail);
        yield* fed(copy, tail);
      }
      expect(atRest).toEqual([false, false, false]);
      expect(yield* stateOf(copy)).toEqual(yield* stateOf(original));
    }),
  );
});
