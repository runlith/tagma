import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Clock, Deferred, Effect, Fiber } from 'effect';
import { TestClock } from 'effect/testing';
import { utf8ByteLength } from '@runlith/utils/utf8';
import type { ThreadTranscript } from '../../../transcript/rows';
import { makeThreadEntryReader } from '../../../transcript/kinds';
import { makeMemoryRows } from './ThreadRows';
import { makeMemoryRuns } from './ThreadRuns';
import { ThreadMemory } from './state';
function rows() {
  return makeMemoryRows({ memory: new ThreadMemory(makeThreadEntryReader({ products: [] })) });
}
const born = { id: 'thread-1', ownerId: 'owner-1', agentId: 'agent-1' };
describe('memory transaction', () => {
  it.effect(
    'a rolled-back deletion preserves run chronology',
    Effect.fnUntraced(function* () {
      const memory = new ThreadMemory(makeThreadEntryReader({ products: [] }));
      const store = makeMemoryRows({ memory });
      const runs = makeMemoryRuns({ memory, ownerId: born.ownerId, scope: null });
      const thread = yield* store.insert(born);
      const first = yield* runs.createRun({
        startFrom: thread,
        runId: 'first',
        kind: 'turn',
        approval: { mode: 'trust', interactive: false },
        progress: { stage: 'running', message: null },
      });
      const at = new Date(yield* Clock.currentTimeMillis);
      yield* runs.settleRun(first.run.id, {
        status: 'completed',
        progress: { stage: 'completed', message: null },
        finishedAt: at,
        heartbeatAt: at,
      });
      yield* TestClock.adjust('1 millis');
      const second = yield* runs.createRun({
        startFrom: thread,
        runId: 'second',
        kind: 'turn',
        approval: { mode: 'trust', interactive: false },
        progress: { stage: 'running', message: null },
      });
      yield* Effect.flip(store.transaction((tx) => Effect.andThen(store.delete([thread.id], tx), Effect.fail('withdraw'))));
      expect((yield* runs.latestRun(thread.id))?.id).toBe(second.run.id);
      expect((yield* runs.latestRuns([thread.id])).map((run) => run.id)).toEqual([second.run.id]);
      expect((yield* runs.runsOf(thread.id)).map((run) => run.id)).toEqual([first.run.id, second.run.id]);
    }),
  );
  it.effect(
    'the transcript window counts UTF-8 bytes and preserves its continuation',
    Effect.fnUntraced(function* () {
      const store = rows();
      const transcript: ThreadTranscript = [
        { type: 'message', id: 'first', role: 'user', text: 'ЯЯ', occurredAt: '2026-10-17T00:00:00.000Z' },
        { type: 'message', id: 'last', role: 'user', text: 'end', occurredAt: '2026-10-17T00:00:00.000Z' },
      ];
      yield* store.insert({ ...born, transcript });
      const bytes = transcript.reduce((sum, entry) => sum + utf8ByteLength(JSON.stringify(entry)), 0) - 1;
      const page = yield* store.transcriptWindow(born.id, { bytes, limit: 2 });
      expect(page?.entries.map((entry) => entry.id)).toEqual(['last']);
      expect(page?.before).toBe(1);
    }),
  );
  it.effect(
    'stored creation and update times follow the clock of the memory backend',
    Effect.fnUntraced(function* () {
      const store = rows();
      const at = yield* Clock.currentTimeMillis;
      const row = yield* store.insert(born);
      expect(row.createdAt.getTime()).toBe(at);
      yield* TestClock.adjust('100 millis');
      yield* store.update(row.id, { model: 'next' });
      expect((yield* store.metadata(row.id))?.updatedAt.getTime()).toBe(yield* Clock.currentTimeMillis);
    }),
  );
  it.effect(
    'a typed refusal inside the unit reaches the caller as that value and the unit writes nothing',
    Effect.fnUntraced(function* () {
      const store = rows();
      const refusal = { _tag: 'Refused' as const };
      const failed = yield* Effect.flip(store.transaction((tx) => Effect.andThen(store.insert(born, tx), Effect.fail(refusal))));
      expect(failed).toBe(refusal);
      expect(yield* store.find(born.id)).toBeUndefined();
    }),
  );
  it.effect(
    'an interrupted unit leaves no partial write',
    Effect.fnUntraced(function* () {
      const store = rows();
      const written = yield* Deferred.make<void>();
      const fiber = yield* Effect.forkScoped(
        store.transaction((tx) =>
          Effect.andThen(store.insert(born, tx), Effect.andThen(Deferred.succeed(written, undefined), Effect.never)),
        ),
      );
      yield* Deferred.await(written);
      yield* Fiber.interrupt(fiber);
      expect(yield* store.find(born.id)).toBeUndefined();
    }),
  );
});
