import { Effect, Queue, Stream } from 'effect';
import { Render } from '../artifacts/contract/service/render.js';
import { frameTime } from '../artifacts/contract/wire/timeline.js';
import { type CaptureHost, type HostFailure, Hosts } from '../browser/contract/service/hosts.js';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import { type Stage, stage } from './stage.js';

const away = () =>
  new GateRefusal('host-away', 'no browser host that draws pages out of sight is connected to this server', [
    'call again once the server has finished starting',
  ]);

export const unavailable = (failure: HostFailure) =>
  failure._tag === 'HostRefused'
    ? new GateRefusal('browser-unavailable', `the browser that draws pages cannot start: ${failure.message}`, failure.unblock)
    : new GateRefusal('browser-unavailable', `the browser could not open a capture target: ${failure.message}`, [
        'try drawing again to open a new capture target; if the browser refuses again, report the browser failure with this reason',
      ]);

export const capturing = Effect.fnUntraced(function* (hosts: Hosts['Service']) {
  const capture: CaptureHost | undefined =
    [...hosts.adapters()].map((adapter) => hosts.connected(adapter)?.capture ?? null).find((one) => one !== null) ?? undefined;
  if (capture === undefined) return yield* away();
  return capture;
});

export const makeRender = Effect.gen(function* () {
  const hosts = yield* Hosts;

  return Render.of({
    frames: (footage) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const capture = yield* capturing(hosts);
          const targets = Math.max(1, Math.min(footage.targets, footage.frames.length));
          const canvas = { width: footage.timeline.width, height: footage.timeline.height, scale: footage.scale };
          const body = Buffer.from(footage.html).toString('base64');
          const free = yield* Queue.bounded<Stage>(targets);
          yield* Effect.forEach(
            Array.from({ length: targets }, (_, at) => at),
            () =>
              capture.target(canvas).pipe(
                Effect.mapError(unavailable),
                Effect.flatMap((session) => stage(session, body, footage.image)),
                Effect.flatMap((opened) => Queue.offer(free, opened)),
              ),
            { concurrency: targets, discard: true },
          ).pipe(Effect.withSpan('Render.open', { attributes: { targets } }));
          return Stream.fromIterable(footage.frames).pipe(
            Stream.mapEffect(
              (k) =>
                Effect.acquireUseRelease(
                  Queue.take(free),
                  (opened) => Effect.map(opened.draw(frameTime(footage.timeline, k)), (bytes) => ({ k, bytes })),
                  (opened) => Queue.offer(free, opened),
                ).pipe(Effect.withSpan('Render.frame')),
              { concurrency: targets },
            ),
          );
        }),
      ),
  });
});
