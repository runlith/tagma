import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Stream } from 'effect';
import { frames } from './pipe.js';

const bytes = (text: string) => new TextEncoder().encode(text);

it.effect('messages split by NUL come out whole across chunk borders, multibyte characters included', () =>
  Effect.gen(function* () {
    const whole = bytes('{"id":1,"result":"привет"}\0{"method":"A"}\0{"id":2');
    const chunks = [whole.subarray(0, 21), whole.subarray(21, 30), whole.subarray(30), bytes(',"result":{}}\0')];
    const read = yield* Stream.runCollect(frames(Stream.fromIterable(chunks)));
    expect(read).toEqual(['{"id":1,"result":"привет"}', '{"method":"A"}', '{"id":2,"result":{}}']);
  }),
);
