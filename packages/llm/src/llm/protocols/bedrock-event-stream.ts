import type { EventStreamCodec } from '@smithy/eventstream-codec';
import { Effect, Stream } from 'effect';
import type { Framing } from '../route/framing';
import * as ProviderShared from './shared';

const utf8 = new TextDecoder();

const eventCodec = Effect.promise(async () => {
  const [codec, text] = await Promise.all([import('@smithy/eventstream-codec'), import('@smithy/util-utf8')]);
  return new codec.EventStreamCodec(text.toUtf8, text.fromUtf8);
});

interface FrameBufferState {
  readonly buffer: Uint8Array;
  readonly offset: number;
}

const initialFrameBuffer: FrameBufferState = { buffer: new Uint8Array(0), offset: 0 };

const appendChunk = (state: FrameBufferState, chunk: Uint8Array): FrameBufferState => {
  const remaining = state.buffer.length - state.offset;
  const next = new Uint8Array(remaining + chunk.length);
  next.set(state.buffer.subarray(state.offset), 0);
  next.set(chunk, remaining);
  return { buffer: next, offset: 0 };
};

const consumeFrames = (route: string, codec: EventStreamCodec) =>
  Effect.fnUntraced(function* (state: FrameBufferState, chunk: Uint8Array) {
    let cursor = appendChunk(state, chunk);
    const out: object[] = [];
    while (cursor.buffer.length - cursor.offset >= 4) {
      const view = cursor.buffer.subarray(cursor.offset);
      const totalLength = new DataView(view.buffer, view.byteOffset, view.byteLength).getUint32(0, false);
      if (view.length < totalLength) break;

      const decoded = yield* Effect.try({
        try: () => codec.decode(view.subarray(0, totalLength)),
        catch: (cause) =>
          ProviderShared.failureOf(cause, {
            route,
            message: 'Failed to decode a Bedrock Converse event-stream frame',
            family: 'invalid-output',
          }),
      });
      cursor = { buffer: cursor.buffer, offset: cursor.offset + totalLength };

      if (decoded.headers[':message-type']?.value !== 'event') continue;
      const eventType = decoded.headers[':event-type']?.value;
      if (typeof eventType !== 'string') continue;
      const payload = utf8.decode(decoded.body);
      if (!payload) continue;
      const parsed = (yield* ProviderShared.parseJson(route, payload, 'Failed to parse Bedrock Converse event-stream payload')) as Record<
        string,
        unknown
      >;
      delete parsed.p;
      out.push({ [eventType]: parsed });
    }
    return [cursor, out] as const;
  });

export const framing = (route: string): Framing<object> => ({
  id: 'aws-event-stream',
  frame: (bytes) =>
    Stream.unwrap(
      Effect.map(eventCodec, (codec) => bytes.pipe(Stream.mapAccumEffect(() => initialFrameBuffer, consumeFrames(route, codec)))),
    ),
});
