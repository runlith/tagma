import type { CommandFailure, Session } from '@runlith/cdp/session';
import type { Protocol } from 'devtools-protocol';
import { Effect, Scope } from 'effect';
import { actionFailed, type Box } from './target.js';

export const pngSize = (bytes: Uint8Array): { readonly width: number | null; readonly height: number | null } => {
  if (bytes.length < 24 || bytes[12] !== 0x49 || bytes[13] !== 0x48 || bytes[14] !== 0x44 || bytes[15] !== 0x52)
    return { width: null, height: null };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
};

export type Pictures = {
  capture(params: Protocol.Page.CaptureScreenshotRequest): Effect.Effect<string, CommandFailure>;
  readonly paint: Effect.Effect<void, CommandFailure>;
  accepts(target: Protocol.Target.TargetInfo): boolean;
};

export const makePictures = Effect.fnUntraced(function* (session: Session) {
  const scope = yield* Effect.scope;
  let target: string | null = null;
  const channel = yield* Effect.cached(
    Scope.provide(
      Effect.acquireRelease(
        Effect.gen(function* () {
          const { targetInfo } = yield* session.send('Target.getTargetInfo');
          target = targetInfo.targetId;
          return (yield* session.send('Target.attachToTarget', { targetId: target, flatten: true })).sessionId;
        }).pipe(Effect.withSpan('browser.pictureSession')),
        (sessionId) =>
          session.send('Target.detachFromTarget', { sessionId }).pipe(
            Effect.catchTag('SessionEnded', () => Effect.void),
            Effect.orDie,
          ),
      ),
      scope,
    ),
  );
  const paint = Effect.gen(function* () {
    const child = yield* channel;
    yield* session.reply(
      'Page.captureScreenshot',
      { format: 'jpeg', quality: 0, optimizeForSpeed: true, captureBeyondViewport: false },
      child,
    );
  }).pipe(Effect.withSpan('browser.paint'));
  return {
    paint,
    accepts: (info) => info.type === 'page' && info.targetId === target,
    capture: Effect.fn('browser.capture')(function* (params) {
      yield* channel;
      return yield* Effect.uninterruptible(
        Effect.gen(function* () {
          const result = yield* Effect.result(session.reply('Page.captureScreenshot', params));
          yield* paint;
          return yield* Effect.fromResult(result);
        }),
      );
    }),
  } satisfies Pictures;
});

export const crop = Effect.fn('browser.crop')(function* (bytes: Uint8Array, box: Box, scale: number) {
  const size = pngSize(bytes);
  if (size.width === null || size.height === null) return yield* actionFailed('the page returned a picture without PNG dimensions');
  const left = Math.max(0, Math.round(box.x * scale));
  const top = Math.max(0, Math.round(box.y * scale));
  const region = {
    left,
    top,
    width: Math.max(1, Math.min(size.width - left, Math.round(box.width * scale))),
    height: Math.max(1, Math.min(size.height - top, Math.round(box.height * scale))),
  };
  return yield* Effect.tryPromise({
    try: async () => {
      const { default: sharp } = await import('sharp');
      return sharp(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength))
        .extract(region)
        .png()
        .toBuffer();
    },
    catch: (cause) => actionFailed(`the captured picture could not be cropped: ${String(cause)}`),
  });
});
