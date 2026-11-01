import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { TestClock } from 'effect/testing';
import { APPROVAL, lifecycleWorld, started } from '../conformance/lifecycleWorld';
import { openMemoryStorage } from '../conformance/memoryStorage';
import type { ThreadStateChange } from '../state';

const progressed = Effect.gen(function* () {
  const world = yield* lifecycleWorld(openMemoryStorage, 30_000, 250);
  const { run } = started(yield* world.lifecycle.create(world.startFrom, APPROVAL, { kind: 'turn' }));
  const changes: ThreadStateChange[] = [];
  world.changes.project((change) => Effect.sync(() => void changes.push(change)));
  return {
    run,
    progress: world.progress,
    changes,
    stored: world.runs.runById(run.id),
    shown: () => world.feed.view(run.threadId).progress,
  };
});
it.effect(
  'a phase change keeps the context estimate the run published before it',
  Effect.fnUntraced(function* () {
    const { run, progress, shown } = yield* progressed;
    yield* progress.estimate(run, { stepNumber: 0, tokens: 1_200, contextWindow: 200_000 });
    yield* progress.enter(run, 'writing');
    expect(shown()).toEqual({ phase: { phase: 'writing', since: 0 }, estimate: { stepNumber: 0, tokens: 1_200, contextWindow: 200_000 } });
  }),
);
it.effect(
  'a phase no run write carries reaches the row and projection one rhythm later, keeping its thinking spell start',
  Effect.fnUntraced(function* () {
    const { run, progress, stored, changes } = yield* progressed;
    yield* progress.enter(run, 'calling');
    yield* TestClock.adjust('100 millis');
    yield* progress.enter(run, 'reasoning');
    expect((yield* stored)?.progress.phase).toBeUndefined();
    yield* TestClock.adjust('200 millis');
    const row = yield* stored;
    expect(row?.progress.phase).toEqual({ phase: 'reasoning', since: 0 });
    expect(changes).toEqual([
      {
        kind: 'ran',
        threadId: run.threadId,
        revision: { from: expect.any(Number), to: expect.any(Number) },
        runs: [{ id: run.id, progress: row?.progress, updatedAt: row?.updatedAt }],
      },
    ]);
  }),
);
