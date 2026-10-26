import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { Effect, FileSystem, Layer, Path, Schema } from 'effect';
import { CapabilityProfile } from '@runlith/executions/protocol/capacity';
import { ExecutionRef } from '@runlith/executions/protocol/execution';
import { offsetValue, type ByteOffset, type TerminalGeometry } from '@runlith/executions/protocol/record';
import { abandonCheckpoint, checkpointScreen, keepCheckpoint, retireCheckpoint, standingCheckpoint } from './checkpointFile';
import { makeSegmentRecord } from './ExecutionRecord';
import { makeInterpretation, type Interpretation } from './Interpretation';
import { runtimeProfile } from './runtimeFixture';
import { restoreScreen } from './screenRestore';
import { screenPoint } from './screenPoint';

const platform = Layer.mergeAll(BunFileSystem.layer, BunPath.layer);
const ref = Schema.decodeUnknownSync(ExecutionRef)({ installation: 'screen-restore', execution: 'terminal', incarnation: 1 });
const born: TerminalGeometry = { rows: 6, columns: 20 };

const limitsOf = (payloadBytes?: number) => {
  const base = runtimeProfile({ rows: born.rows, columns: born.columns, scrollbackRows: 20, payloadBytes });
  const cells = (born.rows * 2 + 20) * 40;
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

const listening = (replies: string[]) => (reply: Uint8Array) =>
  Effect.sync(() => {
    replies.push(new TextDecoder().decode(reply));
    return { delivered: true, ending: false, detail: '' };
  });

const terminal = Effect.fnUntraced(function* (payloadBytes?: number) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = path.join(yield* fs.makeTempDirectoryScoped({ prefix: 'screen-restore-' }), 'records');
  const limits = limitsOf(payloadBytes);
  const record = yield* makeSegmentRecord({ mode: 'create', records: root, ref, transport: 'pty', limits, grid: born });
  const replies: string[] = [];
  const interpretation = yield* makeInterpretation({
    mode: 'open',
    ref,
    geometry: born,
    limits,
    colors: COLORS,
    reply: listening(replies),
  });
  const pump = Effect.fnUntraced(function* (text: string) {
    const bytes = new TextEncoder().encode(text);
    for (let at = 0; at < bytes.length; at += limits.output.landingBytes) {
      const slice = bytes.subarray(at, at + limits.output.landingBytes);
      yield* record.append('pty', slice);
      const parsed = yield* interpretation.burst(slice).pipe(
        Effect.match({
          onSuccess: (fed) => fed.parsed,
          onFailure: (failure) => failure.parsedThrough,
        }),
      );
      yield* record.acknowledgeParsed('pty', parsed);
    }
  });
  const restored = Effect.fnUntraced(function* (frontier?: ByteOffset) {
    const copied: string[] = [];
    const screen = yield* restoreScreen(fs, path, record, ref, limits, COLORS, listening(copied), frontier);
    return { screen, replies: copied };
  });
  return { fs, path, record, interpretation, replies, pump, restored, limits };
});

const screenOf = (interpretation: Interpretation) =>
  Effect.map(
    interpretation.read((engine) => ({
      size: [engine.cols, engine.rows],
      cursor: [engine.buffer.active.cursorX, engine.buffer.active.cursorY, engine.buffer.active.baseY],
      lines: Array.from(
        { length: engine.buffer.active.length },
        (_, row) => engine.buffer.active.getLine(row)?.translateToString(true) ?? '',
      ),
    })),
    (read) => ({ ...read.value, title: read.appearance.title }),
  );

type Linked = { readonly extended?: { readonly urlId?: number } };
type LinkService = { readonly _core: { readonly _oscLinkService: { getLinkData(id: number): { readonly uri: string } | undefined } } };

const viewOf = (interpretation: Interpretation) =>
  Effect.map(
    interpretation.read((engine) => {
      const normal = engine.buffer.normal;
      const history = Array.from({ length: normal.length - engine.rows }, (_, row) => normal.getLine(row)?.translateToString(true) ?? '');
      const links = new Set<string>();
      for (let row = 0; row < normal.length; row += 1) {
        const line = normal.getLine(row);
        for (let column = 0; line !== undefined && column < line.length; column += 1) {
          const id = (line.getCell(column) as unknown as Linked | undefined)?.extended?.urlId ?? 0;
          const uri = id === 0 ? undefined : (engine as unknown as LinkService)._core._oscLinkService.getLinkData(id)?.uri;
          if (uri !== undefined) links.add(uri);
        }
      }
      return {
        active: engine.buffer.active.type,
        modes: { ...engine.modes },
        screen: Array.from({ length: engine.rows }, (_, row) =>
          engine.buffer.active.getLine(engine.buffer.active.baseY + row)?.translateToString(true),
        ),
        cursor: [engine.buffer.active.cursorX, engine.buffer.active.cursorY],
        history,
        links: [...links],
      };
    }),
    (read) => read.value,
  );

