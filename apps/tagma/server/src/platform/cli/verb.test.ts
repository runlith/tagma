import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Sink, Stdio } from 'effect';
import { print } from './verb.js';

it.effect('print writes one complete machine document beyond the stdout high-water mark', () =>
  Effect.gen(function* () {
    const chunks: string[] = [];
    const value = { payload: 'x'.repeat(80 * 1024) };

    yield* print(value, true).pipe(
      Effect.provide(
        Stdio.layerTest({
          stdout: () =>
            Sink.forEach((chunk: string | Uint8Array) =>
              Effect.sync(() => {
                chunks.push(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk));
              }),
            ),
        }),
      ),
    );

    const output = chunks.join('');
    expect(output.length).toBeGreaterThan(65_536);
    expect(JSON.parse(output)).toEqual(value);
  }),
);
