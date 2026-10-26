import { type Cause, Deferred, Effect, Queue, type Scope, Semaphore } from 'effect';
import type { CaptureRequest } from '../port/devices.ts';
import type { Player } from '../port/player.ts';
import type { DeviceRefused } from '../port/refusal.ts';
import { PartialFrame } from '../sound/chunk.ts';
import { type Format, isWhole, millisOf } from '../sound/format.ts';
import type { Sound, Track } from '../sound/track.ts';
import { Capture } from './capture.ts';
import type { Holder } from './client.ts';
import { clientAudio, FRAME_LIMIT } from './frame.ts';
import { Hold } from './mute.ts';
import { Playback } from './playback.ts';

const PIECE_MS = 100;

export const capture = Effect.fnUntraced(function* (
  client: Holder,
  request: CaptureRequest,
): Effect.fn.Return<Track, DeviceRefused, Scope.Scope> {
  const session = yield* client.hold;
  const queue = yield* Queue.unbounded<Sound, Cause.Done>();
  const opened = Deferred.makeUnsafe<Format, DeviceRefused>();
  const resource = new Capture(opened, queue, client.bufferMs);
  const id = session.allocate(resource);
  yield* Effect.addFinalizer(() => {
    const open = !resource.done;
    return resource.discard.pipe(Effect.andThen(open ? Effect.asVoid(Effect.exit(session.send({ type: 'abort', id }))) : Effect.void));
  });
  yield* session.send({
    type: 'capture',
    id,
    source: request.source,
    device: request.device,
    echoCancel: request.echoCancel,
  });
  const format = yield* Deferred.await(opened);
  let stopping = false;
  return {
    format,
    chunks: resource.chunks,
    end: Effect.suspend(() => {
      if (stopping || resource.done) return Effect.void;
      stopping = true;
      return Effect.asVoid(Effect.exit(session.send({ type: 'stop', id })));
    }),
  };
});

export const play = Effect.fnUntraced(function* (client: Holder, format: Format): Effect.fn.Return<Player, DeviceRefused, Scope.Scope> {
  const session = yield* client.hold;
  const opened = Deferred.makeUnsafe<void, DeviceRefused>();
  const resource = new Playback(opened, client.queueMs);
  const id = session.allocate(resource);
  const admission = yield* Semaphore.make(1);
  const admit = <A>(act: () => Effect.Effect<A, DeviceRefused>): Effect.Effect<A, DeviceRefused> =>
    admission.withPermits(1)(
      Effect.uninterruptible(
        Effect.suspend(() => {
          const failure = resource.failure;
          return failure === undefined ? act() : Effect.fail(failure);
        }),
      ),
    );
  yield* Effect.addFinalizer(() => {
    if (resource.refusedAtOpen) return Effect.void;
    resource.close();
    return admission.withPermits(1)(Effect.asVoid(Effect.exit(session.send({ type: 'release', id }))));
  });
  yield* session.send({ type: 'play', id, format });
  yield* Deferred.await(opened);
  const writing = yield* Semaphore.make(1);
  const pieceFrames = Math.max(
    1,
    Math.min(Math.round((PIECE_MS * format.rate) / 1000), Math.floor((FRAME_LIMIT - 5) / (2 * format.channels))),
  );
  const piece = pieceFrames * format.channels;
  const write = (pcm: Int16Array): Effect.Effect<void, DeviceRefused> => {
    if (!isWhole(format, pcm)) return Effect.die(new PartialFrame(pcm.length, format.channels));
    return writing.withPermits(1)(
      Effect.gen(function* () {
        for (let at = 0; at < pcm.length; at += piece) {
          const part = pcm.subarray(at, Math.min(pcm.length, at + piece));
          const ms = millisOf(format, part.length / format.channels);
          let sent = false;
          while (!sent) {
            yield* resource.room(ms);
            sent = yield* admit(() => {
              if (!resource.fits(ms)) return Effect.succeed(false);
              resource.reserve(ms);
              return Effect.as(session.sendBytes(clientAudio(id, part)), true);
            });
          }
        }
      }),
    );
  };
  return {
    format,
    write,
    mark: (mark) =>
      admit(() => {
        const outcome = resource.expect(mark);
        return session.send({ type: 'mark', id, mark }).pipe(Effect.as(Deferred.await(outcome)));
      }),
    clear: Effect.asVoid(Effect.exit(admit(() => session.send({ type: 'clear', id })))),
  };
});

export const mute = Effect.fnUntraced(function* (client: Holder): Effect.fn.Return<void, DeviceRefused, Scope.Scope> {
  const session = yield* client.hold;
  const opened = Deferred.makeUnsafe<void, DeviceRefused>();
  const resource = new Hold(opened);
  const id = session.allocate(resource);
  yield* Effect.addFinalizer(() =>
    resource.refusedAtOpen ? Effect.void : Effect.asVoid(Effect.exit(session.send({ type: 'unmute', id }))),
  );
  yield* session.send({ type: 'mute', id });
  yield* Deferred.await(opened);
});
