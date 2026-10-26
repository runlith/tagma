import { it } from '@runlith/effect-test';
import { expect } from 'bun:test';
import { Cause, Context, Effect, Exit, Fiber, Layer, Scope, Stream } from 'effect';
import { ViewLeases } from '../contract/service/views.js';
import { ExecutionId, InstallationId, type ExecutionRef } from '@runlith/executions/protocol/execution';
import type { ScreenFeedItem } from '@runlith/executions/protocol/presentation';
import { ByteOffset } from '@runlith/executions/protocol/record';
import { gatedRecords, gatedScreens, makeViewLeaseBook, type ViewLeaseBook } from './viewLeases.js';
import type { RecordChunk } from '../contract/wire/viewLeases.js';

it.effect('closing the viewer layer interrupts a reader waiting for its mark', () =>
  Effect.gen(function* () {
    const owner = yield* Scope.fork(yield* Effect.scope);
    const context = yield* Layer.buildWithScope(Layer.effect(ViewLeases, makeViewLeaseBook()), owner);
    const viewers = context.pipe(Context.get(ViewLeases));
    const viewer = yield* viewers.open(7, execution, 'pty');
    yield* viewers.handing(viewer, 1);
    const waiting = yield* Effect.forkChild(viewers.ready(viewer));
    yield* Effect.yieldNow;
    yield* Scope.close(owner, Exit.void);
    const exit = yield* Fiber.await(waiting);
    expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true);
  }),
);

const start = ByteOffset.make('0');

const installation = InstallationId.make('installation-under-test');
const execution: ExecutionRef = { installation, execution: ExecutionId.make('exec-1'), incarnation: 0 };

const frame = (revision: number): ScreenFeedItem => ({
  _tag: 'ScreenFrame',
  provenance: { ref: execution, revision, parsedThrough: start },
  buffer: 'normal',
  geometry: { rows: 1, columns: 1, firstLine: 0, viewportLine: 0 },
  rows: [],
  cursor: { line: 0, column: 0 },
  appearance: {
    colors: { palette: Array.from({ length: 256 }, () => 0), foreground: 0, background: 0, cursor: 0 },
    cursor: { visible: true, style: 'block', blink: false },
    title: '',
  },
  input: { _tag: 'Unavailable', revision: 0, reason: 'no input profile is measured by this fixture' },
});

const unavailable: ScreenFeedItem = {
  _tag: 'ScreenUnavailable',
  ref: execution,
  parsedThrough: start,
  reason: 'engine',
  detail: 'the interpreter stopped',
};

const chunk = (from: number, bytes: string, stream: 'pty' | 'stdout' | 'stderr' = 'pty'): RecordChunk => ({
  _tag: 'Bytes',
  range: {
    cursor: { ref: execution, stream, offset: ByteOffset.make(String(from)) },
    next: ByteOffset.make(String(from + bytes.length)),
    retainedFrom: start,
    durableThrough: ByteOffset.make(String(from + bytes.length)),
    gap: false,
  },
  bytes: new TextEncoder().encode(bytes),
});

type Producer<A> = {
  readonly stream: Stream.Stream<A, never>;
  readonly asked: () => readonly number[];
};

const producer = <A>(items: readonly A[], acknowledged: () => number): Producer<A> => {
  const asked: number[] = [];
  let index = 0;
  const stream = Stream.fromPull(
    Effect.sync(() =>
      Effect.suspend(() => {
        asked.push(acknowledged());
        if (index >= items.length) return Cause.done();
        return Effect.succeed([items[index++] as A] as const);
      }),
    ),
  );
  return { stream, asked: () => asked };
};

it.live('a frame is asked for only after the viewer acknowledged the one before it', () =>
  Effect.gen(function* () {
    yield* Effect.scoped(
      Effect.gen(function* () {
        const viewers = yield* makeViewLeaseBook();
        let acked = 0;
        const source = producer([frame(1), frame(2), frame(3)], () => acked);
        const viewer = yield* viewers.open(7, execution, 'pty');
        const pull = yield* Stream.toPull(gatedScreens(viewers, viewer, source.stream));
        yield* pull;
        for (const revision of [1, 2]) {
          const waiting = yield* Effect.forkChild(pull);
          yield* Effect.yieldNow;
          expect(source.asked().length).toBe(revision);
          acked = revision;
          yield* viewers.acknowledged(7, viewer, revision);
          const delivered = yield* Fiber.join(waiting);
          expect(delivered[0]._tag).toBe('ScreenFrame');
        }
        expect(source.asked()).toEqual([0, 1, 2]);
      }),
    );
  }),
);

