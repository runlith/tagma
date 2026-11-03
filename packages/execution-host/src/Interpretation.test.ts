import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Deferred, Effect } from 'effect';
import { Schema } from 'effect';
import type { Terminal } from '@xterm/headless';
import { CapabilityProfile } from '@runlith/executions/protocol/capacity';
import { ExecutionRef } from '@runlith/executions/protocol/execution';
import { byteOffset, offsetValue } from '@runlith/executions/protocol/record';

import { makeInterpretation, type Interpretation } from './Interpretation';
import { Refusal } from '@runlith/executions/protocol/host';
import { refusalOf } from './refusals';
import { makePresentation } from './Presentation';
import { runtimeProfile } from './runtimeFixture';

const decodeRef = Schema.decodeUnknownSync(ExecutionRef);
const decodeProfile = Schema.decodeUnknownSync(CapabilityProfile);
const ref = decodeRef({ installation: 'installation-1', execution: 'execution-1', incarnation: 0 });

const DYNAMIC_CELL_BYTES = 2 * 84;

const profileWith = (options: Parameters<typeof runtimeProfile>[0] = {}, dynamicBytes?: number): CapabilityProfile => {
  const base = runtimeProfile(options);
  const geometry = base.execution.geometry;
  const lines = geometry.rows + geometry.scrollbackRows + geometry.rows;
  const cells = lines * geometry.columns;
  const cellBytes = 2 * cells * 12 + (dynamicBytes ?? cells * DYNAMIC_CELL_BYTES);
  return decodeProfile({
    ...base,
    execution: { ...base.execution, parser: { ...base.execution.parser, cellBytes } },
  });
};

const COLORS = {
  palette: Array.from({ length: 256 }, (_, index) => index * 0x010101),
  foreground: 0xe5e5e5,
  background: 0x000000,
  cursor: 0xe5e5e5,
};

const bytes = (text: string) => new TextEncoder().encode(text);

const geometryOf = (profile: ReturnType<typeof runtimeProfile>) => ({
  rows: profile.execution.geometry.rows,
  columns: profile.execution.geometry.columns,
});

const withInterpreter = Effect.fnUntraced(function* <A, E, R>(
  profile: ReturnType<typeof runtimeProfile>,
  body: (interpretation: Interpretation, replies: Uint8Array[]) => Effect.Effect<A, E, R>,
) {
  const replies: Uint8Array[] = [];
  const interpretation = yield* makeInterpretation({
    mode: 'open',
    ref,
    geometry: geometryOf(profile),
    limits: profile.execution,
    colors: COLORS,
    reply: (reply) =>
      Effect.sync(() => {
        replies.push(reply);
        return { delivered: true, ending: false, detail: '' };
      }),
  });
  return yield* body(interpretation, replies);
});

it.live(
  'a changed input profile refuses with both revisions and leaves the screen usable',
  Effect.fnUntraced(function* () {
    const outcome = yield* withInterpreter(profileWith({ rows: 4, columns: 20 }), (interpretation) =>
      Effect.gen(function* () {
        const before = yield* interpretation.profile();
        yield* interpretation.feed(bytes('\u001b[?2004hready'));
        const after = yield* interpretation.profile();
        const refused = yield* Effect.flip(interpretation.requireProfile(before.revision));
        const wire = yield* Schema.decodeUnknownEffect(Refusal)(refusalOf(refused));
        yield* interpretation.requireProfile(after.revision);
        const screen = yield* interpretation.read((engine) => engine.buffer.active.getLine(0)?.translateToString(true));
        return { wire, before: before.revision, after: after.revision, text: screen.value };
      }),
    );
    expect(outcome.wire).toMatchObject({ _tag: 'InputProfileConflict', actual: outcome.before, expected: outcome.after });
    expect(outcome.text).toBe('ready');
  }),
);

const withRefusedReplies = Effect.fnUntraced(function* <A, E, R>(
  profile: ReturnType<typeof runtimeProfile>,
  body: (interpretation: Interpretation) => Effect.Effect<A, E, R>,
) {
  const interpretation = yield* makeInterpretation({
    mode: 'open',
    ref,
    geometry: geometryOf(profile),
    limits: profile.execution,
    colors: COLORS,
    reply: () => Effect.succeed({ delivered: false, ending: false, detail: 'the input queue is full' }),
  });
  return yield* body(interpretation);
});

