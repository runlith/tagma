import type { Session } from '@runlith/cdp/session';
import { Deferred, Effect, Schema, Stream } from 'effect';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import { lostPage, navigated, pageFailed, serve } from './stage.js';

const BODY = Buffer.from('<!doctype html><title>Encoder</title>').toString('base64');

const LEVELS: readonly (readonly [level: number, frame: number, rate: number])[] = [
  [0x1f, 3600, 108000],
  [0x28, 8192, 245760],
  [0x2a, 8704, 522240],
  [0x32, 22080, 589824],
  [0x33, 36864, 983040],
  [0x34, 36864, 2073600],
  [0x3c, 139264, 4177920],
  [0x3d, 139264, 8355840],
  [0x3e, 139264, 16711680],
];

const PROFILES = ['6400', '4d00', '42e0'];

export const codecsFor = (width: number, height: number, fps: number): readonly string[] => {
  const blocks = Math.ceil(width / 16) * Math.ceil(height / 16);
  const level = LEVELS.find(([, frame, rate]) => blocks <= frame && blocks * fps <= rate)?.[0];
  return level === undefined ? [] : PROFILES.map((profile) => `avc1.${profile}${level.toString(16)}`);
};

const ENCODER = `(() => {
  const chunks = [];
  let failure = null;
  let encoder = null;
  const bytesOf = (source) => source instanceof ArrayBuffer ? new Uint8Array(source) : new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
  const output = (chunk, meta) => {
    const data = new Uint8Array(chunk.byteLength);
    chunk.copyTo(data);
    const config = meta && meta.decoderConfig;
    chunks.push({
      key: chunk.type === 'key',
      timestamp: chunk.timestamp,
      duration: chunk.duration ?? null,
      data: data.toBase64(),
      config: config ? { codec: config.codec, codedWidth: config.codedWidth, codedHeight: config.codedHeight, description: config.description ? bytesOf(config.description).toBase64() : null } : null,
    });
  };
  const settled = async () => {
    while (failure === null && encoder.encodeQueueSize > 2) await new Promise((done) => encoder.addEventListener('dequeue', done, { once: true }));
    if (failure !== null) throw failure;
    return chunks.splice(0);
  };
  let canvas = null;
  const fitted = (bitmap) => {
    const { width, height } = canvas.canvas;
    const scale = Math.min(width / bitmap.width, height / bitmap.height);
    const drawn = { width: bitmap.width * scale, height: bitmap.height * scale };
    canvas.fillStyle = '#000';
    canvas.fillRect(0, 0, width, height);
    canvas.drawImage(bitmap, (width - drawn.width) / 2, (height - drawn.height) / 2, drawn.width, drawn.height);
    return canvas.canvas;
  };
  window.tagmaEncoder = {
    open: async (codecs, width, height, fps, bitrate) => {
      if (typeof VideoEncoder !== 'function' || typeof Uint8Array.fromBase64 !== 'function') return null;
      for (const codec of codecs) {
        const config = { codec, width, height, framerate: fps, bitrate, latencyMode: 'quality', avc: { format: 'avc' } };
        const answer = await VideoEncoder.isConfigSupported(config).catch(() => ({ supported: false }));
        if (!answer.supported) continue;
        encoder = new VideoEncoder({ output, error: (error) => { failure = error; } });
        encoder.configure(config);
        canvas = new OffscreenCanvas(width, height).getContext('2d');
        return codec;
      }
      return null;
    },
    frame: async (data, timestamp, duration, key) => {
      const bitmap = await createImageBitmap(new Blob([Uint8Array.fromBase64(data)], { type: 'image/jpeg' }));
      const same = bitmap.width === canvas.canvas.width && bitmap.height === canvas.canvas.height;
      const frame = new VideoFrame(same ? bitmap : fitted(bitmap), { timestamp, duration });
      bitmap.close();
      encoder.encode(frame, { keyFrame: key });
      frame.close();
      return settled();
    },
    flush: async () => {
      await encoder.flush();
      return settled();
    },
  };
  return true;
})()`;

const chunkSchema = Schema.Struct({
  key: Schema.Boolean,
  timestamp: Schema.Finite,
  duration: Schema.NullOr(Schema.Finite),
  data: Schema.String,
  config: Schema.NullOr(
    Schema.Struct({
      codec: Schema.String,
      codedWidth: Schema.Int,
      codedHeight: Schema.Int,
      description: Schema.NullOr(Schema.String),
    }),
  ),
});

export type Chunk = typeof chunkSchema.Type;

const readChunks = Schema.decodeUnknownEffect(Schema.Array(chunkSchema));

export type Encoding = { readonly width: number; readonly height: number; readonly fps: number; readonly bitrate: number };

export const encoder = Effect.fnUntraced(function* (session: Session, size: Encoding) {
  const loaded = yield* Deferred.make<void>();
  const failed = yield* Deferred.make<never, GateRefusal<'page-failed'>>();
  const events = yield* session.events((method) => method === 'Fetch.requestPaused' || method === 'Page.loadEventFired');
  yield* Stream.runForEach(events, (event) =>
    event.child !== undefined
      ? Effect.void
      : event.method === 'Fetch.requestPaused'
        ? serve(session, BODY, event)
        : Deferred.succeed(loaded, undefined),
  ).pipe(
    Effect.mapError(lostPage),
    Effect.andThen(Effect.fail(pageFailed('the browser closed the video encoder before the video was written'))),
    Effect.catchTag('GateRefusal', (refusal) => Deferred.fail(failed, refusal)),
    Effect.forkScoped,
  );
  yield* navigated(session);
  yield* Effect.raceFirst(Deferred.await(loaded), Deferred.await(failed));

  const call = (expression: string) =>
    session.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }).pipe(
      Effect.mapError(lostPage),
      Effect.flatMap((answer) =>
        answer.exceptionDetails === undefined
          ? Effect.succeed(answer.result.value as unknown)
          : Effect.fail(
              pageFailed(
                `the video encoder failed: ${String(answer.exceptionDetails.exception?.description ?? answer.exceptionDetails.text)}`,
              ),
            ),
      ),
    );
  const drained = (expression: string) => Effect.flatMap(call(expression), (value) => Effect.orDie(readChunks(value)));

  yield* call(ENCODER);
  const codecs = codecsFor(size.width, size.height, size.fps);
  const chosen = yield* call(`tagmaEncoder.open(${JSON.stringify(codecs)}, ${size.width}, ${size.height}, ${size.fps}, ${size.bitrate})`);
  if (typeof chosen !== 'string') {
    return yield* new GateRefusal(
      'codec-unavailable',
      codecs.length === 0
        ? `no H.264 level holds ${size.width}×${size.height} at ${size.fps} fps`
        : `the browser that draws pages has no H.264 encoder for ${size.width}×${size.height} at ${size.fps} fps (asked ${codecs.join(', ')})`,
      ['export at scale 1, or declare a smaller size or a lower fps and publish the page again'],
    );
  }
  const time = (k: number) => Math.round((k * 1e6) / size.fps);
  const keyEvery = size.fps * 2;
  let keyed = -1;
  return {
    frame: (picture: string, at: number, span: number) =>
      Effect.suspend(() => {
        const key = Math.floor(at / keyEvery) !== keyed;
        keyed = Math.floor(at / keyEvery);
        return drained(`tagmaEncoder.frame(${JSON.stringify(picture)}, ${time(at)}, ${time(at + span) - time(at)}, ${key})`);
      }),
    flush: drained('tagmaEncoder.flush()'),
  };
});

export const ENCODER_CANVAS = { width: 16, height: 16, scale: 1 } as const;
