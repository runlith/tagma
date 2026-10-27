import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Fiber, Stream } from 'effect';
import { TestClock } from 'effect/testing';
import { makeExchange } from './exchange';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const scripted = (script: string, sizes: ReadonlyArray<number> = [64 * 1024]) => {
  const bytes = encoder.encode(script);
  const chunks: Array<{ start: number; bytes: Uint8Array }> = [];
  let at = 0;
  let size = 0;
  while (at < bytes.length) {
    const take = sizes[size % sizes.length] ?? 64 * 1024;
    size += 1;
    chunks.push({ start: at, bytes: bytes.slice(at, at + take) });
    at += take;
  }
  const written: Array<string> = [];
  return {
    written,
    write: (out: Uint8Array) => Effect.sync(() => void written.push(decoder.decode(out))),
    read: (offset: bigint) =>
      Stream.fromIterable(
        chunks.flatMap((chunk) =>
          offset >= BigInt(chunk.start + chunk.bytes.length)
            ? []
            : [chunk.bytes.slice(offset > BigInt(chunk.start) ? Number(offset - BigInt(chunk.start)) : 0)],
        ),
      ),
  };
};

const response = (id: number | string, result: unknown) => `${JSON.stringify({ id, result })}\n`;
const failure = (id: number | string, code: number, message: string, data?: unknown) =>
  `${JSON.stringify({ id, error: { code, message, data } })}\n`;
const notice = (method: string, params?: unknown) => `${JSON.stringify({ method, params })}\n`;