describe('the authoritative interpreter', () => {
  it.live(
    'keeps an escape split across two chunks as one sequence',
    Effect.fnUntraced(function* () {
      const profile = profileWith();
      const screen = yield* withInterpreter(profile, (interpretation) =>
        Effect.gen(function* () {
          yield* interpretation.feed(bytes('\u001b[3'));
          yield* interpretation.feed(bytes('1mred'));
          return yield* interpretation.read((engine) => engine.buffer.active.getLine(0)?.getCell(0));
        }),
      );
      expect(screen.value?.getChars()).toBe('r');
      expect(screen.value?.isFgPalette()).toBe(true);
      expect(screen.value?.getFgColor()).toBe(1);
    }),
  );

  it.live(
    'answers an application query through the reply sink with no viewer attached',
    Effect.fnUntraced(function* () {
      const profile = profileWith();
      const replies = yield* withInterpreter(profile, (interpretation, collected) =>
        Effect.gen(function* () {
          yield* interpretation.feed(bytes('\u001b[c'));
          return collected;
        }),
      );
      expect(replies.length).toBeGreaterThan(0);
      expect(new TextDecoder().decode(replies[0])).toContain('\u001b[?');
    }),
  );

  it.live(
    'ends the screen when a query answer cannot reach the child, rather than counting it',
    Effect.fnUntraced(function* () {
      const profile = profileWith();
      const outcome = yield* withRefusedReplies(profile, (interpretation) =>
        Effect.gen(function* () {
          yield* interpretation.feed(bytes('\u001b[c'));
          yield* interpretation.settleReplies;
          return yield* interpretation.unavailable;
        }),
      );
      expect(outcome).toBeDefined();
      expect(outcome?.reason).toBe('budget');
      expect(outcome?.parsedThrough).toBeDefined();
    }),
  );

  it.live(
    'answers each query once on the reply road and never prints an answer',
    Effect.fnUntraced(function* () {
      const profile = profileWith();
      const outcome = yield* withInterpreter(profile, (interpretation, collected) =>
        Effect.gen(function* () {
          const device = bytes('\u001b[c');
          const colour = bytes('\u001b]4;1;?\u0007');
          const clipboard = bytes('\u001b]52;c;aGk=\u0007');
          yield* interpretation.feed(device);
          yield* interpretation.feed(colour);
          yield* interpretation.feed(clipboard);
          const screen = yield* interpretation.read((engine) => engine.buffer.active.getLine(0)?.translateToString(true) ?? '');
          return {
            replies: collected.map((reply) => new TextDecoder().decode(reply)),
            screen,
            through: yield* interpretation.parsedThrough,
          };
        }),
      );
      expect(outcome.replies.length).toBe(2);
      expect(outcome.replies[0]).toContain('\u001b[?');
      expect(outcome.replies[1]).toBe('\u001b]4;1;rgb:0101/0101/0101\u001b\\');
      expect(outcome.screen.value).not.toContain('\u001b');
      expect(outcome.screen.value).not.toContain('rgb:');
      expect(offsetValue(outcome.through)).toBe(BigInt(3 + 8 + 12));
    }),
  );

  it.live(
    'answers a query arriving at a gone screen with the frontier, never a report',
    Effect.fnUntraced(function* () {
      const profile = profileWith({ payloadBytes: 64 });
      const outcome = yield* withInterpreter(profile, (interpretation, collected) =>
        Effect.gen(function* () {
          const broke = yield* Effect.result(interpretation.feed(bytes(`\u001b]0;${'x'.repeat(400)}`)));
          const before = collected.length;
          const asked = yield* Effect.result(interpretation.feed(bytes('\u001b[c')));
          return { broke, before, asked, after: collected.length };
        }),
      );
      expect(outcome.broke._tag).toBe('Failure');
      expect(outcome.asked._tag).toBe('Failure');
      if (outcome.broke._tag === 'Failure' && outcome.asked._tag === 'Failure') {
        expect(outcome.asked.failure.reason).toBe('budget');
        expect(offsetValue(outcome.asked.failure.parsedThrough)).toBe(offsetValue(outcome.broke.failure.parsedThrough));
      }
      expect(outcome.after).toBe(outcome.before);
    }),
  );

  it.live(
    'keeps terminal answers out of presentation frames',
    Effect.fnUntraced(function* () {
      const profile = profileWith();
      const outcome = yield* withInterpreter(profile, (interpretation, collected) =>
        Effect.gen(function* () {
          const presentation = yield* Effect.scoped(makePresentation({ interpretation, limits: profile.execution, ref }));
          yield* interpretation.feed(bytes('hello'));
          yield* interpretation.feed(bytes('\u001b[c'));
          yield* interpretation.feed(bytes('\u001b]4;1;?\u0007'));
          const frame = yield* presentation.update();
          return { frame, replies: collected.length };
        }),
      );
      expect(outcome.replies).toBe(2);
      expect(outcome.frame._tag).toBe('ScreenFrame');
      if (outcome.frame._tag !== 'ScreenFrame') return;
      const text = outcome.frame.rows.map((row) => row.cells.map((cell) => cell.chars).join('')).join('\n');
      expect(text).toContain('hello');
      const encoded = JSON.stringify(outcome.frame);
      expect(encoded).not.toContain('\u001b[?');
      expect(encoded).not.toContain('rgb:');
    }),
  );

  it.live(
    'refuses the screen before the engine can hold more payload than the profile declares',
    Effect.fnUntraced(function* () {
      const profile = profileWith({ payloadBytes: 64 });
      const outcome = yield* withInterpreter(profile, (interpretation) =>
        Effect.gen(function* () {
          const refused = yield* Effect.result(interpretation.feed(bytes(`\u001b]0;${'x'.repeat(400)}`)));
          return refused;
        }),
      );
      expect(outcome._tag).toBe('Failure');
      if (outcome._tag === 'Failure') {
        expect(outcome.failure.reason).toBe('budget');
        expect(offsetValue(outcome.failure.parsedThrough)).toBeLessThan(404n);
      }
    }),
  );

  it.live(
    'takes a terminated string sequence of any length within the allowance',
    Effect.fnUntraced(function* () {
      const profile = profileWith({ payloadBytes: 64 });
      const applied = yield* withInterpreter(profile, (interpretation) =>
        Effect.gen(function* () {
          const frontiers: bigint[] = [];
          for (let round = 0; round < 3; round += 1) {
            const through = yield* interpretation.feed(bytes(`\u001b]0;${'t'.repeat(40)}\u0007`));
            frontiers.push(offsetValue(through));
          }
          return frontiers;
        }),
      );
      expect(applied).toEqual([45n, 90n, 135n]);
    }),
  );

  const INTRODUCERS = [
    { name: 'OSC', open: '\u001b]0;' },
    { name: 'DCS', open: '\u001bP' },
    { name: 'APC', open: '\u001b_' },
    { name: 'PM', open: '\u001b^' },
    { name: 'SOS', open: '\u001bX' },
  ] as const;
  const ENDINGS = [
    { name: 'BEL', close: '\u0007', then: 'Z' },
    { name: 'ST (ESC backslash)', close: '\u001b\\', then: 'Z' },
    { name: 'ST (0x9c)', close: '\u009c', then: 'Z' },
    { name: 'CAN', close: '\u0018', then: 'Z' },
    { name: 'SUB', close: '\u001a', then: 'Z' },
    { name: 'ESC alone', close: '\u001b', then: '[0mZ' },
  ] as const;

  for (const introducer of INTRODUCERS) {
    for (const ending of ENDINGS) {
      it.live(
        `agrees with the engine on whether ${ending.name} ends ${introducer.name}`,
        Effect.fnUntraced(function* () {
          const generous = profileWith();
          const printed = yield* withInterpreter(generous, (interpretation) =>
            Effect.gen(function* () {
              yield* interpretation.feed(bytes(`${introducer.open}payload${ending.close}${ending.then}`));
              return yield* interpretation.read((engine) => (engine.buffer.active.getLine(0)?.translateToString(true) ?? '').includes('Z'));
            }),
          );

          const tight = profileWith({ payloadBytes: 64 });
          const refused = yield* withInterpreter(tight, (interpretation) =>
            Effect.gen(function* () {
              yield* Effect.result(interpretation.feed(bytes(`${introducer.open}payload${ending.close}`)));
              const outcome = yield* Effect.result(interpretation.feed(bytes('x'.repeat(400))));
              return outcome._tag === 'Failure' && outcome.failure.reason === 'budget';
            }),
          );

          expect({ ending: ending.name, guardHoldsOpen: refused }).toEqual({
            ending: ending.name,
            guardHoldsOpen: !printed.value,
          });
        }),
      );
    }
  }

  it.live(
    'does not read the continuation bytes of ordinary text as C1 controls',
    Effect.fnUntraced(function* () {
      const profile = profileWith({ payloadBytes: 64 });
      const outcome = yield* withInterpreter(profile, (interpretation) =>
        Effect.gen(function* () {
          yield* interpretation.feed(bytes('Мама мыла раму ✓'));
          const halves = bytes('Привет 🌍 мир');
          yield* interpretation.feed(halves.subarray(0, 5));
          yield* interpretation.feed(halves.subarray(5));
          const plain = yield* Effect.result(interpretation.feed(bytes('x'.repeat(400))));
          return plain;
        }),
      );
      expect(outcome._tag).toBe('Success');
    }),
  );

  it.live(
    'keeps counting a payload whose text carries continuation bytes, and cuts it at the budget',
    Effect.fnUntraced(function* () {
      const profile = profileWith({ payloadBytes: 64 });
      const outcome = yield* withInterpreter(profile, (interpretation) =>
        Effect.gen(function* () {
          const refused = yield* Effect.result(interpretation.feed(bytes(`\u001b]0;${'Мама'.repeat(60)}`)));
          return refused;
        }),
      );
      expect(outcome._tag).toBe('Failure');
      if (outcome._tag === 'Failure') expect(outcome.failure.reason).toBe('budget');
    }),
  );

  it.live(
    'carries the decoder state of a payload across a chunk boundary',
    Effect.fnUntraced(function* () {
      const profile = profileWith({ payloadBytes: 64 });
      const outcome = yield* withInterpreter(profile, (interpretation) =>
        Effect.gen(function* () {
          const whole = bytes(`\u001b]0;Мир\u001b\\`);
          yield* interpretation.feed(whole.subarray(0, 6));
          yield* interpretation.feed(whole.subarray(6));
          return yield* Effect.result(interpretation.feed(bytes('y'.repeat(400))));
        }),
      );
      expect(outcome._tag).toBe('Success');
    }),
  );

  it.live(
    'never produces a frame larger than the budget it was accounted against',
    Effect.fnUntraced(function* () {
      const profile = profileWith({ rows: 6, columns: 24, scrollbackRows: 10 });
      const outcome = yield* withInterpreter(profile, (interpretation) =>
        Effect.gen(function* () {
          const presentation = yield* Effect.scoped(makePresentation({ interpretation, limits: profile.execution, ref }));
          yield* interpretation.feed(bytes('\u001b[1;3;4;5;7;9;53m\u001b[38;2;255;255;255m\u001b[48;2;1;2;3m"\\ e\u0301 漢 🌍\u001b[0m'));
          for (let line = 0; line < 12; line += 1) yield* interpretation.feed(bytes(`\r\n"\\ ${'漢'.repeat(8)} 🌍`));
          return yield* presentation.update();
        }),
      );
      expect(outcome._tag).toBe('ScreenFrame');
      const encoded = new TextEncoder().encode(JSON.stringify(outcome)).length;
      expect(encoded).toBeLessThanOrEqual(profile.execution.frame.bytes);
    }),
  );

  const SMALL = { rows: 4, columns: 10, scrollbackRows: 4 } as const;
  const SMALL_DYNAMIC = 12288;
  const link = (uri: string) => `\u001b]8;;${uri}\u0007x\u001b]8;;\u0007`;

  type RetainingLine = { readonly _dynamicBytes: number };
  type LineRing = {
    readonly length: number;
    get(index: number): RetainingLine | undefined;
    readonly _array: ReadonlyArray<RetainingLine | undefined>;
  };
  type EngineBuffer = { readonly lines: LineRing; readonly scrollTop: number; readonly ybase: number };
  const buffersOf = (engine: Terminal): readonly EngineBuffer[] => {
    const set = (engine as unknown as { _core: { _bufferService: { buffers: { normal: EngineBuffer; alt: EngineBuffer } } } })._core
      ._bufferService.buffers;
    return [set.normal, set.alt];
  };
  const walk = (engine: Terminal): number => {
    let total = 0;
    for (const buffer of buffersOf(engine)) {
      for (let index = 0; index < buffer.lines.length; index += 1) {
        const line = buffer.lines.get(index);
        if (line !== undefined) total += line._dynamicBytes;
      }
    }
    return total;
  };
  const styled = (cells: number) => `\u001b[4:3m${'e\u0301'.repeat(cells)}\u001b[0m`;

  it.live(
    'storage: the running line total equals a walk of both buffers through every road a line leaves by',
    Effect.fnUntraced(function* () {
      const profile = profileWith(SMALL);
      const readings = yield* withInterpreter(profile, (interpretation) =>
        Effect.gen(function* () {
          const seen: Array<{ step: string; running: number; walked: number }> = [];
          const after = (step: string) =>
            Effect.map(
              interpretation.read((engine) => ({ step, running: engine.dynamicStorage?.lineBytes ?? -1, walked: walk(engine) })),
              (reading) => {
                seen.push(reading.value);
              },
            );

          yield* after('fresh');
          for (let line = 0; line < 4; line += 1) yield* interpretation.feed(bytes(`${styled(7)}\r\n`));
          yield* after('written');
          for (let line = 0; line < 40; line += 1) yield* interpretation.feed(bytes(`${styled(7)} L${line}\r\n`));
          yield* after('scrolled past the cap');
          yield* interpretation.feed(bytes('\u001b[2;3r'));
          for (let line = 0; line < 20; line += 1) yield* interpretation.feed(bytes(`${styled(6)} R${line}\r\n`));
          yield* after('scrolled inside a region');
          for (let round = 0; round < 6; round += 1) {
            yield* interpretation.feed(bytes(`\u001b[3;1H\u001b[L${styled(4)}\u001b[2;1H\u001b[M`));
          }
          yield* after('inserted and deleted lines');
          yield* interpretation.feed(bytes('\u001b[r'));
          yield* interpretation.feed(bytes('\u001b[?1049h'));
          for (let line = 0; line < 3; line += 1) yield* interpretation.feed(bytes(`${styled(7)}\r\n`));
          yield* after('on the alternate screen');
          yield* interpretation.feed(bytes('\u001b[?1049l'));
          yield* after('back on the normal screen');
          yield* interpretation.resize({ rows: 4, columns: 6 }, byteOffset(0n));
          yield* after('narrowed');
          yield* interpretation.resize({ rows: 4, columns: 10 }, byteOffset(0n));
          yield* after('widened');
          yield* interpretation.resize({ rows: 2, columns: 10 }, byteOffset(0n));
          yield* after('shortened');
          yield* interpretation.trim(2);
          yield* after('trimmed');
          yield* interpretation.reset();
          yield* after('reset');
          return seen;
        }),
      );

      expect(readings.filter((reading) => reading.running !== reading.walked)).toEqual([]);
      expect(readings.filter((reading) => reading.walked > 0).map((reading) => reading.step)).toContain('scrolled past the cap');
      expect(readings.at(-1)).toEqual({ step: 'reset', running: 0, walked: 0 });
    }),
  );

  it.live(
    'storage: a trim drops the oldest rows, keeps the scroll region, and releases what left',
    Effect.fnUntraced(function* () {
      const profile = profileWith(SMALL);
      const outcome = yield* withInterpreter(profile, (interpretation) =>
        Effect.gen(function* () {
          yield* interpretation.feed(bytes(`${link('https://example.com/aaaaaaaaaaaaaaaaaaaa')} ${styled(5)}`));
          for (let line = 0; line < 6; line += 1) yield* interpretation.feed(bytes(`\r\n${styled(5)} K${line}`));
          yield* interpretation.feed(bytes('\u001b[2;3r'));
          const before = yield* interpretation.read((engine) => ({
            lines: engine.buffer.normal.length,
            base: engine.buffer.normal.baseY,
            scrollTop: buffersOf(engine)[0]?.scrollTop ?? -1,
            walked: walk(engine),
            links: engine.dynamicStorage?.linkBytes ?? -1,
            screen: Array.from(
              { length: engine.rows },
              (_, row) => engine.buffer.active.getLine(engine.buffer.active.baseY + row)?.translateToString(true) ?? '',
            ).join('\n'),
          }));
          const retainedBefore = yield* interpretation.retained();
          const dropped = yield* interpretation.trim(2);
          const retainedAfter = yield* interpretation.retained();
          const after = yield* interpretation.read((engine) => ({
            lines: engine.buffer.normal.length,
            base: engine.buffer.normal.baseY,
            scrollTop: buffersOf(engine)[0]?.scrollTop ?? -1,
            walked: walk(engine),
            links: engine.dynamicStorage?.linkBytes ?? -1,
            screen: Array.from(
              { length: engine.rows },
              (_, row) => engine.buffer.active.getLine(engine.buffer.active.baseY + row)?.translateToString(true) ?? '',
            ).join('\n'),
            columns: engine.cols,
          }));
          const rest = yield* interpretation.trim(1000);
          const emptied = yield* interpretation.read((engine) => engine.buffer.normal.baseY);
          return { before: before.value, retainedBefore, dropped, retainedAfter, after: after.value, rest, emptied: emptied.value };
        }),
      );

      expect(outcome.dropped).toBe(2);
      expect(outcome.after.base).toBe(outcome.before.base - 2);
      expect(outcome.after.lines).toBe(outcome.before.lines - 2);
      expect(outcome.after.scrollTop).toBe(outcome.before.scrollTop);
      expect(outcome.before.scrollTop).toBe(1);
      expect(outcome.after.screen).toBe(outcome.before.screen);
      expect(outcome.after.walked).toBeLessThan(outcome.before.walked);
      expect(outcome.before.links).toBeGreaterThan(0);
      expect(outcome.after.links).toBe(0);
      expect(outcome.retainedBefore - outcome.retainedAfter).toBe(
        2 * outcome.after.columns * 12 + (outcome.before.walked - outcome.after.walked) + (outcome.before.links - outcome.after.links),
      );
      expect(outcome.rest).toBe(outcome.after.base);
      expect(outcome.emptied).toBe(0);
    }),
  );

  it.live(
    'storage: the rows a trim dropped leave the ring: their slots are vacated and no slot holds them',
    Effect.fnUntraced(function* () {
      const profile = profileWith(SMALL);
      const outcome = yield* withInterpreter(profile, (interpretation) =>
        Effect.gen(function* () {
          for (let line = 0; line < 6; line += 1) yield* interpretation.feed(bytes(`${styled(5)} C${line}\r\n`));
          const dropped = yield* interpretation.read((engine) => {
            const ring = buffersOf(engine)[0]?.lines;
            if (ring === undefined) return [];
            return [0, 1].map((index) => ring.get(index) as object);
          });
          yield* interpretation.trim(2);
          const left = yield* interpretation.read((engine) => {
            const ring = buffersOf(engine)[0]?.lines;
            if (ring === undefined) return { vacated: -1, held: -1 };
            const slots: readonly unknown[] = ring._array;
            return {
              vacated: slots.filter((slot) => slot === undefined).length,
              held: dropped.value.filter((row) => slots.includes(row)).length,
            };
          });
          return { dropped: dropped.value.length, ...left.value };
        }),
      );
      expect(outcome.dropped).toBe(2);
      expect(outcome.vacated).toBeGreaterThanOrEqual(2);
      expect(outcome.held).toBe(0);
    }),
  );

  it.live(
    'storage: answers what a gone screen still holds, and can still be trimmed',
    Effect.fnUntraced(function* () {
      const profile = profileWith(SMALL, SMALL_DYNAMIC);
      const outcome = yield* withInterpreter(profile, (interpretation) =>
        Effect.gen(function* () {
          for (let line = 0; line < 6; line += 1) yield* interpretation.feed(bytes(`${'e\u0301'.repeat(9)}\r\n`));
          const standing = yield* interpretation.retained();
          const broke = yield* Effect.result(interpretation.feed(bytes(`e${'\u0301'.repeat(300)}`)));
          const gone = yield* interpretation.retained();
          const dropped = yield* interpretation.trim(2);
          const afterTrim = yield* interpretation.retained();
          return { standing, broke: broke._tag, gone, dropped, afterTrim };
        }),
      );
      expect(outcome.broke).toBe('Failure');
      expect(outcome.standing).toBeGreaterThan(0);
      expect(outcome.gone).toBeGreaterThanOrEqual(outcome.standing);
      expect(outcome.dropped).toBe(2);
      expect(outcome.afterTrim).toBeLessThan(outcome.gone);
    }),
  );

  it.live(
    'storage: refuses the screen when a cell grows past the line budget, at the frontier it was true through',
    Effect.fnUntraced(function* () {
      const profile = profileWith(SMALL, SMALL_DYNAMIC);
      const outcome = yield* withInterpreter(profile, (interpretation) =>
        Effect.gen(function* () {
          const settled = yield* interpretation.feed(bytes('ok'));
          const admission = interpretation.requireProfile(0);
          const refused = yield* Effect.result(interpretation.feed(bytes(`e${'\u0301'.repeat(300)}`)));
          return {
            settled,
            refused,
            doors: {
              feed: yield* Effect.result(interpretation.feed(bytes('more'))),
              read: yield* Effect.result(interpretation.read((engine) => engine.rows)),
              resize: yield* Effect.result(interpretation.resize({ rows: 4, columns: 8 }, byteOffset(0n))),
              reset: yield* Effect.result(interpretation.reset()),
              profile: yield* Effect.result(admission),
            },
          };
        }),
      );
      expect(outcome.refused._tag).toBe('Failure');
      if (outcome.refused._tag === 'Failure') {
        expect(outcome.refused.failure.reason).toBe('budget');
        expect(offsetValue(outcome.refused.failure.parsedThrough)).toBe(offsetValue(outcome.settled));
      }
      expect(
        Object.entries(outcome.doors).map(([door, result]) => [
          door,
          result._tag === 'Failure'
            ? result.failure._tag === 'InterpretationUnavailable'
              ? `${result.failure.reason}@${offsetValue(result.failure.parsedThrough)}`
              : result.failure._tag
            : 'Success',
        ]),
      ).toEqual([
        ['feed', `budget@${offsetValue(outcome.settled)}`],
        ['read', `budget@${offsetValue(outcome.settled)}`],
        ['resize', `budget@${offsetValue(outcome.settled)}`],
        ['reset', `budget@${offsetValue(outcome.settled)}`],
        ['profile', `budget@${offsetValue(outcome.settled)}`],
      ]);
    }),
  );

  it.live(
    'storage: reclaims a line erased by the application, and refuses a profile it can no longer hold',
    Effect.fnUntraced(function* () {
      const profile = profileWith(SMALL, SMALL_DYNAMIC);
      const outcome = yield* withInterpreter(profile, (interpretation) =>
        Effect.gen(function* () {
          for (let round = 0; round < 4; round += 1) {
            yield* interpretation.feed(bytes(`e${'\u0301'.repeat(200)}`));
            yield* interpretation.feed(bytes('\u001b[2J\u001b[H'));
          }
          const held = yield* interpretation.unavailable;
          const wider = yield* Effect.result(interpretation.resize({ rows: 4, columns: 40 }, byteOffset(0n)));
          return { held, wider };
        }),
      );
      expect(outcome.held).toBeUndefined();
      expect(outcome.wider._tag).toBe('Failure');
      if (outcome.wider._tag === 'Failure') expect(outcome.wider.failure.reason).toBe('profile');
    }),
  );

  it.live(
    'storage: reflows into a narrower screen inside the budget that reserved both layouts',
    Effect.fnUntraced(function* () {
      const profile = profileWith(SMALL, SMALL_DYNAMIC);
      const outcome = yield* withInterpreter(profile, (interpretation) =>
        Effect.gen(function* () {
          yield* interpretation.feed(bytes('e\u0301'.repeat(24)));
          yield* interpretation.resize({ rows: 4, columns: 6 }, byteOffset(0n));
          yield* interpretation.feed(bytes('\r\nafter'));
          return yield* interpretation.read((engine) => engine.cols);
        }),
      );
      expect(outcome.value).toBe(6);
    }),
  );

  it.live(
    'storage: survives a production-scale resize storm inside its derived budget',
    Effect.fnUntraced(function* () {
      const profile = profileWith({ rows: 60, columns: 160, scrollbackRows: 1000 });
      const outcome = yield* withInterpreter(profile, (interpretation) =>
        Effect.gen(function* () {
          for (let i = 0; i < 1200; i += 1) {
            const linked = i % 10 === 0 ? link(`https://example.com/${String(i).padStart(36, '0')}`) : '';
            yield* interpretation.feed(
              bytes(`L${String(i).padStart(4, '0')} \u001b[4:3m${'e\u0301'.repeat(60)}\u001b[0m${'x'.repeat(80)}${linked}\r\n`),
            );
          }
          const fed = offsetValue(yield* interpretation.parsedThrough);
          const links = interpretation.engine.dynamicStorage?.linkBytes ?? 0;
          const legs: Array<{ geometry: { rows: number; columns: number }; resized: string; frontierKept: boolean }> = [];
          for (const columns of [40, 200, 160]) {
            const geometry = { rows: 60, columns };
            const before = offsetValue(yield* interpretation.parsedThrough);
            const resized = yield* Effect.result(interpretation.resize(geometry, byteOffset(0n)));
            const after = offsetValue(yield* interpretation.parsedThrough);
            legs.push({ geometry, resized: resized._tag, frontierKept: before === after });
            if (resized._tag === 'Failure') break;
          }
          const read = yield* interpretation.read((engine) => ({
            cols: engine.cols,
            rows: engine.rows,
            text: Array.from(
              { length: engine.buffer.active.length },
              (_, line) => engine.buffer.active.getLine(line)?.translateToString(true) ?? '',
            ).join('\n'),
          }));
          const narrowBefore = offsetValue(yield* interpretation.parsedThrough);
          const narrow = yield* Effect.result(interpretation.resize({ rows: 60, columns: 2 }, byteOffset(0n)));
          const narrowAfter = offsetValue(yield* interpretation.parsedThrough);
          const dims = yield* interpretation.read((engine) => ({ cols: engine.cols, rows: engine.rows }));
          const continued = yield* Effect.result(interpretation.feed(bytes('after')));
          const through = offsetValue(yield* interpretation.parsedThrough);
          return { fed, links, legs, read, narrow, narrowKept: narrowBefore === narrowAfter, dims, continued, through };
        }),
      );
      expect(outcome.links).toBeGreaterThan(0);
      expect(outcome.legs.map((leg) => [leg.geometry.columns, leg.resized, leg.frontierKept])).toEqual([
        [40, 'Success', true],
        [200, 'Success', true],
        [160, 'Success', true],
      ]);
      expect(outcome.read.value.cols).toBe(160);
      expect(outcome.read.value.rows).toBe(60);
      const unbroken = outcome.read.value.text.replace(/\n/g, '');
      const positions = ['L1050', 'L1100', 'L1150', 'L1199'].map((marker) => ({
        at: unbroken.indexOf(marker),
        count: unbroken.split(marker).length - 1,
      }));
      expect(positions.every((position) => position.at >= 0 && position.count === 1)).toBe(true);
      expect(positions.map((position) => position.at)).toEqual([...positions.map((position) => position.at)].sort((a, b) => a - b));
      expect(outcome.narrow._tag).toBe('Success');
      expect(outcome.narrowKept).toBe(true);
      expect(outcome.dims.value).toEqual({ cols: 2, rows: 60 });
      expect(outcome.continued._tag).toBe('Success');
      expect(outcome.through).toBe(outcome.fed + 5n);
    }),
  );

  it.live(
    'storage: refuses a storm the derived budget cannot cover, naming the arithmetic',
    Effect.fnUntraced(function* () {
      const profile = profileWith(SMALL, SMALL_DYNAMIC);
      const outcome = yield* withInterpreter(profile, (interpretation) =>
        Effect.gen(function* () {
          for (let i = 0; i < 16; i += 1) yield* interpretation.feed(bytes(`${'e\u0301'.repeat(9)}\r\n`));
          const narrow = yield* Effect.result(interpretation.resize({ rows: 4, columns: 4 }, byteOffset(0n)));
          const before = offsetValue(yield* interpretation.parsedThrough);
          const wide = yield* Effect.result(interpretation.resize({ rows: 4, columns: 20 }, byteOffset(0n)));
          const failed = yield* interpretation.unavailable;
          return { narrow, before, wide, failed };
        }),
      );
      expect(outcome.narrow._tag).toBe('Success');
      expect(outcome.wide._tag).toBe('Failure');
      if (outcome.wide._tag === 'Failure') {
        expect(outcome.wide.failure.reason).toBe('profile');
        expect(outcome.wide.failure.detail).toContain('parser.cellBytes');
        expect(offsetValue(outcome.wide.failure.parsedThrough)).toBe(outcome.before);
      }
      expect(outcome.failed?.reason).toBe('profile');
    }),
  );

  it.live(
    'storage: refuses a profile its own cell arrays do not fit before any engine exists',
    Effect.fnUntraced(function* () {
      const failure = yield* Effect.flip(withInterpreter(profileWith(SMALL, 512), () => Effect.void));
      expect(failure._tag).toBe('InterpretationUnavailable');
      expect(failure.reason).toBe('profile');
    }),
  );

  it.live(
    'storage: keeps interpreting combining text as the buffer recycles its lines',
    Effect.fnUntraced(function* () {
      const profile = profileWith(SMALL, SMALL_DYNAMIC);
      const outcome = yield* withInterpreter(profile, (interpretation) =>
        Effect.gen(function* () {
          for (let line = 0; line < 40; line += 1) yield* interpretation.feed(bytes(`${'e\u0301'.repeat(9)}\r\n`));
          return yield* interpretation.read(
            (engine) => engine.buffer.active.getLine(engine.buffer.active.baseY + 2)?.translateToString(true) ?? '',
          );
        }),
      );
      expect(outcome.value).toContain('e\u0301');
    }),
  );

  it.live(
    'storage: charges what a line HOLDS, not every cell it was ever written through',
    Effect.fnUntraced(function* () {
      const profile = profileWith(SMALL, SMALL_DYNAMIC);
      const outcome = yield* withInterpreter(profile, (interpretation) =>
        Effect.gen(function* () {
          for (let column = 1; column <= 10; column += 1) {
            yield* interpretation.feed(bytes(`\u001b[${column}G\u001b[4:3me${'\u0301'.repeat(20)}\u001b[0m`));
            yield* interpretation.feed(bytes('\u001b[2K'));
          }
          return yield* interpretation.unavailable;
        }),
      );
      expect(outcome).toBeUndefined();
    }),
  );

  it.live(
    'storage: refuses a repeat that would allocate more than one parse may hold',
    Effect.fnUntraced(function* () {
      const profile = profileWith(SMALL, SMALL_DYNAMIC);
      const outcome = yield* withInterpreter(profile, (interpretation) =>
        Effect.gen(function* () {
          yield* interpretation.feed(bytes('x'));
          return yield* Effect.result(interpretation.feed(bytes('\u001b[50000000b')));
        }),
      );
      expect(outcome._tag).toBe('Failure');
      if (outcome._tag === 'Failure') {
        expect(outcome.failure.reason).toBe('budget');
        expect(outcome.failure.detail).toContain('repeat');
      }
    }),
  );

  it.live(
    'storage: refuses the screen when retained link data passes the budget',
    Effect.fnUntraced(function* () {
      const profile = profileWith(SMALL, SMALL_DYNAMIC);
      const outcome = yield* withInterpreter(profile, (interpretation) =>
        Effect.gen(function* () {
          const rounds = [];
          for (const mark of ['a', 'b']) {
            rounds.push(yield* Effect.result(interpretation.feed(bytes(link(`https://example.com/${mark.repeat(20)}`)))));
          }
          return rounds;
        }),
      );
      expect(outcome.map((round) => round._tag)).toEqual(['Success', 'Failure']);
      const refused = outcome[1];
      if (refused?._tag === 'Failure') {
        expect(refused.failure.reason).toBe('budget');
        expect(refused.failure.detail).toContain('link');
      }
    }),
  );

  it.live(
    'storage: releases retained link data once the lines holding it leave the buffer',
    Effect.fnUntraced(function* () {
      const profile = profileWith(SMALL, SMALL_DYNAMIC);
      const outcome = yield* withInterpreter(profile, (interpretation) =>
        Effect.gen(function* () {
          for (let round = 0; round < 5; round += 1) {
            yield* interpretation.feed(bytes(link(`https://example.com/${String(round).repeat(20)}`)));
            yield* interpretation.feed(bytes('\r\n'.repeat(16)));
          }
          return yield* interpretation.unavailable;
        }),
      );
      expect(outcome).toBeUndefined();
    }),
  );

  it.live(
    'storage: refuses a profile whose cell budget cannot hold one decoration a column',
    Effect.fnUntraced(function* () {
      const profile = profileWith(SMALL, 0);
      const failure = yield* Effect.flip(
        makeInterpretation({
          mode: 'open',
          ref,
          geometry: geometryOf(profile),
          limits: profile.execution,
          colors: COLORS,
          reply: () => Effect.succeed({ delivered: true, ending: false, detail: '' }),
        }),
      );
      expect(failure.reason).toBe('profile');
      expect(failure.detail).toContain('cellBytes');
    }),
  );
});