it.live('a duplicate or invented acknowledgement releases no further frame', () =>
  Effect.gen(function* () {
    yield* Effect.scoped(
      Effect.gen(function* () {
        const viewers = yield* makeViewLeaseBook();
        let acked = 0;
        const source = producer([frame(1), frame(2), frame(3)], () => acked);
        const viewer = yield* viewers.open(7, execution, 'pty');
        const pull = yield* Stream.toPull(gatedScreens(viewers, viewer, source.stream));
        yield* pull;
        const invented = yield* Effect.forkChild(pull);
        yield* Effect.yieldNow;
        yield* viewers.acknowledged(7, viewer, 99);
        yield* Effect.yieldNow;
        expect(source.asked()).toEqual([0]);
        acked = 1;
        yield* viewers.acknowledged(7, viewer, 1);
        yield* Fiber.join(invented);
        expect(source.asked()).toEqual([0, 1]);
        const duplicate = yield* Effect.forkChild(pull);
        yield* Effect.yieldNow;
        yield* viewers.acknowledged(7, viewer, 1);
        yield* Effect.yieldNow;
        expect(source.asked()).toEqual([0, 1]);
        acked = 2;
        yield* viewers.acknowledged(7, viewer, 2);
        yield* Fiber.join(duplicate);
        expect(source.asked()).toEqual([0, 1, 2]);
        expect(viewers.held).toBe(1);
      }),
    );
  }),
);

it.live('an acknowledgement from another connection is refused and releases nothing', () =>
  Effect.gen(function* () {
    yield* Effect.scoped(
      Effect.gen(function* () {
        const viewers = yield* makeViewLeaseBook();
        let acked = 0;
        const source = producer([frame(1), frame(2)], () => acked);
        const viewer = yield* viewers.open(7, execution, 'pty');
        const pull = yield* Stream.toPull(gatedScreens(viewers, viewer, source.stream));
        yield* pull;
        const stranger = yield* Effect.result(viewers.acknowledged(8, viewer, 1));
        expect(stranger._tag).toBe('Failure');
        if (stranger._tag === 'Failure') expect(stranger.failure.reason).toBe('not-holder');
        const waiting = yield* Effect.forkChild(pull);
        yield* Effect.yieldNow;
        expect(source.asked()).toEqual([0]);
        acked = 1;
        yield* viewers.acknowledged(7, viewer, 1);
        yield* Fiber.join(waiting);
        expect(source.asked()).toEqual([0, 1]);
      }),
    );
  }),
);

it.live('closing a lease ends the stream without asking the source again', () =>
  Effect.gen(function* () {
    yield* Effect.scoped(
      Effect.gen(function* () {
        const viewers = yield* makeViewLeaseBook();
        const source = producer([frame(1), frame(2)], () => 0);
        const viewer = yield* viewers.open(7, execution, 'pty');
        const pull = yield* Stream.toPull(gatedScreens(viewers, viewer, source.stream));
        yield* pull;
        const waiting = yield* Effect.forkChild(pull);
        yield* Effect.yieldNow;
        yield* viewers.close(viewer);
        const ended = yield* Effect.result(Fiber.join(waiting));
        expect(ended._tag).toBe('Failure');
        if (ended._tag === 'Failure') expect(Cause.isDone(ended.failure)).toBe(true);
        expect(source.asked()).toEqual([0]);
        expect(viewers.held).toBe(0);
        const orphan = yield* Effect.result(viewers.acknowledged(7, viewer, 1));
        expect(orphan._tag).toBe('Failure');
      }),
    );
  }),
);

