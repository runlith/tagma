import { Clock, Effect } from 'effect';
import { Message } from '@runlith/llm/schema/messages';
import { replyTurn, scriptedStep } from '@runlith/agent/thread/conformance/runLog/scripts';
import { pump, scriptedWorld } from '@runlith/agent/thread/conformance/runLog/world';
import type { ThreadLiveEvent } from '@runlith/agent/thread/run/ThreadLiveFeed';
import { threadSpokenMessageEvent } from '@runlith/agent/thread/events';
import type { ThreadSnapshot } from '@runlith/agent/thread/state';
import { openThreadStorage } from '../src/composition/testing/storageHarness.js';

const EVENTS = Number(process.argv[2] ?? 1500);
const AGENTS = Number(process.argv[3] ?? 5);
const OPENING_MS = Number(process.argv[4] ?? 300);
const OWNER = 'owner';
const SCOPE = 'scope-a';
type Sample = { ack: number; opened: number; settled: number };

const percentile = (values: readonly number[], share: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(share * (sorted.length - 1)))] ?? 0;
};
const describe = (name: string, values: readonly number[]) =>
  `${name.padEnd(12)} p50 ${percentile(values, 0.5).toFixed(0).padStart(6)} ms · p90 ${percentile(values, 0.9).toFixed(0).padStart(6)} ms · max ${Math.max(
    ...values,
  )
    .toFixed(0)
    .padStart(6)} ms`;

const main = Effect.gen(function* () {
  const clock = yield* Clock.Clock;
  const now = () => Number(clock.monotonicTimeNanosUnsafe()) / 1_000_000;
  const storage = yield* Effect.acquireRelease(openThreadStorage(), (storage) => storage.dispose());
  const threads = yield* Effect.forEach(Array.from({ length: AGENTS }), () => storage.createThread({ ownerId: OWNER, scope: SCOPE }), {
    concurrency: 'unbounded',
  });
  const world = yield* scriptedWorld(storage, threads[0]!.agentId, { opening: () => Effect.sleep(OPENING_MS) });
  console.log(`folding ${EVENTS} events into each of ${AGENTS} threads…`);
  const started = now();
  for (const thread of threads) {
    const handle = world.harness.threads.handle(thread.id, OWNER);
    for (let at = 0; at < EVENTS; at += 100) {
      const batch = Array.from({ length: Math.min(100, EVENTS - at) }, (_, offset) => {
        const index = at + offset;
        return threadSpokenMessageEvent({
          role: index % 2 === 0 ? 'user' : 'assistant',
          text: `${index % 2 === 0 ? 'Question' : 'Answer'} ${index}: ${'the thread grows by one more line of ordinary conversation '.repeat(4)}`,
          occurredAt: new Date(1_000 + index).toISOString(),
        });
      });
      yield* handle.append(batch);
    }
  }
  console.log(`folded in ${(now() - started).toFixed(0)} ms; sending one turn per thread, all at once…`);
  const samples = yield* Effect.forEach(
    threads,
    (thread) =>
      Effect.scoped(
        Effect.gen(function* () {
          world.plan.push(
            replyTurn({
              chunks: [
                { type: 'text-start', id: 't1' },
                { type: 'text-delta', id: 't1', text: 'Answered.' },
                { type: 'text-end', id: 't1' },
              ],
              steps: [scriptedStep({ text: 'Answered.', messages: [Message.assistant('Answered.')] })],
            }),
          );
          let firstChunk: number | null = null;
          yield* Effect.acquireRelease(
            Effect.sync(() =>
              world.harness.reads.subscribe(thread.id, (event: ThreadLiveEvent<ThreadSnapshot>) => {
                if (event.type === 'open' && event.change.op === 'put' && firstChunk === null) firstChunk = now();
              }),
            ),
            (detach) => Effect.sync(detach),
          );
          const asked = now();
          const said = yield* world.harness.threads.handle(thread.id, OWNER).send(`Answer this, please (${thread.id}).`);
          const ack = now();
          if (said.status !== 'started') return yield* Effect.die(`The words waited behind run ${said.runId}.`);
          yield* pump({ world, threadId: thread.id, runId: said.runId, entry: said.entry });
          return { ack: ack - asked, opened: (firstChunk ?? ack) - asked, settled: now() - asked } satisfies Sample;
        }),
      ),
    { concurrency: 'unbounded' },
  );
  console.log(`\n${AGENTS} agents · ${EVENTS} events each · opening ${OPENING_MS} ms\n`);
  console.log(
    describe(
      'acknowledged',
      samples.map((sample) => sample.ack),
    ),
  );
  console.log(
    describe(
      'opened',
      samples.map((sample) => sample.opened),
    ),
  );
  console.log(
    describe(
      'settled',
      samples.map((sample) => sample.settled),
    ),
  );
  console.log(
    `\nThe opening column is what the sender waited for when the answer came after the run had started:\n` +
      `the acknowledgement column is what it waits for now.`,
  );
});

await Effect.runPromise(Effect.scoped(main));
