import { Effect, Stream } from 'effect';
import * as Sse from 'effect/encoding/Sse';
import type { LLMError } from '../schema/errors';
import * as Framing from './framing';

const encoder = new TextEncoder();

const deltaMessage = (index: number) =>
  `event: content_block_delta\ndata: ${JSON.stringify({
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'text_delta', text: `token ${index} of the answer, ` },
  })}\n\n`;

const completedMessage = (bytes: number) =>
  `event: response.completed\ndata: ${JSON.stringify({
    type: 'response.completed',
    response: { id: 'resp_1', output: [{ type: 'output_text', text: 'x'.repeat(bytes) }] },
  })}\n\n`;

const manyDataLinesMessage = (bytes: number, lines: number) => {
  const value = 'x'.repeat(Math.ceil(bytes / lines));
  return `event: response.completed\n${Array.from({ length: lines }, () => `data: ${value}\n`).join('')}\n`;
};

const cut = (text: string, size: number) => {
  const parts: string[] = [];
  for (let at = 0; at < text.length; at += size) parts.push(text.slice(at, at + size));
  return parts;
};

const upstream = (chunks: ReadonlyArray<string>) => {
  const parser = Sse.makeParser(() => {});
  for (const chunk of chunks) parser.feed(chunk);
};

const ours = (chunks: ReadonlyArray<string>) => {
  const bytes: Stream.Stream<Uint8Array, LLMError> = Stream.fromIterable(chunks.map((chunk) => encoder.encode(chunk)));
  return Effect.runSync(Stream.runCount(Framing.sse.frame(bytes)));
};

const time = (run: () => void, repeats: number) => {
  for (let warm = 0; warm < 2; warm++) run();
  const started = performance.now();
  for (let pass = 0; pass < repeats; pass++) run();
  return (performance.now() - started) / repeats;
};

const stream = Array.from({ length: 2000 }, (_, index) => deltaMessage(index)).join('');

console.log(`\n2000 Anthropic delta messages — ${(stream.length / 1024).toFixed(0)} KiB — by socket read size:\n`);
console.log('  read size    lines/read    effect Sse.makeParser    Framing.sse');
for (const size of [140, 512, 4096, 16384, 65536, 262144]) {
  const chunks = cut(stream, size);
  const repeats = size > 40000 ? 3 : 10;
  const upstreamMs = time(() => upstream(chunks), repeats);
  const oursMs = time(() => ours(chunks), repeats);
  const lines = (stream.split('\n').length - 1) / chunks.length;
  console.log(
    `  ${String(size).padStart(7)} B ${lines.toFixed(0).padStart(12)}` +
      `${`${upstreamMs.toFixed(2)} ms`.padStart(23)}${`${oursMs.toFixed(2)} ms`.padStart(15)}`,
  );
}

const large = cut(completedMessage(500 * 1024), 16 * 1024);
console.log(`\nOne 500 KB event in 16 KiB reads — what a growing buffer alone costs:`);
console.log(`  effect Sse.makeParser  ${time(() => upstream(large), 20).toFixed(2)} ms`);
console.log(`  Framing.sse            ${time(() => ours(large), 20).toFixed(2)} ms`);

const manyLines = cut(manyDataLinesMessage(500 * 1024, 1_000), 16 * 1024);
console.log(`\nOne 500 KB event across 1,000 data lines in 16 KiB reads:`);
console.log(`  effect Sse.makeParser  ${time(() => upstream(manyLines), 10).toFixed(2)} ms`);
console.log(`  Framing.sse            ${time(() => ours(manyLines), 10).toFixed(2)} ms`);
