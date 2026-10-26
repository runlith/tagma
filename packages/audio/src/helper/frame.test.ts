import { describe, expect, test } from 'bun:test';
import { Result } from 'effect';
import { encodeHelper, type Frame, FRAME_LIMIT, FrameReader, helperAudio, readHelper, readHelperAudio } from './frame.ts';

const joined = (parts: ReadonlyArray<Uint8Array>): Uint8Array => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
};

describe('helper frames', () => {
  test('frames split at any byte boundary decode to the same messages', () => {
    const stream = joined([
      encodeHelper({ type: 'hello', token: 'abc', nowNs: 9_007_199_254_740_993n }),
      helperAudio(7, 123_456_789_012n, Int16Array.of(1, -2, 32767, -32768)),
      encodeHelper({ type: 'gap', id: 7, fromNs: 5n, cause: 'overflow' }),
    ]);
    const reader = new FrameReader();
    const frames: Array<Frame> = [];
    for (let at = 0; at < stream.length; at += 3) frames.push(...reader.push(stream.subarray(at, at + 3)));

    expect(frames.map((frame) => frame.kind)).toEqual(['control', 'audio', 'control']);
    const hello = frames[0]!.kind === 'control' ? readHelper(frames[0]!.text) : Result.fail('');
    expect(Result.getOrThrow(hello)).toEqual({ type: 'hello', token: 'abc', nowNs: 9_007_199_254_740_993n });
    const audio = frames[1]!.kind === 'audio' ? readHelperAudio(frames[1]!.body) : Result.fail('');
    const { id, at, pcm } = Result.getOrThrow(audio);
    expect([id, at, Array.from(pcm)]).toEqual([7, 123_456_789_012n, [1, -2, 32767, -32768]]);
  });

  test('a frame over the limit breaks the stream', () => {
    const head = new Uint8Array(5);
    new DataView(head.buffer).setUint32(0, FRAME_LIMIT + 1, true);
    expect(new FrameReader().push(head).map((frame) => frame.kind)).toEqual(['broken']);
  });

  test('an extra field in a control message is a mismatch', () => {
    expect(Result.isFailure(readHelper('{"type":"end","id":1,"reason":"drained","extra":true}'))).toBe(true);
  });
});
