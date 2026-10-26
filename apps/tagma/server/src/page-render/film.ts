import { Effect, Stream } from 'effect';
import { Film, VIDEO_BITS_PER_PIXEL } from '../artifacts/contract/service/film.js';
import { Render } from '../artifacts/contract/service/render.js';
import { frameCount } from '../artifacts/contract/wire/timeline.js';
import { Hosts } from '../browser/contract/service/hosts.js';
import { encoder } from './encoder.js';
import { muxer } from './mux.js';
import { capturing, unavailable } from './render.js';

const QUALITY = 95;

const SMALLEST = { width: 16, height: 16, scale: 1 } as const;

export const makeFilm = Effect.gen(function* () {
  const hosts = yield* Hosts;
  const render = yield* Render;

  return Film.of({
    shoot: (reel) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const { timeline, scale } = reel;
          const width = timeline.width * scale;
          const height = timeline.height * scale;
          const total = frameCount(timeline);
          const capture = yield* capturing(hosts);
          const session = yield* Effect.mapError(capture.target(SMALLEST), unavailable);
          const encoding = yield* encoder(session, {
            width,
            height,
            fps: timeline.fps,
            bitrate: Math.round(width * height * timeline.fps * VIDEO_BITS_PER_PIXEL),
          });
          const muxing = yield* muxer({ file: reel.file, fps: timeline.fps, total });
          const drawn = render
            .frames({
              html: reel.html,
              timeline,
              frames: Array.from({ length: total }, (_, k) => k),
              scale,
              image: { format: 'jpeg', quality: QUALITY },
              targets: reel.targets,
            })
            .pipe(
              Stream.mapEffect((shot) =>
                encoding.frame(shot.k, shot.bytes).pipe(Effect.flatMap(muxing.add), Effect.as(shot.k + 1), Effect.withSpan('Film.frame')),
              ),
            );
          const written = Stream.fromEffect(
            encoding.flush.pipe(
              Effect.flatMap(muxing.add),
              Effect.andThen(muxing.finish),
              Effect.as(total),
              Effect.withSpan('Film.finish'),
            ),
          );
          return Stream.make(0).pipe(Stream.concat(drawn), Stream.concat(written));
        }),
      ),
  });
});
