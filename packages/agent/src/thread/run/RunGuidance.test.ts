import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Context, Effect, Layer } from 'effect';
import type { ThreadTranscriptEntry } from '../../transcript/rows';
import type { ThreadEventBody } from '../events';
import { makeAggregateStorage } from '../storage/InMemoryAggregateStorage';
import { ThreadStore } from '../ThreadPorts';
import { RunGuidance, runGuidanceLayer, type TouchLedger } from './RunGuidance';
type Recorded = {
  readonly thread: string;
  readonly entry: ThreadTranscriptEntry;
};
const guided = Effect.fnUntraced(function* (kept: Recorded[]) {
  const store = ThreadStore.of(
    Object.assign(makeAggregateStorage(), {
      transcriptWindow: (thread: string) =>
        Effect.succeed({ entries: kept.filter((record) => record.thread === thread).map((record) => record.entry), before: null }),
      entryById: (thread: string, id: string) =>
        Effect.succeed(kept.find((record) => record.thread === thread && record.entry.id === id)?.entry),
    }),
  );
  return Context.get(yield* Layer.build(runGuidanceLayer).pipe(Effect.provideService(ThreadStore, store)), RunGuidance);
});
const landing = (kept: Recorded[], thread = 'thread') =>
  Effect.fnUntraced(function* (events: readonly ThreadEventBody[]) {
    yield* Effect.yieldNow;
    for (const event of events) {
      const entry = event.payload.entry;
      if (entry === undefined) return yield* Effect.die('Guidance must publish a transcript entry.');
      kept.push({ entry, thread });
    }
  });
const tell = (key: string) => (ledger: TouchLedger) => {
  if (ledger.delivered.has(key)) return null;
  ledger.delivered.add(key);
  return `law of ${key}`;
};
it.effect(
  'touches are told once, a reset tells them again, and a recorded clear survives a restart',
  Effect.fnUntraced(function* () {
    const kept: Recorded[] = [];
    const record = landing(kept);
    const guidance = yield* guided(kept);
    expect(yield* guidance.hook('thread', 'run-1', 'e1', tell('a.ts'), record)).toBe('law of a.ts');
    expect(yield* guidance.hook('thread', 'run-1', 'e2', tell('a.ts'), record)).toBeNull();
    expect(kept).toHaveLength(1);
    expect(yield* guidance.hook('thread', 'run-1', 'e3', tell('b.ts'), record)).toBe('law of b.ts');
    expect(kept[1]?.entry).toHaveProperty('sources.0.state.touched.delivered', expect.arrayContaining(['a.ts', 'b.ts']));
    expect(kept[1]?.entry).toHaveProperty('sources.0.state.touched.delivered.length', 2);
    guidance.reset('thread', false);
    expect(yield* guidance.hook('thread', 'run-2', 'e4', tell('a.ts'), record)).toBe('law of a.ts');
    const cleared = yield* guidance.cleared('thread', 'run-2', false);
    yield* record(cleared.events);
    yield* cleared.delivered;
    const restarted = yield* guided(kept);
    expect(yield* restarted.hook('thread', 'run-3', 'after', tell('a.ts'), record)).toBe('law of a.ts');
  }),
);
it.effect(
  'the ledgers of two threads are independent',
  Effect.fnUntraced(function* () {
    const kept: Recorded[] = [];
    const guidance = yield* guided(kept);
    yield* guidance.hook('one', 'run', 'e1', tell('a.ts'), landing(kept, 'one'));
    expect(yield* guidance.hook('two', 'run', 'e2', tell('a.ts'), landing(kept, 'two'))).toBe('law of a.ts');
  }),
);
it.effect(
  'a lost reply is replayed to the same evidence without telling a new hook twice',
  Effect.fnUntraced(function* () {
    const kept: Recorded[] = [];
    const record = landing(kept);
    const guidance = yield* guided(kept);
    expect(yield* guidance.hook('thread', 'run-1', 'lost', tell('a.ts'), record)).toBe('law of a.ts');
    expect(yield* guidance.hook('thread', 'run-1', 'lost', tell('a.ts'), record)).toBe('law of a.ts');
    expect(yield* guidance.hook('thread', 'run-1', 'new', tell('a.ts'), record)).toBeNull();
    expect(kept).toHaveLength(1);
  }),
);
it.effect(
  'a guidance whose record failed is decided again by its retry',
  Effect.fnUntraced(function* () {
    const kept: Recorded[] = [];
    const guidance = yield* guided(kept);
    expect(yield* Effect.flip(guidance.hook('thread', 'run-1', 'x', tell('a.ts'), () => Effect.fail('write lost')))).toBe('write lost');
    expect(yield* guidance.hook('thread', 'run-1', 'x', tell('a.ts'), landing(kept))).toBe('law of a.ts');
  }),
);
it.effect(
  'two hooks of one thread asked at once tell the same law once',
  Effect.fnUntraced(function* () {
    const kept: Recorded[] = [];
    const record = landing(kept);
    const guidance = yield* guided(kept);
    const told = yield* Effect.all(
      [guidance.hook('thread', 'run-1', 'p1', tell('a.ts'), record), guidance.hook('thread', 'run-1', 'p2', tell('a.ts'), record)],
      { concurrency: 2 },
    );
    expect(told.filter((text) => text !== null)).toEqual(['law of a.ts']);
    expect(kept).toHaveLength(1);
  }),
);