describe('a JSON-RPC exchange over newline-delimited bytes', () => {
  it.effect('sends one JSON line per request with sequential integer ids from one', () =>
    Effect.gen(function* () {
      const server = scripted(`${response(1, 'a')}${response(2, 'b')}`);
      const exchange = makeExchange(server);
      yield* exchange.request('first');
      yield* exchange.request('second', { at: 2 });
      expect(server.written).toEqual(['{"id":1,"method":"first"}\n', '{"id":2,"method":"second","params":{"at":2}}\n']);
    }),
  );

  it.effect('reassembles a response split one byte at a time', () =>
    Effect.gen(function* () {
      const exchange = makeExchange(scripted(response(1, { thread: { id: 't' } }), [1]));
      expect(yield* exchange.request('read')).toEqual({ thread: { id: 't' } });
    }),
  );

  it.effect('notifications between the request and its answer never resolve it, and stay in the transcript', () =>
    Effect.gen(function* () {
      const exchange = makeExchange(scripted(`${notice('pin')}${notice('turn', { n: 1 })}${response(1, 'done')}`));
      expect(yield* exchange.request('start')).toBe('done');
      expect(exchange.transcript.notifications.map((held) => held.method)).toEqual(['pin', 'turn']);
      expect(exchange.transcript.responses).toEqual([{ id: 1, result: 'done' }]);
    }),
  );

  it.effect('a vendor error answer fails with its code and message, and stays in the transcript', () =>
    Effect.gen(function* () {
      const exchange = makeExchange(scripted(failure(1, -32600, 'no rollout found for thread id t', { id: 't' })));
      expect(yield* Effect.flip(exchange.request('resume'))).toMatchObject({
        _tag: 'ExchangeVendorError',
        code: -32600,
        message: 'no rollout found for thread id t',
        data: { id: 't' },
      });
      expect(exchange.transcript.responses).toEqual([
        { id: 1, error: { code: -32600, message: 'no rollout found for thread id t', data: { id: 't' } } },
      ]);
    }),
  );

  it.effect('a stream that ends before the answer fails EOF, keeping what did arrive', () =>
    Effect.gen(function* () {
      const exchange = makeExchange(scripted(notice('pin')));
      expect(yield* Effect.flip(exchange.request('start'))).toMatchObject({ _tag: 'ExchangeEof' });
      expect(exchange.transcript.notifications.map((held) => held.method)).toEqual(['pin']);
    }),
  );

  it.effect('no answer inside the budget fails Timeout on the test clock', () =>
    Effect.gen(function* () {
      const exchange = makeExchange({ ...scripted(''), read: () => Stream.never });
      const fiber = yield* Effect.forkScoped(Effect.flip(exchange.request('slow', undefined, 1_000)));
      yield* TestClock.adjust('1 second');
      expect(yield* Fiber.join(fiber)).toMatchObject({ _tag: 'ExchangeTimeout' });
    }),
  );

  it.effect('a line that is not JSON fails carrying the line', () =>
    Effect.gen(function* () {
      const exchange = makeExchange(scripted(`a log line escaped to stdout\n${response(1, 'late')}`));
      const refused = yield* Effect.flip(exchange.request('start'));
      expect(refused._tag).toBe('ExchangeFailed');
      expect(refused.message).toContain('a log line escaped to stdout');
    }),
  );

  it.effect('a response for an id never sent fails naming it', () =>
    Effect.gen(function* () {
      const exchange = makeExchange(scripted(response(9, 'stranger')));
      const refused = yield* Effect.flip(exchange.request('start'));
      expect(refused._tag).toBe('ExchangeFailed');
      if (refused._tag === 'ExchangeFailed') expect(refused.detail).toContain('9');
    }),
  );

  it.effect('an integer id never matches its string spelling', () =>
    Effect.gen(function* () {
      const exchange = makeExchange(scripted(response('1', 'quoted')));
      expect(yield* Effect.flip(exchange.request('start'))).toMatchObject({ _tag: 'ExchangeFailed' });
    }),
  );

  it.effect('notifications past 400 are counted as dropped', () =>
    Effect.gen(function* () {
      const exchange = makeExchange(scripted(`${Array.from({ length: 401 }, (_, n) => notice(`n${n}`)).join('')}${response(1, 'done')}`));
      yield* exchange.request('start');
      expect(exchange.transcript.notifications).toHaveLength(400);
      expect(exchange.transcript.droppedNotifications).toBe(1);
    }),
  );

  it.effect('a line past one mebibyte fails naming the cap', () =>
    Effect.gen(function* () {
      const exchange = makeExchange(scripted(`{"id":1,"result":"${'x'.repeat(1024 * 1024)}"}\n`));
      const refused = yield* Effect.flip(exchange.request('start'));
      expect(refused._tag).toBe('ExchangeFailed');
      if (refused._tag === 'ExchangeFailed') expect(refused.detail).toContain('1048576');
    }),
  );

  it.effect('a blank line carries no message and never resolves or refuses', () =>
    Effect.gen(function* () {
      const exchange = makeExchange(scripted(`\n${notice('pin')}\n${response(1, 'done')}\n`));
      expect(yield* exchange.request('start')).toBe('done');
      expect(exchange.transcript.notifications.map((held) => held.method)).toEqual(['pin']);
    }),
  );

  it.effect('cap+1 bytes without a newline on a held-open source refuse for size, not for timeout', () =>
    Effect.gen(function* () {
      const exchange = makeExchange({
        ...scripted(''),
        read: () => Stream.concat(Stream.make(encoder.encode('x'.repeat(1024 * 1024 + 1))), Stream.never),
      });
      const refused = yield* Effect.flip(exchange.request('slow', undefined, 60_000));
      expect(refused._tag).toBe('ExchangeFailed');
      if (refused._tag === 'ExchangeFailed') expect(refused.detail).toContain('1048576');
    }),
  );

  it.effect('a timeout keeps the bounded notifications it already consumed', () =>
    Effect.gen(function* () {
      const exchange = makeExchange({
        ...scripted(''),
        read: () =>
          Stream.concat(Stream.make(encoder.encode(Array.from({ length: 401 }, (_, n) => notice(`n${n}`)).join(''))), Stream.never),
      });
      const fiber = yield* Effect.forkScoped(Effect.flip(exchange.request('slow', undefined, 60_000)));
      yield* TestClock.adjust('1 minute');
      expect(yield* Fiber.join(fiber)).toMatchObject({ _tag: 'ExchangeTimeout' });
      expect(exchange.transcript.notifications).toHaveLength(400);
      expect(exchange.transcript.droppedNotifications).toBe(1);
    }),
  );

  it.effect('a second request while one is outstanding is refused and sends nothing; the guard releases on timeout', () =>
    Effect.gen(function* () {
      const server = scripted('');
      const exchange = makeExchange({ ...server, read: () => Stream.never });
      const first = yield* Effect.forkScoped(Effect.flip(exchange.request('first', undefined, 60_000)));
      yield* Effect.yieldNow;
      const second = yield* Effect.flip(exchange.request('second', undefined, 60_000));
      expect(second._tag).toBe('ExchangeFailed');
      if (second._tag === 'ExchangeFailed') expect(second.detail).toContain('outstanding');
      expect(server.written).toHaveLength(1);
      yield* TestClock.adjust('1 minute');
      expect(yield* Fiber.join(first)).toMatchObject({ _tag: 'ExchangeTimeout' });
      const third = yield* Effect.forkScoped(Effect.flip(exchange.request('third', undefined, 60_000)));
      yield* TestClock.adjust('1 minute');
      expect(yield* Fiber.join(third)).toMatchObject({ _tag: 'ExchangeTimeout' });
    }),
  );

  it.effect('a second request resumes where the first answer ended', () =>
    Effect.gen(function* () {
      const exchange = makeExchange(scripted(`${response(1, 'a')}${notice('between')}${response(2, 'b')}`, [7]));
      expect(yield* exchange.request('first')).toBe('a');
      expect(yield* exchange.request('second')).toBe('b');
      expect(exchange.transcript.requests.map((held) => held.method)).toEqual(['first', 'second']);
      expect(exchange.transcript.notifications.map((held) => held.method)).toEqual(['between']);
    }),
  );
});
