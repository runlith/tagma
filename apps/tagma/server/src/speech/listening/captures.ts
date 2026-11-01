import { Effect, PubSub, Stream } from 'effect';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { Captures, type Stop } from '../contract/service/captures.js';
import type { Capture, CapturesEvent } from '../contract/wire/feeds.js';

const MOVES_CAPACITY = 256;

type Open = { readonly capture: Capture; readonly stop: Stop };

export const makeCaptures = Effect.gen(function* () {
  const moved = yield* Effect.acquireRelease(PubSub.sliding<CapturesEvent>(MOVES_CAPACITY), PubSub.shutdown);
  const kinds = new Map<string, Map<string, Open>>();
  const opened = (kind: string, id: string) => kinds.get(kind)?.get(id);
  const all = () => [...kinds.values()].flatMap((ids) => [...ids.values()]);

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
        const ids = kinds.get(capture.kind) ?? new Map<string, Open>();
        kinds.set(capture.kind, ids.set(capture.id, { capture, stop }));
        return Effect.asVoid(PubSub.publish(moved, { kind: 'opened', capture }));
      }),
    end: (kind, id) =>
      Effect.suspend(() => {
        const ids = kinds.get(kind);
        if (ids?.delete(id) !== true) return Effect.void;
        if (ids.size === 0) kinds.delete(kind);
        return Effect.asVoid(PubSub.publish(moved, { kind: 'ended', capture: { kind, id } }));
      }),
    count: (kind) => Effect.sync(() => kinds.get(kind)?.size ?? 0),
    stop: Effect.fn('Captures.stop')(function* (target) {
      if (target !== null) {
        const open = opened(target.kind, target.id);
        if (open === undefined) {
          return yield* new GateRefusal('unknown-capture', `no ${target.kind} ${target.id} is capturing on this server`, [
            'the speech.captures.subscribe feed names what is capturing now',
          ]);
        }
        yield* stopped(open);
        return 1;
      }
      const standing = all();
      const outcomes = yield* Effect.forEach(standing, (open) => Effect.result(stopped(open)), { concurrency: 'unbounded' });
      for (const outcome of outcomes) if (outcome._tag === 'Failure') return yield* Effect.fail(outcome.failure);
      return standing.length;
    }),
    events: Stream.unwrap(
      Effect.map(PubSub.subscribe(moved), (subscription) =>
        Stream.concat(
          Stream.suspend(() => Stream.succeed<CapturesEvent>({ kind: 'snapshot', captures: all().map((open) => open.capture) })),
          Stream.fromSubscription(subscription),
        ),
      ),
    ),
  });
});
