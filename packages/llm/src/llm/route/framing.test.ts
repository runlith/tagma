import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Cause, Effect, Exit, Stream } from 'effect';
import * as Sse from 'effect/encoding/Sse';
import type { LLMError } from '../schema/errors';
import * as Framing from './framing';

const encoder = new TextEncoder();

const byteStream = (chunks: ReadonlyArray<Uint8Array>): Stream.Stream<Uint8Array, LLMError> => Stream.fromIterable(chunks);

const framesBytes = (chunks: ReadonlyArray<Uint8Array>) => Stream.runCollect(Framing.sse.frame(byteStream(chunks)));

const frames = (chunks: ReadonlyArray<string>) => framesBytes(chunks.map((chunk) => encoder.encode(chunk)));

const cut = (text: string, size: number) => {
  const parts: string[] = [];
  for (let at = 0; at < text.length; at += size) parts.push(text.slice(at, at + size));
  return parts;
};

it.effect('an event split mid-line across reads arrives whole', () =>
  Effect.gen(function* () {
    expect(yield* frames(['event: message\ndata: {"a"', ':1,"b":2}\n\n'])).toEqual(['{"a":1,"b":2}']);
  }),
);

it.effect('a data field spanning several lines keeps its newlines', () =>
  Effect.gen(function* () {
    expect(yield* frames(['data: first\ndata: second\ndata: third\n\n'])).toEqual(['first\nsecond\nthird']);
  }),
);

it.effect('CRLF split between reads remains one line ending', () =>
  Effect.gen(function* () {
    expect(yield* frames(['event: delta\r', '\ndata: {"n":1}\r', '\n\r', '\n'])).toEqual(['{"n":1}']);
  }),
);

it.effect('a bare CR ends every line and dispatches the event', () =>
  Effect.gen(function* () {
    const text = 'event: delta\rdata: {"n":1}\r\revent: delta\rdata: {"n":2}\r\r';
    expect(yield* frames([text])).toEqual(['{"n":1}', '{"n":2}']);
  }),
);

it.effect('UTF-8 split inside a multibyte character decodes once and arrives whole', () =>
  Effect.gen(function* () {
    const body = encoder.encode('data: før 💥 after\n\n');
    const split = body.indexOf(0xf0) + 2;
    expect(yield* framesBytes([body.slice(0, split), body.slice(split)])).toEqual(['før 💥 after']);
  }),
);

it.effect('a 1,000-line data event joins its payload once in order', () =>
  Effect.gen(function* () {
    const values = Array.from({ length: 1_000 }, (_, index) => `line-${index}`);
    const text = `${values.map((value) => `data: ${value}\n`).join('')}\n`;
    expect(yield* frames(cut(text, 97))).toEqual([values.join('\n')]);
  }),
);

it.effect('comment, id and retry lines carry no frame', () =>
  Effect.gen(function* () {
    const text = ': keep-alive\nid: 7\nretry: 3000\ndata: {"n":1}\n\n:\n\ndata: {"n":2}\n\n';
    expect(yield* frames([text])).toEqual(['{"n":1}', '{"n":2}']);
  }),
);

it.effect('empty payloads and [DONE] never reach the protocol', () =>
  Effect.gen(function* () {
    expect(yield* frames(['data: {"n":1}\n\ndata: \n\ndata: [DONE]\n\n'])).toEqual(['{"n":1}']);
  }),
);

it.effect('a value keeps every space but the one the format inserts', () =>
  Effect.gen(function* () {
    expect(yield* frames(['data:  padded \n\ndata:tight\n\n'])).toEqual([' padded ', 'tight']);
  }),
);

it.effect('an event past the size ceiling fails the stream as provider output', () =>
  Effect.gen(function* () {
    const exit = yield* Effect.exit(frames([`data: ${'x'.repeat(11 * 1024 * 1024)}`]));
    expect(Exit.isFailure(exit)).toBe(true);
    if (!Exit.isFailure(exit)) return;
    const error = Cause.findErrorOption(exit.cause);
    expect(error._tag === 'Some' && error.value.reason._tag).toBe('InvalidProviderOutput');
  }),
);

it.effect('a trailing event with no blank line is not invented', () =>
  Effect.gen(function* () {
    expect(yield* frames(['data: {"n":1}\n\ndata: {"n":2}\n'])).toEqual(['{"n":1}']);
  }),
);

it.effect('every read size and line ending frames the same events the SSE grammar defines', () =>
  Effect.gen(function* () {
    const fixture = (lineEnd: string) =>
      [
        ['event: content_block_delta', 'data: {"type":"content_block_delta","delta":{"text":"one"}}', ''],
        [': ping', ''],
        ['event: content_block_delta', 'data: {"type":"content_block_delta","delta":{"text":"two, with: a colon"}}', ''],
        ['id: 42', 'data: line one', 'data: line two', ''],
        ['data: [DONE]', ''],
      ]
        .flat()
        .join(lineEnd) + lineEnd;

    for (const lineEnd of ['\n', '\r\n', '\r']) {
      const text = fixture(lineEnd);
      const oracle: string[] = [];
      const parser = Sse.makeParser((event) => {
        if (event._tag === 'Event' && event.data.length > 0 && event.data !== '[DONE]') oracle.push(event.data);
      });
      parser.feed(text);

      for (const size of [1, 3, 7, 64, 1024, text.length]) {
        expect(yield* frames(cut(text, size))).toEqual(oracle);
      }
    }
  }),
);
