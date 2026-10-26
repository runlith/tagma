import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Fiber, Schema } from 'effect';
import { ExecutionRef } from '@runlith/executions/protocol/execution';
import type { ScreenFeedItem, PaintProgram } from '@runlith/executions/protocol/presentation';
import { byteOffset } from '@runlith/executions/protocol/record';
import { makeInterpretation, type Interpretation, type InterpretationUnavailable } from './Interpretation';
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

const bytes = (text: string) => new TextEncoder().encode(text);

const profile = runtimeProfile({ rows: 4, columns: 20, scrollbackRows: 2, transports: ['pty'] });

const programOf = (update: ScreenFeedItem | undefined): PaintProgram => {
  if (update?._tag === 'ScreenProgramFrame' || update?._tag === 'ScreenProgramPatch') return update.program;
  throw new Error(`expected a program update, got ${update?._tag}`);
};

const stepTags = (update: ScreenFeedItem | undefined): ReadonlyArray<string> => programOf(update).steps.map((step) => step._tag);

const writeData = (update: ScreenFeedItem | undefined): string =>
  programOf(update)
    .steps.filter((step) => step._tag === 'Write')
    .map((step) => (step._tag === 'Write' ? step.data : ''))
    .join('');

const wireBytes = (update: ScreenFeedItem | undefined): number => new TextEncoder().encode(JSON.stringify(update)).length;

const display = (update: ScreenFeedItem | undefined): string =>
  update?._tag === 'ScreenFrame'
    ? update.rows
        .filter((row) => row.line >= update.geometry.viewportLine)
        .map((row) => row.cells.map((cell) => cell.chars).join(''))
        .join('\n')
    : `not a frame: ${update?._tag}`;

type ScreenFixture = {
  readonly interpretation: Interpretation;
  readonly presentation: Presentation;
};

