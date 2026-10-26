import { Effect, PubSub, Stream } from 'effect';
import type { Capture, CaptureKind, CapturesEvent } from '../contract/wire/feeds.js';

const MOVES_CAPACITY = 256;

const keyOf = (kind: CaptureKind, id: string): string => `${kind}:${id}`;

export type Captures = Effect.Success<typeof makeCaptures>;

export const makeCaptures = Effect.gen(function* () {
  const moved = yield* Effect.acquireRelease(PubSub.sliding<CapturesEvent>(MOVES_CAPACITY), PubSub.shutdown);
  const standing = new Map<string, Capture>();
  const opened = (capture: Capture): Effect.Effect<void> =>
    Effect.suspend(() => {
      standing.set(keyOf(capture.kind, capture.id), capture);
      return Effect.asVoid(PubSub.publish(moved, { kind: 'opened', capture }));
    });

  const ended = (kind: CaptureKind, id: string): Effect.Effect<void> =>
    Effect.suspend(() =>
      standing.delete(keyOf(kind, id)) ? Effect.asVoid(PubSub.publish(moved, { kind: 'ended', capture: { kind, id } })) : Effect.void,
    );

  const live = (kind: CaptureKind): Effect.Effect<number> =>
    Effect.sync(() => {
      let count = 0;
      for (const capture of standing.values()) if (capture.kind === kind) count += 1;
      return count;
    });

  const events = (): Stream.Stream<CapturesEvent> =>
    Stream.unwrap(
      Effect.map(PubSub.subscribe(moved), (subscription) =>
        Stream.concat(
          Stream.suspend(() => Stream.succeed<CapturesEvent>({ kind: 'snapshot', captures: [...standing.values()] })),
          Stream.fromSubscription(subscription),
        ),
      ),
    );
  return {
    opened,
    ended,
    live,
    get events() {
      return events();
    },
  };
});
