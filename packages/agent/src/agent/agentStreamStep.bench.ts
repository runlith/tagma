import { Deferred, Effect, Fiber, Stream } from 'effect';
import { LLMEvent } from '@runlith/llm/schema/events';
import type { AgentEvent } from './AgentEvent';
import { recording } from './testing/recording';

const countArgument = Bun.argv.find((argument) => argument.startsWith('--count='));
const burstArgument = Bun.argv.find((argument) => argument.startsWith('--burst='));
const count = countArgument ? Number.parseInt(countArgument.slice('--count='.length), 10) : 20_000;
const burst = burstArgument ? Number.parseInt(burstArgument.slice('--burst='.length), 10) : 1;

if (!Number.isSafeInteger(count) || count <= 0) throw new Error('--count must be a positive integer');
if (!Number.isSafeInteger(burst) || burst <= 0) throw new Error('--burst must be a positive integer');

type Log<A, E = never> = {
  readonly push: (entry: A) => Effect.Effect<void>;
  readonly close: Effect.Effect<void>;
  readonly stream: () => Stream.Stream<A, E>;
};

function concatLog<A, E = never>(): Log<A, E> {
  const delivered: A[] = [];
  let closed = false;
  let arrival = Deferred.makeUnsafe<void>();
  const notify = (): void => {
    const waiting = arrival;
    arrival = Deferred.makeUnsafe<void>();
    Deferred.doneUnsafe(waiting, Effect.void);
  };
  const from = (index: number): Stream.Stream<A, E> =>
    Stream.suspend(() => {
      if (index < delivered.length) {
        const ready = delivered.slice(index);
        return Stream.fromIterable(ready).pipe(Stream.concat(from(index + ready.length)));
      }
      if (closed) return Stream.empty;
      return Stream.unwrap(Deferred.await(arrival).pipe(Effect.as(from(index))));
    });
  return {
    push: (entry) =>
      Effect.sync(() => {
        if (closed) return;
        delivered.push(entry);
        notify();
      }),
    close: Effect.sync(() => {
      if (closed) return;
      closed = true;
      notify();
    }),
    stream: () => from(0),
  };
}

const pullLog = (): Log<AgentEvent> => recording<AgentEvent>();

function textDelta(index: number): AgentEvent {
  return LLMEvent.textDelta({ id: 'text-1', text: `token ${index} of the answer, ` });
}

const promiseConsume = (chunk: AgentEvent) =>
  Effect.flatMap(Effect.tryPromise({ try: async () => void sink(chunk), catch: (cause) => cause as never }), () =>
    Effect.tryPromise({ try: async () => empty, catch: (cause) => cause as never }),
  );

const sinkConsume = (chunk: AgentEvent) => Effect.tryPromise({ try: async () => void sink(chunk), catch: (cause) => cause as never });

const syncConsume = (chunk: AgentEvent) => Effect.sync(() => void sink(chunk));

const empty: readonly AgentEvent[] = [];
let delivered = 0;
function sink(_chunk: AgentEvent): void {
  delivered += 1;
}

async function drive(
  name: string,
  make: () => Log<AgentEvent>,
  consume: ((chunk: AgentEvent) => Effect.Effect<void, never>) | null,
): Promise<{ name: string; totalMs: number; perDeltaUs: number; delivered: number }> {
  delivered = 0;
  const log = make();
  const started = await Effect.runPromise(
    Effect.gen(function* () {
      const reader = consume ? yield* Effect.forkChild(Stream.runForEach(log.stream(), consume)) : null;
      yield* Effect.yieldNow;
      const at = performance.now();
      for (let index = 0; index < count; index += 1) {
        yield* log.push(textDelta(index));
        if (burst === 1 || (index + 1) % burst === 0) yield* Effect.yieldNow;
      }
      yield* log.close;
      if (reader) yield* Fiber.join(reader);
      return at;
    }),
  );
  const totalMs = performance.now() - started;
  return { name, totalMs, perDeltaUs: (totalMs * 1000) / count, delivered };
}

const rows = [];
await drive('warm', concatLog, syncConsume);
await drive('warm', pullLog, syncConsume);

rows.push(await drive('push only, no reader', concatLog, null));
rows.push(await drive('concat log + sync consume', concatLog, syncConsume));
rows.push(await drive('pull log + sync consume', pullLog, syncConsume));
rows.push(await drive('concat log + 1 promise boundary', concatLog, sinkConsume));
rows.push(await drive('pull log + 1 promise boundary', pullLog, sinkConsume));
rows.push(await drive('concat log + 2 promise boundaries', concatLog, promiseConsume));
rows.push(await drive('pull log + 2 promise boundaries', pullLog, promiseConsume));

console.log(JSON.stringify({ count, burst, rows }, null, 2));