it.live('an unavailable screen is handed over once and ends the subscription', () =>
  Effect.gen(function* () {
    yield* Effect.scoped(
      Effect.gen(function* () {
        const viewers = yield* makeViewLeaseBook();
        const source = producer([unavailable, frame(2)], () => 0);
        const viewer = yield* viewers.open(7, execution, 'pty');
        const pull = yield* Stream.toPull(gatedScreens(viewers, viewer, source.stream));
        const delivered = yield* pull;
        expect(delivered[0]._tag).toBe('ScreenUnavailable');
        const after = yield* Effect.result(pull);
        expect(after._tag).toBe('Failure');
        if (after._tag === 'Failure') expect(Cause.isDone(after.failure)).toBe(true);
        expect(source.asked()).toEqual([0]);
      }),
    );
  }),
);

it.live('several frames in one answer are handed out one acknowledgement at a time', () =>
  Effect.gen(function* () {
    yield* Effect.scoped(
      Effect.gen(function* () {
        const viewers = yield* makeViewLeaseBook();
        const asked: number[] = [];
        let acked = 0;
        let sent = false;
        const source = Stream.fromPull(
          Effect.sync(() =>
            Effect.suspend(() => {
              asked.push(acked);
              if (sent) return Cause.done();
              sent = true;
              return Effect.succeed([frame(1), frame(2)] as const);
            }),
          ),
        );
        const viewer = yield* viewers.open(7, execution, 'pty');
        const pull = yield* Stream.toPull(gatedScreens(viewers, viewer, source));

        const first = yield* pull;
        expect(first[0]._tag === 'ScreenFrame' && first[0].provenance.revision).toBe(1);
        expect(asked).toEqual([0]);

        const buffered = yield* Effect.forkChild(pull);
        yield* Effect.yieldNow;
        expect(asked).toEqual([0]);
        acked = 1;
        yield* viewers.acknowledged(7, viewer, 1);
        const second = yield* Fiber.join(buffered);
        expect(second[0]._tag === 'ScreenFrame' && second[0].provenance.revision).toBe(2);
        expect(asked).toEqual([0]);

        const refill = yield* Effect.forkChild(Effect.result(pull));
        yield* Effect.yieldNow;
        expect(asked).toEqual([0]);
        acked = 2;
        yield* viewers.acknowledged(7, viewer, 2);
        yield* Fiber.join(refill);
        expect(asked).toEqual([0, 2]);
      }),
    );
  }),
);

it.live('a source that fails releases the seat with its stream', () =>
  Effect.gen(function* () {
    const viewers = yield* makeViewLeaseBook();
    const broken = Effect.scoped(
      Effect.gen(function* () {
        const viewer = yield* Effect.acquireRelease(viewers.open(7, execution, 'pty'), (held) => viewers.close(held));
        const source: Stream.Stream<ScreenFeedItem, 'the record could not be read'> = Stream.fromPull(
          Effect.sync(() => Effect.fail('the record could not be read' as const)),
        );
        const pull = yield* Stream.toPull(gatedScreens(viewers, viewer, source));
        return yield* pull;
      }),
    );
    const failed = yield* Effect.result(broken);
    expect(failed._tag).toBe('Failure');
    expect(viewers.held).toBe(0);
  }),
);

it.live('the viewer budget refuses a further view instead of displacing one', () =>
  Effect.gen(function* () {
    yield* Effect.gen(function* () {
      const viewers = yield* makeViewLeaseBook({ capacity: 1 });
      const held = yield* viewers.open(7, execution, 'pty');
      const refused = yield* Effect.result(viewers.open(8, execution, 'pty'));
      expect(refused._tag).toBe('Failure');
      if (refused._tag === 'Failure') expect(refused.failure.reason).toBe('capacity');
      yield* viewers.close(held);
      expect(viewers.held).toBe(0);
      const admitted = yield* Effect.result(viewers.open(8, execution, 'pty'));
      expect(admitted._tag).toBe('Success');
    });
  }),
);

