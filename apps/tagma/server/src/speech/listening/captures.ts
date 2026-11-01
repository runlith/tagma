import { Effect, PubSub, Stream } from 'effect';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { Captures, type Stop } from '../contract/service/captures.js';
import type { Capture, CapturesEvent } from '../contract/wire/feeds.js';

const MOVES_CAPACITY = 256;

const keyOf = (kind: string, id: string): string => `${kind}:${id}`;

type Open = { readonly capture: Capture; readonly stop: Stop };

export const makeCaptures = Effect.gen(function* () {
  const moved = yield* Effect.acquireRelease(PubSub.sliding<CapturesEvent>(MOVES_CAPACITY), PubSub.shutdown);
  const standing = new Map<string, Open>();

  const stopped = (open: Open) =>
    open.stop.pipe(
      Effect.catchTag('GateRefusal', (refused) =>
        Effect.fail(
          new GateRefusal('stop-refused', `the ${open.capture.noun.one} ${open.capture.id} could not be stopped: ${refused.reason}`, [
            refused.unblock[0] ?? 'stop it again',
            ...refused.unblock.slice(1),
          ]),
        ),
      ),
    );

  return Captures.of({
    open: (capture, stop) =>
      Effect.suspend(() => {
        standing.set(keyOf(capture.kind, capture.id), { capture, stop });
        return Effect.asVoid(PubSub.publish(moved, { kind: 'opened', capture }));
      }),
    end: (kind, id) =>
      Effect.suspend(() =>
        standing.delete(keyOf(kind, id)) ? Effect.asVoid(PubSub.publish(moved, { kind: 'ended', capture: { kind, id } })) : Effect.void,
      ),
    count: (kind) =>
      Effect.sync(() => {
        let count = 0;
        for (const open of standing.values()) if (open.capture.kind === kind) count += 1;
        return count;
      }),
    stop: Effect.fn('Captures.stop')(function* (target) {
      if (target !== null) {
        const open = standing.get(keyOf(target.kind, target.id));
        if (open === undefined) {
          return yield* new GateRefusal('unknown-capture', `no ${target.kind} ${target.id} is capturing on this server`, [
            'the speech.captures.subscribe feed names what is capturing now',
          ]);
        }
        yield* stopped(open);
        return 1;
      }
      const all = [...standing.values()];
      const outcomes = yield* Effect.forEach(all, (open) => Effect.result(stopped(open)), { concurrency: 'unbounded' });
      for (const outcome of outcomes) if (outcome._tag === 'Failure') return yield* Effect.fail(outcome.failure);
      return all.length;
    }),
    events: Stream.unwrap(
      Effect.map(PubSub.subscribe(moved), (subscription) =>
        Stream.concat(
          Stream.suspend(() =>
            Stream.succeed<CapturesEvent>({ kind: 'snapshot', captures: [...standing.values()].map((open) => open.capture) }),
          ),
          Stream.fromSubscription(subscription),
        ),
      ),
    ),
  });
});
