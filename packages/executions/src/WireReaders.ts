import { type Cause, Effect, Queue, Ref } from 'effect';
import type { ExecutionFeedItem } from './Executions';
import type { RequestId, SubscriptionEnding, SubscriptionId } from './protocol/wire';

export type HeldDelivery = { readonly delivery: ExecutionFeedItem; readonly cost: number };

type Reader = {
  readonly queue: Queue.Queue<HeldDelivery, Cause.Done>;
  readonly outstanding: Ref.Ref<number>;
  readonly ended: Ref.Ref<boolean>;
};

export type Delivered = 'delivered' | 'unknown' | 'overdrawn';

export type WireReaders = {
  readonly reserve: (request: RequestId, credits: number) => Effect.Effect<Queue.Dequeue<HeldDelivery, Cause.Done> | undefined>;
  readonly bind: (request: RequestId, subscription: SubscriptionId) => Effect.Effect<boolean>;
  readonly queueOf: (subscription: SubscriptionId) => Effect.Effect<Queue.Dequeue<HeldDelivery, Cause.Done> | undefined>;
  readonly release: (request: RequestId) => Effect.Effect<void>;
  readonly deliver: (subscription: SubscriptionId, delivery: ExecutionFeedItem, cost: number) => Effect.Effect<Delivered>;
  readonly grant: (subscription: SubscriptionId, bytes: number) => Effect.Effect<boolean>;
  readonly end: (subscription: SubscriptionId, ending: SubscriptionEnding) => Effect.Effect<void>;
  readonly close: (subscription: SubscriptionId) => Effect.Effect<void>;
  readonly closeAll: (ending: SubscriptionEnding) => Effect.Effect<void>;
  readonly open: () => Effect.Effect<number>;
};

export const wireReaders = Effect.fnUntraced(function* (limit: number): Effect.fn.Return<WireReaders> {
  const held = yield* Ref.make<ReadonlyMap<RequestId, Reader>>(new Map());
  const named = yield* Ref.make<ReadonlyMap<SubscriptionId, Reader>>(new Map());

  const make = Effect.fnUntraced(function* (credits: number) {
    const queue = yield* Queue.bounded<HeldDelivery, Cause.Done>(credits + 1);
    const outstanding = yield* Ref.make(credits);
    const ended = yield* Ref.make(false);
    return { queue, outstanding, ended } satisfies Reader;
  });

  const drop = <K>(cell: Ref.Ref<ReadonlyMap<K, Reader>>, key: K) =>
    Ref.modify(cell, (readers): [Reader | undefined, ReadonlyMap<K, Reader>] => {
      const reader = readers.get(key);
      if (reader === undefined) return [undefined, readers];
      const kept = new Map(readers);
      kept.delete(key);
      return [reader, kept];
    });

  const finish = Effect.fnUntraced(function* (reader: Reader, ending: SubscriptionEnding) {
    if (yield* Ref.getAndSet(reader.ended, true)) return;
    yield* Queue.offer(reader.queue, { delivery: { _tag: 'Ended', ending }, cost: 0 });
    yield* Queue.end(reader.queue);
  });

  return {
    reserve: Effect.fnUntraced(function* (request, credits) {
      const reader = yield* make(credits);
      const bound = yield* Ref.get(named);
      const admitted = yield* Ref.modify(held, (readers): [boolean, ReadonlyMap<RequestId, Reader>] =>
        readers.size + bound.size >= limit ? [false, readers] : [true, new Map(readers).set(request, reader)],
      );
      return admitted ? reader.queue : undefined;
    }),

    bind: Effect.fnUntraced(function* (request, subscription) {
      const reader = yield* drop(held, request);
      if (reader === undefined) return false;
      yield* Ref.update(named, (readers) => new Map(readers).set(subscription, reader));
      return true;
    }),

    queueOf: (subscription) => Effect.map(Ref.get(named), (readers) => readers.get(subscription)?.queue),

    release: Effect.fnUntraced(function* (request) {
      const reader = yield* drop(held, request);
      if (reader !== undefined) yield* finish(reader, 'cancelled');
    }),

    deliver: Effect.fnUntraced(function* (subscription, delivery, cost) {
      const reader = (yield* Ref.get(named)).get(subscription);
      if (reader === undefined || (yield* Ref.get(reader.ended))) return 'unknown' as const;
      const remaining = yield* Ref.modify(reader.outstanding, (credit): [number, number] => {
        const left = credit - cost;
        return left < 0 ? [left, credit] : [left, left];
      });
      if (remaining < 0) return 'overdrawn' as const;
      yield* Queue.offer(reader.queue, { delivery, cost });
      return 'delivered' as const;
    }),

    grant: Effect.fnUntraced(function* (subscription, bytes) {
      const reader = (yield* Ref.get(named)).get(subscription);
      if (reader === undefined || (yield* Ref.get(reader.ended))) return false;
      yield* Ref.update(reader.outstanding, (credit) => credit + bytes);
      return true;
    }),

    end: (subscription, ending) =>
      Effect.flatMap(Ref.get(named), (readers) => {
        const reader = readers.get(subscription);
        return reader === undefined ? Effect.void : finish(reader, ending);
      }),

    close: (subscription) =>
      Effect.flatMap(drop(named, subscription), (reader) => (reader === undefined ? Effect.void : finish(reader, 'cancelled'))),

    closeAll: Effect.fnUntraced(function* (ending) {
      const reserved = yield* Ref.getAndSet(held, new Map<RequestId, Reader>());
      const bound = yield* Ref.get(named);
      for (const reader of [...reserved.values(), ...bound.values()]) yield* finish(reader, ending);
    }),

    open: () => Effect.map(Ref.get(named), (readers) => readers.size),
  };
});
