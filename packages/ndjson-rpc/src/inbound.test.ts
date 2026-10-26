import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Stream } from 'effect';
import { frame, type Envelope } from './envelope';
import { inbound, type ExchangeRead } from './exchange';

const encoder = new TextEncoder();

const source = (script: string, size = 64 * 1024): ExchangeRead => {
  const bytes = encoder.encode(script);
  return (offset) => {
    const chunks: Array<Uint8Array> = [];
    for (let at = Number(offset); at < bytes.length; at += size) chunks.push(bytes.slice(at, at + size));
    return Stream.fromIterable(chunks);
  };
};

const envelopes: ReadonlyArray<Envelope> = [
  { _tag: 'Request', id: 'agent-7', method: 'session/request_permission', params: { sessionId: 's' } },
  { _tag: 'Notification', method: 'session/update', params: { sessionId: 's', update: { sessionUpdate: 'plan', entries: [] } } },
  { _tag: 'Result', id: 'i1:2', result: { stopReason: 'end_turn' } },
  { _tag: 'Error', id: 3, error: { code: -32601, message: 'Method not found' } },
  { _tag: 'Request', id: 4, method: 'fs/read_text_file' },
];

describe('reading JSON-RPC envelopes in both directions from a byte offset', () => {
  it.effect('every envelope comes back in order with the offset after its line, whoever sent it and whatever its id', () =>
    Effect.gen(function* () {
      const script = envelopes.map(frame).join('');
      const received = yield* Stream.runCollect(inbound(source(script, 7), { offset: 0n, torn: false }, 64 * 1024));
      expect(received.map((item) => item.message)).toEqual([...envelopes]);
      expect(received.at(-1)?.end).toBe(BigInt(encoder.encode(script).length));
    }),
  );

  it.effect('reading again from an envelope end yields exactly the envelopes after it', () =>
    Effect.gen(function* () {
      const read = source(envelopes.map(frame).join(''), 5);
      const first = yield* Stream.runCollect(inbound(read, { offset: 0n, torn: false }, 64 * 1024));
      const resumed = yield* Stream.runCollect(inbound(read, { offset: first[1]!.end, torn: false }, 64 * 1024));
      expect(resumed).toEqual(first.slice(2));
    }),
  );

  it.effect('a line that is not JSON is reported and the lines after it still arrive', () =>
    Effect.gen(function* () {
      const received = yield* Stream.runCollect(
        inbound(source(`stray log\n${frame(envelopes[2]!)}`), { offset: 0n, torn: false }, 64 * 1024),
      );
      expect(received.map((item) => item.message._tag)).toEqual(['Malformed', 'Result']);
    }),
  );

  it.effect('a torn start skips the partial line up to the first whole envelope', () =>
    Effect.gen(function* () {
      const received = yield* Stream.runCollect(inbound(source(envelopes.map(frame).join('')), { offset: 3n, torn: true }, 64 * 1024));
      expect(received.map((item) => item.message)).toEqual(envelopes.slice(1));
    }),
  );

  it.effect('a line past the ceiling fails with its start after the lines before it, without waiting for its end', () =>
    Effect.gen(function* () {
      const before = frame(envelopes[1]!);
      const read: ExchangeRead = () => Stream.concat(Stream.make(encoder.encode(`${before}${'x'.repeat(4096)}`)), Stream.never);
      const seen: Array<string> = [];
      const refused = yield* Effect.flip(
        Stream.runForEach(inbound(read, { offset: 0n, torn: false }, 1024), (item) => Effect.sync(() => void seen.push(item.message._tag))),
      );
      expect(seen).toEqual(['Notification']);
      expect(refused).toMatchObject({ _tag: 'ExchangeOversized', start: BigInt(encoder.encode(before).length) });
    }),
  );

  it.effect('a line longer than a mebibyte is parsed and keeps its place between short lines', () =>
    Effect.gen(function* () {
      const long: Envelope = { _tag: 'Result', id: 'i1:9', result: { text: 'y'.repeat(2 * 1024 * 1024) } };
      const script = [envelopes[1]!, long, envelopes[2]!].map(frame).join('');
      const received = yield* Stream.runCollect(inbound(source(script), { offset: 0n, torn: false }, 64 * 1024 * 1024));
      expect(received.map((item) => item.message)).toEqual([envelopes[1]!, long, envelopes[2]!]);
    }),
  );
});