describe('a reply the input queue has no room for', () => {
  const pressed = Effect.fnUntraced(function* (profile: ReturnType<typeof runtimeProfile>, settleFirst: boolean) {
    const room = yield* Deferred.make<void>();
    const refused = yield* Deferred.make<void>();
    const handed = yield* Deferred.make<void>();
    const delivered: Array<{ readonly text: string; readonly settling: boolean }> = [];
    const interpretation = yield* makeInterpretation({
      mode: 'open',
      ref,
      geometry: geometryOf(profile),
      limits: profile.execution,
      colors: COLORS,
      reply: Effect.fnUntraced(function* (reply, settling) {
        if (!settling && !(yield* Deferred.isDone(room))) {
          yield* Deferred.succeed(refused, undefined);
          return { delivered: false, ending: false, detail: 'the input queue is full', room: Deferred.await(room) };
        }
        delivered.push({ text: new TextDecoder().decode(reply), settling });
        yield* Deferred.succeed(handed, undefined);
        return { delivered: true, ending: false, detail: '' };
      }),
    });
    yield* interpretation.feed(bytes('\u001b[6n'));
    yield* Deferred.await(refused);
    if (settleFirst) yield* interpretation.settleReplies;
    else yield* Deferred.succeed(room, undefined);
    yield* Deferred.await(handed);
    yield* interpretation.settleReplies;
    return { delivered, unavailable: yield* interpretation.unavailable };
  });

  it.live(
    'stays queued and goes once the queue has room',
    Effect.fnUntraced(function* () {
      const outcome = yield* pressed(profileWith({ rows: 4, columns: 20 }), false);
      expect(outcome.delivered).toEqual([{ text: '\u001b[1;1R', settling: false }]);
      expect(outcome.unavailable).toBeUndefined();
    }),
  );

  it.live(
    'goes once into the departing queue when the replies are settled',
    Effect.fnUntraced(function* () {
      const outcome = yield* pressed(profileWith({ rows: 4, columns: 20 }), true);
      expect(outcome.delivered).toEqual([{ text: '\u001b[1;1R', settling: true }]);
    }),
  );
});