layer(platform, { excludeTestServices: true })('a screen kept beside its record', (it) => {
  it.effect(
    'comes back through the record bytes after it, across a resize, without answering what was recorded',
    Effect.fnUntraced(function* () {
      const live = yield* terminal();
      yield* live.pump('top\r\n\u001b]2;kept\u0007\u001b[2;5r\u001b[?6h\u001b[2;3Hin region');
      const kept = yield* checkpointScreen(live.fs, live.path, live.record.directory, live.interpretation);
      yield* live.pump(' after\u001b[6n\r\nmore lines\r\n');
      const wider = { rows: 8, columns: 30 };
      yield* live.interpretation.resize(wider, yield* live.record.regrid(wider));
      yield* live.pump('\u001b[r\u001b[?6lwide lines past the old edge\r\n');
      const copy = yield* live.restored();
      const before = yield* screenOf(live.interpretation);
      expect(kept).toBe(true);
      expect(yield* screenOf(copy.screen)).toEqual(before);
      expect(before.size).toEqual([30, 8]);
      yield* live.interpretation.feed(new TextEncoder().encode('next\u001b[c'));
      yield* copy.screen.feed(new TextEncoder().encode('next\u001b[c'));
      yield* live.interpretation.settleReplies;
      yield* copy.screen.settleReplies;
      expect(yield* screenOf(copy.screen)).toEqual(yield* screenOf(live.interpretation));
      expect({ original: live.replies.length, copy: copy.replies.length }).toEqual({ original: 2, copy: 1 });
    }),
  );

  it.effect(
    'takes the size the terminal was given after its last output',
    Effect.fnUntraced(function* () {
      const live = yield* terminal();
      yield* live.pump('a line long enough to fold\r\nnext');
      yield* checkpointScreen(live.fs, live.path, live.record.directory, live.interpretation);
      yield* live.pump(' tail');
      const narrower = { rows: 5, columns: 12 };
      yield* live.interpretation.resize(narrower, yield* live.record.regrid(narrower));
      const copy = yield* live.restored();
      const screen = yield* screenOf(copy.screen);
      expect(screen).toEqual(yield* screenOf(live.interpretation));
      expect(screen.size).toEqual([12, 5]);
    }),
  );

  it.effect(
    'lays the output recorded before a resize out in the old grid, though the screen reads it after',
    Effect.fnUntraced(function* () {
      const live = yield* terminal();
      yield* live.pump('start\r\n');
      yield* checkpointScreen(live.fs, live.path, live.record.directory, live.interpretation);
      const pending = new TextEncoder().encode('\u001b[3;15HX');
      yield* live.record.append('pty', pending);
      const narrower = { rows: 6, columns: 10 };
      yield* live.interpretation.resize(narrower, yield* live.record.regrid(narrower));
      yield* live.interpretation.burst(pending);
      yield* live.pump('\r\nafter the resize');
      const copy = yield* live.restored();
      expect(yield* screenOf(copy.screen)).toEqual(yield* screenOf(live.interpretation));
    }),
  );

  it.effect(
    'keeps the newest checkpoint whatever order they land in, and none once the stream retired them',
    Effect.fnUntraced(function* () {
      const live = yield* terminal();
      yield* live.pump('first');
      const older = yield* live.interpretation.checkpoint();
      yield* live.pump(' second');
      const newer = yield* live.interpretation.checkpoint();
      if (older === undefined || newer === undefined) return yield* Effect.die(new Error('the parser was not at rest'));
      yield* keepCheckpoint(live.fs, live.path, live.record.directory, newer);
      yield* keepCheckpoint(live.fs, live.path, live.record.directory, older);
      const standing = yield* standingCheckpoint(live.fs, live.path, live.record.directory);
      expect(standing).toMatchObject({ _tag: 'Checkpoint', checkpoint: { position: newer.position } });
      yield* retireCheckpoint(live.fs, live.path, live.record.directory);
      yield* keepCheckpoint(live.fs, live.path, live.record.directory, newer);
      expect(yield* standingCheckpoint(live.fs, live.path, live.record.directory)).toEqual({ _tag: 'Absent' });
    }),
  );

  it.effect(
    'stays unavailable when the screen was given up before the change, with the reason it was given up for',
    Effect.fnUntraced(function* () {
      const live = yield* terminal(64);
      yield* live.pump(`\u001b]0;${'x'.repeat(400)}`);
      const failure = yield* live.interpretation.unavailable;
      if (failure === undefined) return yield* Effect.die(new Error('the screen was not given up'));
      yield* abandonCheckpoint(live.fs, live.path, live.record.directory, failure);
      const copy = yield* live.restored();
      const restored = yield* copy.screen.unavailable;
      expect(restored?.reason).toBe(failure.reason);
      expect(restored?.parsedThrough).toBe(failure.parsedThrough);
    }),
  );

  it.effect(
    'opens a viewer on the screen at the parser’s rest with the history it asks for and the links it carries, and on the kept screen while a sequence is open',
    Effect.fnUntraced(function* () {
      const live = yield* terminal();
      const lines = Array.from({ length: 30 }, (_, row) => `line ${row}\r\n`).join('');
      yield* live.pump(
        `${lines}\u001b]8;id=a;https://example.com/a\u001b\\linked\u001b]8;;\u001b\\\r\n\u001b[?2004h\u001b[?1h\u001b[?1000h\u001b[?1006h\u001b[?1049hon the alternate screen`,
      );
      const pointed = yield* screenPoint(live.fs, live.path, live.record, live.interpretation, live.limits, 4, COLORS);
      if (pointed._tag !== 'ScreenPoint') return yield* Effect.die(new Error(pointed.detail));
      expect(pointed.position).toBe((yield* live.record.positions('pty')).durableThrough);
      const viewer = yield* makeInterpretation({
        mode: 'open',
        ref,
        geometry: pointed.geometry,
        limits: live.limits,
        colors: COLORS,
        reply: listening([]),
      });
      yield* viewer.feed(pointed.bytes);
      const host = yield* viewOf(live.interpretation);
      const shown = yield* viewOf(viewer);
      expect(shown).toEqual({ ...host, history: host.history.slice(-4) });
      expect(shown.links).toEqual(['https://example.com/a']);

      yield* checkpointScreen(live.fs, live.path, live.record.directory, live.interpretation);
      const kept = yield* live.record.positions('pty');
      yield* live.pump('\r\nmore\u001b[');
      const limits = { ...live.limits, frame: { ...live.limits.frame, bytes: pointed.bytes.length } };
      const held = yield* screenPoint(live.fs, live.path, live.record, live.interpretation, limits, 4, COLORS);
      if (held._tag !== 'ScreenPoint') return yield* Effect.die(new Error(held.detail));
      expect(held.position).toBe(kept.durableThrough);
      yield* viewer.reset();
      yield* viewer.feed(held.bytes);
      expect(yield* viewOf(viewer)).toEqual(shown);
    }),
  );

  it.effect(
    'carries the real UTF-8 link target and refuses a frame whose expanded links do not fit',
    Effect.fnUntraced(function* () {
      const live = yield* terminal();
      const uri = `https://example.com/${'é😀$&;'.repeat(100)}`;
      yield* live.pump(`\u001b]8;id=shared;${uri}\u001b\\${'linked\r\n'.repeat(6)}\u001b]8;;\u001b\\`);
      const pointed = yield* screenPoint(live.fs, live.path, live.record, live.interpretation, live.limits, 4, COLORS);
      if (pointed._tag !== 'ScreenPoint') return yield* Effect.die(new Error(pointed.detail));
      const viewer = yield* makeInterpretation({
        mode: 'open',
        ref,
        geometry: pointed.geometry,
        limits: live.limits,
        colors: COLORS,
        reply: listening([]),
      });
      yield* viewer.feed(pointed.bytes);
      expect((yield* viewOf(viewer)).links).toEqual([uri]);
      const limits = { ...live.limits, frame: { ...live.limits.frame, bytes: pointed.bytes.length - 1 } };
      expect(yield* screenPoint(live.fs, live.path, live.record, live.interpretation, limits, 4, COLORS)).toMatchObject({
        _tag: 'ScreenUnavailable',
        reason: 'budget',
        parsedThrough: pointed.position,
      });
    }),
  );

  it.effect(
    'replays from the first byte while it is retained, and is unavailable once it is not',
    Effect.fnUntraced(function* () {
      const live = yield* terminal();
      yield* live.pump('first\r\nsecond');
      const whole = yield* live.restored();
      expect(yield* screenOf(whole.screen)).toEqual(yield* screenOf(live.interpretation));
      const line = `${'y'.repeat(18)}\r\n`;
      yield* live.pump(line.repeat(Math.ceil((live.limits.output.retainedBytes * 2) / line.length)));
      const positions = yield* live.record.positions('pty');
      const late = yield* live.restored();
      expect(offsetValue(positions.retainedFrom)).toBeGreaterThan(0n);
      expect((yield* late.screen.unavailable)?.reason).toBe('checkpoint');
    }),
  );
});