it.live('a record lease releases K chunks before it waits, and an ack retires that offset and every older one', () =>
  Effect.gen(function* () {
    yield* Effect.scoped(
      Effect.gen(function* () {
        const viewers = yield* makeViewLeaseBook();
        let acked = 0;
        const chunks = [chunk(0, 'one'), chunk(3, 'two'), chunk(6, 'six'), chunk(9, 'ten'), chunk(12, 'end')];
        const source = producer(chunks, () => acked);
        const viewer = yield* viewers.open(7, execution, 'pty');
        const pull = yield* Stream.toPull(gatedRecords(viewers, viewer, source.stream));

        for (let index = 0; index < 4; index += 1) yield* pull;
        expect(source.asked()).toEqual([0, 0, 0, 0]);

        const waiting = yield* Effect.forkChild(pull);
        yield* Effect.yieldNow;
        expect(source.asked()).toEqual([0, 0, 0, 0]);

        yield* viewers.acknowledged(7, viewer, ByteOffset.make('1'));
        yield* Effect.yieldNow;
        expect(source.asked()).toEqual([0, 0, 0, 0]);

        acked = 2;
        yield* viewers.acknowledged(7, viewer, ByteOffset.make('6'));
        const fifth = yield* Fiber.join(waiting);
        expect(fifth[0]._tag === 'Bytes' && new TextDecoder().decode(fifth[0].bytes)).toBe('end');
        expect(source.asked()).toEqual([0, 0, 0, 0, 2]);
      }),
    );
  }),
);

it.live('a grid entry with no bytes after it passes the gate at an offset already handed, and holds no place in the window', () =>
  Effect.gen(function* () {
    yield* Effect.scoped(
      Effect.gen(function* () {
        const viewers = yield* makeViewLeaseBook({ window: 2 });
        const empty = chunk(3, '');
        const regridded: RecordChunk =
          empty._tag === 'Bytes' ? { ...empty, range: { ...empty.range, grid: { rows: 30, columns: 100 } } } : empty;
        const source = producer<RecordChunk>([chunk(0, 'one'), regridded, regridded, chunk(3, 'two')], () => 0);
        const viewer = yield* viewers.open(7, execution, 'pty');
        const pull = yield* Stream.toPull(gatedRecords(viewers, viewer, source.stream));
        const handed = [yield* pull, yield* pull, yield* pull, yield* pull].map((items) => items[0]);
        expect(handed.map((item) => (item?._tag === 'Bytes' ? `${item.range.next} ${item.range.grid?.columns ?? '-'}` : null))).toEqual([
          '3 -',
          '3 100',
          '3 100',
          '6 -',
        ]);
      }),
    );
  }),
);

it.live('a record ending is handed over once and ends the subscription', () =>
  Effect.gen(function* () {
    yield* Effect.scoped(
      Effect.gen(function* () {
        const viewers = yield* makeViewLeaseBook();
        const source = producer<RecordChunk>([{ _tag: 'Ended', ending: 'completed' }, chunk(0, 'after')], () => 0);
        const viewer = yield* viewers.open(7, execution, 'pty');
        const pull = yield* Stream.toPull(gatedRecords(viewers, viewer, source.stream));
        const delivered = yield* pull;
        expect(delivered[0]._tag === 'Ended' && delivered[0].ending).toBe('completed');
        const after = yield* Effect.result(pull);
        expect(after._tag).toBe('Failure');
        if (after._tag === 'Failure') expect(Cause.isDone(after.failure)).toBe(true);
        expect(source.asked()).toEqual([0]);
      }),
    );
  }),
);

it.live('a mark on one pipe releases that pipe alone, though both stand at the same offset', () =>
  Effect.gen(function* () {
    yield* Effect.gen(function* () {
      const viewers = yield* makeViewLeaseBook({ window: 1 });
      const stdout = yield* viewers.open(7, execution, 'stdout');
      const stderr = yield* viewers.open(7, execution, 'stderr');
      expect(stdout).not.toBe(stderr);

      const at = ByteOffset.make('20');
      expect(yield* viewers.handing(stdout, at)).toBe(true);
      expect(yield* viewers.handing(stderr, at)).toBe(true);
      expect(yield* viewers.handing(stdout, ByteOffset.make('30'))).toBe(false);
      expect(yield* viewers.handing(stderr, ByteOffset.make('30'))).toBe(false);

      yield* viewers.acknowledged(7, stdout, at);

      expect(yield* viewers.handing(stdout, ByteOffset.make('30'))).toBe(true);
      expect(yield* viewers.handing(stderr, ByteOffset.make('30'))).toBe(false);

      yield* viewers.acknowledged(7, stderr, at);
      expect(yield* viewers.handing(stderr, ByteOffset.make('30'))).toBe(true);
      yield* viewers.close(stdout);
      yield* viewers.close(stderr);
    });
  }),
);
