import { type Cause, Deferred, Effect, Queue, type Scope, Stream } from 'effect';
import { Listener, type Probs } from './channel.ts';
import { DetectorBehind, type EngineFailure, EngineRefused } from './failures.ts';
import type { Host } from './host.ts';

export type EngineDetection = {
  readonly rate: number;
  readonly window: number;
  readonly push: (pcm: Int16Array) => Effect.Effect<void, EngineFailure>;
  readonly reset: Effect.Effect<void, EngineFailure>;
  readonly end: Effect.Effect<void, EngineFailure>;
  readonly probs: Stream.Stream<Probs, EngineFailure>;
};

export type DetectionLimits = {
  readonly aheadMs: number;
  readonly unread: number;
};

const finished = new EngineRefused({ code: 'stream-ended', reason: 'the detector stream already ended' });

export const detect = Effect.fnUntraced(function* (
  host: Host,
  limits: DetectionLimits,
): Effect.fn.Return<EngineDetection, EngineFailure, Scope.Scope> {
  const channel = yield* host.channel;
  const ready = yield* Deferred.await(channel.ready);
  const stream = channel.id();
  const queue = yield* Queue.bounded<Probs, EngineFailure | Cause.Done>(limits.unread);
  const listener = new Listener(queue);
  const ahead = Math.round((limits.aheadMs * ready.rate) / 1000);
  let sent = 0;
  let ended = false;
  yield* Effect.acquireRelease(
    Effect.suspend(() => {
      channel.listen(stream, listener);
      return channel.ask({ type: 'vad.open', id: channel.id(), stream });
    }),
    () =>
      Effect.suspend(() => {
        channel.forget(stream);
        return Effect.andThen(Effect.exit(channel.send({ type: 'vad.close', stream })), Queue.end(queue));
      }),
  ).pipe(Effect.onError(() => Effect.sync(() => channel.forget(stream))));

  const push = (pcm: Int16Array): Effect.Effect<void, EngineFailure> =>
    Effect.suspend((): Effect.Effect<void, EngineFailure> => {
      if (ended) return Effect.fail(finished);
      if (pcm.length === 0) return Effect.void;
      if (sent + pcm.length - listener.heard > ahead) {
        const behind = new DetectorBehind({ reason: `more than ${limits.aheadMs} ms of audio waits for inference` });
        return Effect.andThen(Queue.fail(queue, behind), Effect.fail(behind));
      }
      sent += pcm.length;
      return channel.send({ type: 'vad.audio', stream }, pcm);
    });

  const end = Effect.suspend(() => {
    if (ended) return Effect.fail(finished);
    ended = true;
    return Effect.flatMap(channel.ask({ type: 'vad.end', id: channel.id(), stream }), (answer) =>
      answer.type === 'vad.ended'
        ? Effect.asVoid(Queue.end(queue))
        : Effect.fail(new EngineRefused({ code: 'protocol', reason: `the engine answered ${answer.type} where vad.ended was due` })),
    );
  });

  return {
    rate: ready.rate,
    window: ready.window,
    push,
    reset: Effect.suspend((): Effect.Effect<void, EngineFailure> =>
      ended ? Effect.fail(finished) : channel.send({ type: 'vad.reset', stream }),
    ),
    end,
    probs: Stream.fromQueue(queue),
  };
});