const withScreen = Effect.fnUntraced(function* <A, E, R>(body: (screen: ScreenFixture) => Effect.Effect<A, E, R>) {
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

const fed = (screen: ScreenFixture, text: string) =>
  Effect.flatMap(screen.interpretation.feed(bytes(text)), () => screen.presentation.invalidate());

describe('a viewer is answered against the base it holds', () => {
  it.effect('gives two viewers their own bases, and patches each against its own', () =>
    Effect.gen(function* () {
      const outcome = yield* withScreen(({ presentation, ...rest }) =>
        Effect.gen(function* () {
          const screen = { presentation, ...rest };
          const first = yield* presentation.openViewer();
          yield* fed(screen, 'one');
          yield* presentation.grant(first, 1);
          const opening = yield* presentation.next(first);

          const second = yield* presentation.openViewer();
          yield* fed(screen, '\r\ntwo');
          yield* presentation.grant(first, 1);
          yield* presentation.grant(second, 1);
          const patched = yield* presentation.next(first);
          const joined = yield* presentation.next(second);

          yield* fed(screen, '\r\nthree');
          yield* presentation.grant(second, 1);
          const followed = yield* presentation.next(second);
          return { opening, patched, joined, followed };
        }),
      );

      expect(outcome.opening?._tag).toBe('ScreenProgramFrame');
      expect(outcome.patched?._tag).toBe('ScreenProgramPatch');
      expect(outcome.joined?._tag).toBe('ScreenProgramFrame');
      expect(outcome.followed?._tag).toBe('ScreenProgramPatch');
      if (outcome.patched?._tag === 'ScreenProgramPatch' && outcome.opening?._tag === 'ScreenProgramFrame') {
        expect(outcome.patched.provenance.base).toBe(outcome.opening.provenance.revision);
      }
      if (outcome.followed?._tag === 'ScreenProgramPatch' && outcome.joined?._tag === 'ScreenProgramFrame') {
        expect(outcome.followed.provenance.base).toBe(outcome.joined.provenance.revision);
      }
      if (outcome.patched?._tag === 'ScreenProgramPatch') {
        expect(stepTags(outcome.patched)).toEqual(['Write']);
        expect(writeData(outcome.patched)).toContain('two');
      }
    }),
  );

  it.effect('produces and encodes once per revision, however many viewers stand on its base', () =>
    Effect.gen(function* () {
      const outcome = yield* withScreen(({ presentation, ...rest }) =>
        Effect.gen(function* () {
          const screen = { presentation, ...rest };
          const first = yield* presentation.openViewer();
          const second = yield* presentation.openViewer();
          yield* fed(screen, 'shared');
          yield* presentation.grant(first, 1);
          yield* presentation.grant(second, 1);
          const one = yield* presentation.next(first);
          const two = yield* presentation.next(second);
          yield* fed(screen, '\r\nshared-again');
          yield* presentation.grant(first, 1);
          yield* presentation.grant(second, 1);
          const three = yield* presentation.next(first);
          const four = yield* presentation.next(second);
          return { one, two, three, four };
        }),
      );

      expect(outcome.one?._tag).toBe('ScreenProgramFrame');
      expect(outcome.two).toBe(outcome.one);
      expect(outcome.three?._tag).toBe('ScreenProgramPatch');
      expect(outcome.four).toBe(outcome.three);
      if (outcome.three?._tag === 'ScreenProgramPatch' && outcome.one?._tag === 'ScreenProgramFrame') {
        expect(outcome.three.provenance.base).toBe(outcome.one.provenance.revision);
      }
    }),
  );

  it.effect('says an appended line as a scroll, in bytes rather than in viewports', () =>
    Effect.gen(function* () {
      const outcome = yield* withScreen(({ presentation, ...rest }) =>
        Effect.gen(function* () {
          const screen = { presentation, ...rest };
          const viewer = yield* presentation.openViewer();
          yield* fed(screen, 'l0\r\nl1\r\nl2\r\nl3\r\nl4\r\nl5');
          yield* presentation.grant(viewer, 1);
          const held = yield* presentation.next(viewer);
          yield* fed(screen, '\r\nl6');
          yield* presentation.grant(viewer, 1);
          const moved = yield* presentation.next(viewer);
          return { held, moved };
        }),
      );

      expect(outcome.held?._tag).toBe('ScreenProgramFrame');
      expect(outcome.moved?._tag).toBe('ScreenProgramPatch');
      if (outcome.moved?._tag !== 'ScreenProgramPatch' || outcome.held?._tag !== 'ScreenProgramFrame') return;
      expect(stepTags(outcome.moved)).toEqual(['Scroll', 'Write']);
      const scroll = programOf(outcome.moved).steps[0];
      expect(scroll).toMatchObject({ _tag: 'Scroll', top: 1, bottom: 4, lines: 1 });
      expect(writeData(outcome.moved)).toContain('l6');
      expect(outcome.moved.provenance.base).toBe(outcome.held.provenance.revision);
      expect(wireBytes(outcome.moved)).toBeLessThan(2048);
    }),
  );

  it.effect('holds one frame in flight and skips to the newest screen rather than queuing what was missed', () =>
    Effect.gen(function* () {
      const outcome = yield* withScreen(({ presentation, ...rest }) =>
        Effect.gen(function* () {
          const screen = { presentation, ...rest };
          const viewer = yield* presentation.openViewer();
          yield* presentation.grant(viewer, 1);
          const first = yield* presentation.next(viewer);
          const refusedCredit = yield* Effect.result(presentation.grant(viewer, 2));
          yield* fed(screen, '\r\nalpha');
          yield* fed(screen, '\r\nbeta');
          yield* fed(screen, '\r\ngamma');
          const withoutCredit = yield* presentation.next(viewer);
          yield* presentation.grant(viewer, 1);
          const next = yield* presentation.next(viewer);
          const exhausted = yield* presentation.next(viewer);
          return { first, refusedCredit, withoutCredit, next, exhausted };
        }),
      );

      expect(outcome.first?._tag).toBe('ScreenProgramFrame');
      expect(outcome.refusedCredit._tag).toBe('Failure');
      if (outcome.refusedCredit._tag === 'Failure') expect(outcome.refusedCredit.failure._tag).toBe('FrameCreditRefused');
      expect(outcome.withoutCredit).toBeUndefined();
      expect(outcome.next?._tag).toBe('ScreenProgramPatch');
      expect(writeData(outcome.next)).toContain('gamma');
      expect(outcome.exhausted).toBeUndefined();
    }),
  );

  it.effect('answers a display that scrolled under a viewer with a whole frame', () =>
    Effect.gen(function* () {
      const outcome = yield* withScreen(({ presentation, ...rest }) =>
        Effect.gen(function* () {
          const screen = { presentation, ...rest };
          const viewer = yield* presentation.openViewer();
          yield* fed(screen, 'a\r\nb');
          yield* presentation.grant(viewer, 1);
          const held = yield* presentation.next(viewer);
          yield* fed(screen, '\r\nc\r\nd\r\ne\r\nf\r\ng');
          yield* presentation.grant(viewer, 1);
          const moved = yield* presentation.next(viewer);
          return { held, moved };
        }),
      );

      expect(outcome.held?._tag).toBe('ScreenProgramFrame');
      expect(outcome.moved?._tag).toBe('ScreenProgramFrame');
    }),
  );

  it.effect('answers a resize with a whole frame, not an ending', () =>
    Effect.gen(function* () {
      const outcome = yield* withScreen(({ presentation, interpretation, ...rest }) =>
        Effect.gen(function* () {
          const screen = { presentation, interpretation, ...rest };
          const viewer = yield* presentation.openViewer();
          yield* fed(screen, 'hello');
          yield* presentation.grant(viewer, 1);
          const held = yield* presentation.next(viewer);
          yield* interpretation.resize({ rows: 4, columns: 16 }, byteOffset(0n));
          yield* presentation.invalidate();
          yield* presentation.grant(viewer, 1);
          const moved = yield* presentation.next(viewer);
          return { held, moved };
        }),
      );

      expect(outcome.held?._tag).toBe('ScreenProgramFrame');
      expect(outcome.moved?._tag).toBe('ScreenProgramFrame');
      if (outcome.moved?._tag !== 'ScreenProgramFrame') return;
      expect(outcome.moved.geometry.rows).toBe(4);
      expect(outcome.moved.geometry.columns).toBe(16);
      expect(outcome.moved.program.steps.some((step) => step._tag === 'Reset')).toBe(true);
    }),
  );

  it.effect('answers a viewer whose history was trimmed a whole frame, with the display it already had', () =>
    Effect.gen(function* () {
      const outcome = yield* withScreen(({ presentation, interpretation, ...rest }) =>
        Effect.gen(function* () {
          const screen = { presentation, interpretation, ...rest };
          const viewer = yield* presentation.openViewer();
          yield* fed(screen, 'l0\r\nl1\r\nl2\r\nl3\r\nl4\r\nl5');
          yield* presentation.grant(viewer, 1);
          const held = yield* presentation.next(viewer);
          const before = yield* presentation.update();
          const dropped = yield* interpretation.trim(1);
          yield* presentation.invalidate();
          yield* presentation.grant(viewer, 1);
          const moved = yield* presentation.next(viewer);
          const after = yield* presentation.update();
          return { held, dropped, moved, before, after };
        }),
      );

      expect(outcome.dropped).toBe(1);
      expect(outcome.held?._tag).toBe('ScreenProgramFrame');
      expect(outcome.moved?._tag).toBe('ScreenProgramFrame');
      if (outcome.moved?._tag !== 'ScreenProgramFrame' || outcome.held?._tag !== 'ScreenProgramFrame') return;
      expect(outcome.moved.geometry.viewportLine).toBe(outcome.held.geometry.viewportLine - outcome.dropped);
      expect(outcome.moved.geometry.firstLine).toBe(outcome.held.geometry.firstLine - outcome.dropped);
      expect(display(outcome.after)).toBe(display(outcome.before));
    }),
  );

  it.effect('resumes from a live base with a patch against it', () =>
    Effect.gen(function* () {
      const outcome = yield* withScreen(({ presentation, ...rest }) =>
        Effect.gen(function* () {
          const screen = { presentation, ...rest };
          const first = yield* presentation.openViewer();
          yield* fed(screen, 'one');
          yield* presentation.grant(first, 1);
          const held = yield* presentation.next(first);
          yield* fed(screen, '\r\ntwo');
          const resumed = yield* presentation.openViewer(
            held?._tag === 'ScreenProgramFrame' || held?._tag === 'ScreenProgramPatch' ? held.provenance.revision : undefined,
          );
          yield* presentation.grant(resumed, 1);
          const next = yield* presentation.next(resumed);
          return { held, next };
        }),
      );

      expect(outcome.held?._tag).toBe('ScreenProgramFrame');
      expect(outcome.next?._tag).toBe('ScreenProgramPatch');
      if (outcome.held?._tag !== 'ScreenProgramFrame' || outcome.next?._tag !== 'ScreenProgramPatch') return;
      expect(outcome.next.provenance.base).toBe(outcome.held.provenance.revision);
    }),
  );

  it.effect('resumes from an evicted base with a whole frame, not an ending', () =>
    Effect.gen(function* () {
      const outcome = yield* withScreen(({ presentation, ...rest }) =>
        Effect.gen(function* () {
          const screen = { presentation, ...rest };
          const revision = yield* Effect.scoped(
            Effect.gen(function* () {
              const first = yield* presentation.openViewer();
              yield* fed(screen, 'one');
              yield* presentation.grant(first, 1);
              const held = yield* presentation.next(first);
              return held?._tag === 'ScreenProgramFrame' || held?._tag === 'ScreenProgramPatch' ? held.provenance.revision : undefined;
            }),
          );
          const other = yield* presentation.openViewer();
          yield* fed(screen, '\r\ntwo');
          yield* presentation.grant(other, 1);
          yield* presentation.next(other);
          const resumed = yield* presentation.openViewer(revision);
          yield* presentation.grant(resumed, 1);
          const next = yield* presentation.next(resumed);
          return { next };
        }),
      );

      expect(outcome.next?._tag).toBe('ScreenProgramFrame');
    }),
  );

  it.effect('resumes from a base that never existed with a whole frame, not a refusal', () =>
    Effect.gen(function* () {
      const outcome = yield* withScreen(({ presentation, ...rest }) =>
        Effect.gen(function* () {
          const screen = { presentation, ...rest };
          yield* fed(screen, 'one');
          const resumed = yield* presentation.openViewer(999);
          yield* presentation.grant(resumed, 1);
          const next = yield* presentation.next(resumed);
          return { next };
        }),
      );

      expect(outcome.next?._tag).toBe('ScreenProgramFrame');
    }),
  );

  it.effect('never sends a frame larger than the budget it was accounted against', () =>
    Effect.gen(function* () {
      const outcome = yield* withScreen(({ presentation, ...rest }) =>
        Effect.gen(function* () {
          const screen = { presentation, ...rest };
          yield* fed(screen, '\x1b]0;a title the child chose\x07');
          yield* fed(screen, '\x1b[1;3;4;9;38;2;255;255;255;48;5;255mAB́😀');
          yield* fed(screen, '\r\n\x1b[7;53mnext');
          const viewer = yield* presentation.openViewer();
          yield* presentation.grant(viewer, 1);
          const update = yield* presentation.next(viewer);
          return { update };
        }),
      );

      expect(outcome.update?._tag).toBe('ScreenProgramFrame');
      const encoded = wireBytes(outcome.update);
      expect(encoded).toBeLessThanOrEqual(profile.execution.frame.bytes);
    }),
  );

  it.effect('wakes a waiting viewer when the screen moves, and releases it when the screen ends', () =>
    Effect.gen(function* () {
      const outcome = yield* withScreen(({ presentation, ...rest }) =>
        Effect.gen(function* () {
          const screen = { presentation, ...rest };
          const viewer = yield* presentation.openViewer();
          const opening = yield* presentation.await(viewer);
          yield* presentation.grant(viewer, 1);
          yield* presentation.next(viewer);
          const waiting = yield* Effect.forkChild(presentation.await(viewer));
          yield* fed(screen, 'moved');
          const woken = yield* Fiber.join(waiting);
          yield* presentation.grant(viewer, 1);
          yield* presentation.next(viewer);
          yield* presentation.ended();
          const closed = yield* presentation.await(viewer);
          return { opening, woken, closed };
        }),
      );

      expect(outcome.opening).toBe(true);
      expect(outcome.woken).toBe(true);
      expect(outcome.closed).toBe(false);
    }),
  );
});

describe('a copy carries the history it already read', () => {
  const tall = runtimeProfile({ rows: 6, columns: 20, scrollbackRows: 10, transports: ['pty'] });

  const cellsOf = (update: ScreenFeedItem) =>
    update._tag === 'ScreenFrame' ? { buffer: update.buffer, geometry: update.geometry, rows: update.rows, cursor: update.cursor } : update;

  type Step = (interpretation: Interpretation) => Effect.Effect<unknown, InterpretationUnavailable>;

  const replay = Effect.fnUntraced(function* (profile: ReturnType<typeof runtimeProfile>, steps: ReadonlyArray<Step>) {
    const interpretation = yield* makeInterpretation({
      mode: 'open',
      ref,
      geometry: { rows: 6, columns: 20 },
      limits: profile.execution,
      colors: COLORS,
      reply: () => Effect.succeed({ delivered: true, ending: false, detail: '' }),
    });
    const carrying = yield* makePresentation({ interpretation, limits: profile.execution, ref });
    const compared: Array<{ readonly carried: unknown; readonly whole: unknown }> = [];
    for (const step of steps) {
      yield* step(interpretation);
      yield* carrying.invalidate();
      const carried = cellsOf(yield* carrying.update());
      const whole = cellsOf(
        yield* Effect.scoped(
          Effect.flatMap(makePresentation({ interpretation, limits: profile.execution, ref }), (first) => first.update()),
        ),
      );
      compared.push({ carried, whole });
    }
    return compared;
  });

  it.effect('answers a resize and its reverse, and a reset in the byte stream, between two copies exactly as a first copy would', () =>
    Effect.gen(function* () {
      const deep = runtimeProfile({ rows: 6, columns: 20, scrollbackRows: 40, transports: ['pty'] });
      const steps: ReadonlyArray<Step> = [
        (engine) =>
          engine.feed(
            bytes(
              Array.from(
                { length: 30 },
                (_, index) => `${String(index).padStart(2, '0')}${'abcdefghij'.repeat(index % 3 === 0 ? 3 : 1)}`,
              ).join('\r\n'),
            ),
          ),
        (engine) => engine.feed(bytes('\r\no0')),
        (engine) =>
          Effect.andThen(engine.resize({ rows: 6, columns: 13 }, byteOffset(0n)), engine.resize({ rows: 6, columns: 20 }, byteOffset(0n))),
        (engine) => engine.feed(bytes(`\r\n${Array.from({ length: 15 }, (_, index) => `p${index}`).join('\r\n')}`)),
        (engine) => engine.feed(bytes(`\x1bc${Array.from({ length: 30 }, (_, index) => `n${index}`).join('\r\n')}`)),
      ];
      const outcome = yield* replay(deep, steps);

      expect(outcome.length).toBe(steps.length);
      for (const { carried, whole } of outcome) expect(carried).toEqual(whole);
    }),
  );

  it.effect('answers every screen exactly as a first copy would, through scrolls, trims, resizes and resets', () =>
    Effect.gen(function* () {
      const steps: ReadonlyArray<Step> = [
        (engine) => engine.feed(bytes(Array.from({ length: 21 }, (_, index) => `l${index}`).join('\r\n'))),
        (engine) => engine.feed(bytes('\r\nm1\r\nm2')),
        (engine) => engine.feed(bytes(`\r\n${'abcdefghij'.repeat(40)}`)),
        (engine) => engine.feed(bytes('\x1b[3;20H\x1b[1J\x1b[6;1H')),
        (engine) => engine.feed(bytes('\x1b[1;1HEDITED\x1b[6;1H\r\n\r\nz')),
        (engine) => engine.feed(bytes('\r\nq1\r\nq2')),
        (engine) => engine.feed(bytes(`\x1bc${Array.from({ length: 12 }, (_, index) => `n${index}`).join('\r\n')}`)),
        (engine) => engine.feed(bytes('\x1b[1;4r\x1b[4;1H\nr1\n\x1b[r\x1b[6;1H')),
        (engine) => engine.feed(bytes('\r\n\x1b[31;4:3;58:2::1:2:3mcolor\x1b[0m\r\n\x1b[1;48;5;200mbold\x1b[0m\r\nplain')),
        (engine) => engine.trim(3),
        (engine) => engine.feed(bytes('\r\nafter-trim')),
        (engine) => engine.resize({ rows: 6, columns: 18 }, byteOffset(0n)),
        (engine) => engine.feed(bytes('\r\nx1\r\nx2')),
        (engine) => engine.feed(bytes('\x1b[3J\r\ny')),
        (engine) => engine.feed(bytes('\x1b[?1049h\x1b[Halt\r\nscreen')),
        (engine) => engine.feed(bytes('\x1b[?1049l\r\nback')),
        (engine) => engine.feed(bytes('\x1bcreset\r\nr2')),
        (engine) => engine.feed(bytes(Array.from({ length: 30 }, (_, index) => `b${index}`).join('\r\n'))),
      ];
      const outcome = yield* replay(tall, steps);

      expect(outcome.length).toBe(steps.length);
      for (const { carried, whole } of outcome) expect(carried).toEqual(whole);
    }),
  );
});
