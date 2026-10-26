import { Deferred, Effect, Queue, Ref, Semaphore } from 'effect';

export type WriteFrame = {
  readonly header: Uint8Array;
  readonly payload: Uint8Array;
};

type Held = {
  readonly frame: WriteFrame;
  readonly cost: number;
};

export type ConnectionWriter = {
  readonly reply: (frame: WriteFrame) => Effect.Effect<void>;
  readonly event: (frame: WriteFrame, cost: number) => Effect.Effect<void>;
};

export type ConnectionWriterInput = {
  readonly write: (frame: WriteFrame) => Effect.Effect<boolean>;
  readonly eventBytes: number;
};

export const makeConnectionWriter = Effect.fnUntraced(function* ({ write, eventBytes }: ConnectionWriterInput) {
  const replies = yield* Queue.bounded<WriteFrame>(Number.MAX_SAFE_INTEGER);
  const events = yield* Queue.bounded<Held>(Number.MAX_SAFE_INTEGER);
  const account = yield* Semaphore.make(eventBytes);
  const arrivedRef = yield* Ref.make<Deferred.Deferred<void> | undefined>(undefined);
  function reply(frame: WriteFrame): Effect.Effect<void> {
    return Effect.uninterruptible(Effect.andThen(Queue.offer(replies, frame), readWoken()));
  }

  const event = (frame: WriteFrame, cost: number): Effect.Effect<void> =>
    Effect.uninterruptibleMask((restore) =>
      Effect.andThen(restore(account.take(cost)), Effect.andThen(Queue.offer(events, { frame, cost }), readWoken())),
    );

  const drain = Effect.fnUntraced(function* (): Effect.fn.Return<void> {
    for (;;) {
      if (yield* readNext()) continue;
      const waiting = yield* Ref.modify(arrivedRef, (held) => {
        const deferred = held ?? Deferred.makeUnsafe<void>();
        return [deferred, deferred] as const;
      });
      if (yield* readNext()) {
        yield* Ref.set(arrivedRef, undefined);
        continue;
      }
      yield* Deferred.await(waiting);
      yield* Ref.set(arrivedRef, undefined);
    }
  });

  const readNext = Effect.fnUntraced(function* (): Effect.fn.Return<boolean> {
    const reply = yield* Queue.poll(replies);
    if (reply._tag === 'Some') {
      yield* write(reply.value);
      return true;
    }
    const event = yield* Queue.poll(events);
    if (event._tag === 'Some') {
      yield* write(event.value.frame);
      yield* account.release(event.value.cost);
      return true;
    }
    return false;
  });

  function readWoken(): Effect.Effect<void> {
    return Effect.flatMap(Ref.getAndSet(arrivedRef, undefined), (waiting) =>
      waiting === undefined ? Effect.void : Effect.asVoid(Deferred.succeed(waiting, undefined)),
    );
  }
  yield* Effect.forkScoped(drain());
  return { reply: reply, event: event } satisfies ConnectionWriter;
});
