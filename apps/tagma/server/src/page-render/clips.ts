import { Effect } from 'effect';
import { VIDEO_BITS_PER_PIXEL } from '../artifacts/contract/service/film.js';
import { ClipFailed, Clips } from '../browser/contract/service/clips.js';
import { Hosts } from '../browser/contract/service/hosts.js';
import type { GateRefusal } from '../platform/contract/wire/refusal.js';
import { ENCODER_CANVAS, encoder } from './encoder.js';
import { muxer } from './mux.js';
import { capturing, unavailable } from './render.js';

const even = (length: number) => Math.max(2, length - (length % 2));

const refused = (refusal: GateRefusal) => new ClipFailed({ message: refusal.reason });

export const makeClips = Effect.gen(function* () {
  const hosts = yield* Hosts;

  return Clips.of({
    open: Effect.fn('Clips.open')(function* (shape) {
      const width = even(shape.width);
      const height = even(shape.height);
      const capture = yield* capturing(hosts);
      const session = yield* Effect.mapError(capture.target(ENCODER_CANVAS), unavailable);
      const encoding = yield* encoder(session, {
        width,
        height,
        fps: shape.fps,
        bitrate: Math.round(width * height * shape.fps * VIDEO_BITS_PER_PIXEL),
      });
      const muxing = yield* muxer({ file: shape.file, fps: shape.fps, total: null });
      return {
        width,
        height,
        frame: (picture: string, at: number, span: number) =>
          encoding.frame(picture, at, span).pipe(Effect.flatMap(muxing.add), Effect.mapError(refused), Effect.withSpan('Clips.frame')),
        finish: encoding.flush.pipe(
          Effect.flatMap(muxing.add),
          Effect.andThen(muxing.finish),
          Effect.mapError(refused),
          Effect.withSpan('Clips.finish'),
        ),
      };
    }, Effect.mapError(refused)),
  });
});
