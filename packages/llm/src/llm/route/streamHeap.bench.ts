import { gcAndSweep, heapStats } from 'bun:jsc';
import { Effect, Schema, Stream } from 'effect';
import * as Sse from 'effect/encoding/Sse';
import { LLMRequest, Message } from '../schema/messages';
import { Model } from '../schema/options';
import * as AnthropicMessages from '../protocols/anthropic-messages';
import * as Framing from './framing';

const OLD = process.argv.includes('--old');
const STREAMS = 8;
const DELTAS = 4000;
const READ_BYTES = 16 * 1024;

const encoder = new TextEncoder();

const deltaMessage = (index: number) =>
  `event: content_block_delta\ndata: ${JSON.stringify({
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'text_delta', text: `token ${index} of the answer, ` },
  })}\n\n`;

const body = () => {
  const text = [
    `event: message_start\ndata: ${JSON.stringify({
      type: 'message_start',
      message: { usage: { input_tokens: 12, output_tokens: 1 } },
    })}\n\n`,
    `event: content_block_start\ndata: ${JSON.stringify({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' },
    })}\n\n`,
    ...Array.from({ length: DELTAS }, (_, index) => deltaMessage(index)),
    `event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: 0 })}\n\n`,
  ].join('');
  const chunks: Uint8Array[] = [];
  for (let at = 0; at < text.length; at += READ_BYTES) chunks.push(encoder.encode(text.slice(at, at + READ_BYTES)));
  return chunks;
};

const oldFraming = (bytes: Stream.Stream<Uint8Array, never>) =>
  bytes.pipe(
    Stream.decodeText(),
    Stream.pipeThroughChannel(Sse.decode()),
    Stream.catchTag('Retry', () => Stream.empty),
    Stream.catchTag('SseError', () => Stream.empty),
    Stream.filter((event) => event.data.length > 0 && event.data !== '[DONE]'),
    Stream.map((event) => event.data),
  );

const request = new LLMRequest({
  model: Model.make({ id: 'bench', provider: 'anthropic', route: AnthropicMessages.route }),
  system: [],
  messages: [Message.user('hello')],
  tools: [],
});

const decodeEvent = Schema.decodeUnknownEffect(AnthropicMessages.protocol.stream.event);

const turn = Effect.gen(function* () {
  const bytes: Stream.Stream<Uint8Array, never> = Stream.fromIterable(body());
  const frames = OLD ? oldFraming(bytes) : Framing.sse.frame(bytes as never);
  let state = AnthropicMessages.protocol.stream.initial(request);
  let events = 0;
  yield* Stream.runForEach(frames as Stream.Stream<string, never>, (frame) =>
    Effect.gen(function* () {
      const parsed = yield* Effect.orDie(decodeEvent(frame));
      const stepped = AnthropicMessages.protocol.stream.step(state, parsed as never) as Effect.Effect<
        readonly [typeof state, ReadonlyArray<unknown>],
        unknown
      >;
      const [next, produced] = yield* Effect.orDie(OLD ? Effect.withSpan(stepped, 'AnthropicMessages.onContentBlockDelta') : stepped);
      state = next;
      events += produced.length;
    }),
  );
  return events;
});

const reading = (label: string) => {
  const stats = heapStats();
  const usage = process.memoryUsage();
  const types = Object.entries(stats.objectTypeCounts)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3)
    .map(([name, count]) => `${name} ${(count / 1000).toFixed(0)}k`)
    .join(', ');
  console.log(
    `  ${label.padEnd(22)} heapUsed ${(usage.heapUsed / 1024 / 1024).toFixed(0).padStart(4)} MB` +
      `   objects ${(stats.objectCount / 1e6).toFixed(2)}M   rss ${(usage.rss / 1024 / 1024).toFixed(0).padStart(5)} MB   ${types}`,
  );
  return usage.heapUsed;
};

console.log(
  `\n${STREAMS} concurrent streams x ${DELTAS} deltas, ${READ_BYTES / 1024} KiB reads` +
    ` — ${OLD ? 'the shapes this replaced' : 'as it stands'}\n`,
);

gcAndSweep();
const before = reading('before');
const started = performance.now();
const counts = await Effect.runPromise(
  Effect.all(
    Array.from({ length: STREAMS }, () => turn),
    { concurrency: STREAMS },
  ),
);
const elapsed = performance.now() - started;
const peak = reading('after the streams');

gcAndSweep();
gcAndSweep();
const settled = reading('after gcAndSweep');

console.log(
  `\n  wall ${(elapsed / 1000).toFixed(2)} s for ${counts.reduce((sum, n) => sum + n, 0)} events` +
    `\n  in flight at the peak  ${((peak - before) / 1024 / 1024).toFixed(1)} MB` +
    `\n  RETAINED after sweep   ${((settled - before) / 1024 / 1024).toFixed(1)} MB`,
);
process.exit(0);
