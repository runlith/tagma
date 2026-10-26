import { it } from '@runlith/effect-test/vitest';
import { Effect, Queue, Stream } from 'effect';
import { expect, vi } from 'vitest';
import { LiveConnection } from './Live.js';
import { ServerOrigin } from './ServerOrigin.svelte.js';

class OpeningSocket extends EventTarget {
  static last: OpeningSocket | null = null;
  readyState = 0;
  binaryType = 'arraybuffer';

  constructor() {
    super();
    OpeningSocket.last = this;
    queueMicrotask(() => {
      this.readyState = 1;
      this.dispatchEvent(new Event('open'));
    });
  }

  send(): void {}

  close(): void {
    this.readyState = 3;
    this.dispatchEvent(new CloseEvent('close', { code: 1000, wasClean: true }));
  }
}

const opening = (): WebSocket => new OpeningSocket() as unknown as WebSocket;
const connection = LiveConnection.make(opening, new ServerOrigin('http://localhost'));

it.live('a verb the dropped connection was carrying fails as transport, so its caller waits instead of giving up', () =>
  Effect.gen(function* () {
    const liveWire = yield* connection;
    const held = liveWire.hold(
      () => Stream.never,
      () => {},
      () => {},
    );
    try {
      yield* Effect.promise(async () => {
        await vi.waitFor(() => expect(liveWire.status).toBe('open'));
        const verb = liveWire.call(() => Effect.never);
        OpeningSocket.last?.close();
        await expect(verb).rejects.toMatchObject({ code: 'transport' });
      });
    } finally {
      held.unsubscribe();
    }
  }),
);

it.live('after a gap the watched feed resumes before the snapshot feeds', () =>
  Effect.gen(function* () {
    const liveWire = yield* connection;
    const started: string[] = [];
    const recording = (lane: string) => () => {
      started.push(lane);
      return Stream.never;
    };
    const feed = liveWire.hold(
      recording('feed'),
      () => {},
      () => {},
    );
    const frame = liveWire.hold(
      recording('frame'),
      () => {},
      () => {},
      'frame',
    );
    const bytes = liveWire.hold(
      recording('bytes'),
      () => {},
      () => {},
      'bytes',
    );
    try {
      yield* Effect.promise(async () => {
        await vi.waitFor(() => expect(started).toHaveLength(3));
        started.length = 0;
        liveWire.pause();
        liveWire.resume();
        await vi.waitFor(() => expect(started).toHaveLength(3));
        expect(started).toEqual(['bytes', 'frame', 'feed']);
      });
    } finally {
      feed.unsubscribe();
      frame.unsubscribe();
      bytes.unsubscribe();
    }
  }),
);

it.live(
  'renew reports the loss of an active one-pass feed instead of leaving its consumer waiting',
  () =>
    Effect.gen(function* () {
      const liveWire = yield* connection;
      const started = Promise.withResolvers<void>();
      const failed = Promise.withResolvers<unknown>();
      const held = liveWire.hold(
        () => {
          started.resolve();
          return Stream.never;
        },
        () => {},
        (failure) => failed.resolve(failure),
        'feed',
        'once',
      );
      try {
        yield* Effect.promise(async () => {
          await started.promise;
          await vi.waitFor(() => expect(liveWire.status).toBe('open'), { interval: 1, timeout: 500 });
          liveWire.renew();
          expect(await failed.promise).toMatchObject({ kind: 'connection' });
        });
      } finally {
        held.unsubscribe();
        liveWire.pause();
      }
    }),
  1000,
);

it.live('finite snapshots stay current through paced repeats, pause cancels a retry, and async release stops repetition', () =>
  Effect.gen(function* () {
    const liveWire = yield* connection;
    yield* Effect.promise(async () => {
      vi.useFakeTimers();
      const items: number[] = [];
      let givenThrough = 0;
      const held = liveWire.hold(
        () => Stream.succeed(givenThrough),
        async (item) => {
          items.push(item);
          if (items.length === 3) held.unsubscribe();
        },
        () => {},
      );
      try {
        await vi.advanceTimersByTimeAsync(0);
        expect(items).toEqual([0]);
        expect(liveWire.status).toBe('open');
        givenThrough = 7;
        await vi.advanceTimersByTimeAsync(1000);
        expect(items).toEqual([0, 7]);
        expect(liveWire.status).toBe('open');
        liveWire.pause();
        givenThrough = 8;
        await vi.advanceTimersByTimeAsync(1000);
        expect(items).toEqual([0, 7]);
        liveWire.resume();
        await vi.advanceTimersByTimeAsync(0);
        expect(items).toEqual([0, 7, 8]);
        await vi.advanceTimersByTimeAsync(1000);
        expect(items).toEqual([0, 7, 8]);
      } finally {
        held.unsubscribe();
        vi.useRealTimers();
      }
    });
  }),
);

it.live('empty finite readings leave the connection and unrelated subscription usable', () =>
  Effect.gen(function* () {
    const liveWire = yield* connection;
    const values = yield* Queue.make<number>();
    const items: number[] = [];
    const failures: unknown[] = [];
    vi.useFakeTimers();
    const empty = liveWire.hold(
      () => Stream.empty,
      () => {},
      (failure) => failures.push(failure),
    );
    const active = liveWire.hold(
      () => Stream.fromQueue(values),
      (item) => void items.push(item),
      (failure) => failures.push(failure),
    );
    try {
      yield* Effect.promise(() => vi.advanceTimersByTimeAsync(2000));
      expect(liveWire.status).toBe('open');
      yield* Queue.offer(values, 7);
      yield* Effect.promise(() => vi.advanceTimersByTimeAsync(0));
      expect(items).toEqual([7]);
      expect(failures).toEqual([]);
    } finally {
      empty.unsubscribe();
      active.unsubscribe();
      vi.useRealTimers();
    }
  }),
);

it.live('a finite feed held once runs one pass and is not subscribed again when it ends or the connection comes back', () =>
  Effect.gen(function* () {
    const liveWire = yield* connection;
    yield* Effect.promise(async () => {
      vi.useFakeTimers();
      let opened = 0;
      const items: number[] = [];
      const failures: unknown[] = [];
      const held = liveWire.hold(
        () => {
          opened += 1;
          return Stream.make(1, 2);
        },
        (item) => void items.push(item),
        (failure) => failures.push(failure),
        'feed',
        'once',
      );
      try {
        await vi.advanceTimersByTimeAsync(0);
        expect(items).toEqual([1, 2]);
        await vi.advanceTimersByTimeAsync(1000);
        expect(opened).toBe(1);
        liveWire.renew();
        await vi.advanceTimersByTimeAsync(0);
        expect(opened).toBe(1);
        expect(failures).toEqual([]);
      } finally {
        held.unsubscribe();
        vi.useRealTimers();
      }
    });
  }),
);
