import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Clock, Context, Effect, Layer } from 'effect';
import { TestClock } from 'effect/testing';
import { Usage } from '@runlith/llm/schema/events';
import type { ThreadRunStorage } from '../storage/runs';
import { ThreadOwner, ThreadRunStoreFactory, type ThreadTx } from '../ThreadPorts';
import { threadRunAccountingLayer, ThreadRunAccounting } from './ThreadRunAccounting';
import { runRow, unreadRuns } from '../conformance/runCycle/runDoubles';
it.effect(
  'accounting stamps every write at execution time using the test clock',
  Effect.fnUntraced(function* () {
    let row = runRow('run-1');
    const runs: ThreadRunStorage<ThreadTx> = {
      ...unreadRuns,
      runById: () => Effect.sync(() => row),
      writeProgress: (_id, progress, heartbeatAt) =>
        Effect.sync(() => {
          row = { ...row, progress, heartbeatAt };
        }),
      addUsage: (_id, usage, heartbeatAt) =>
        Effect.sync(() => {
          row = { ...row, usage, heartbeatAt };
        }),
      writeStreamTail: (_id, streamTail, heartbeatAt) =>
        Effect.sync(() => {
          row = { ...row, streamTail, heartbeatAt };
        }),
    };
    const context = yield* Layer.build(accountingLayer(runs));
    const accounting = Context.get(context, ThreadRunAccounting);
    const writes = [
      accounting.progress(row.id, { stage: 'streaming', message: null }),
      accounting.progressIn(row.id, { stage: 'running', message: null }, undefined, true),
      accounting.usage(row.id, new Usage({ inputTokens: 1 })),
      accounting.usageIn(row.id, new Usage({ outputTokens: 1 }), undefined),
      accounting.streamTailIn(row.id, null, undefined),
    ];
    for (const write of writes) {
      yield* TestClock.adjust('1 second');
      yield* write;
      expect((yield* runs.runById(row.id))?.heartbeatAt).toEqual(new Date(yield* Clock.currentTimeMillis));
    }
    const before = yield* runs.runById(row.id);
    yield* TestClock.adjust('1 second');
    yield* accounting.usage(row.id, null);
    yield* accounting.usageIn(row.id, null, undefined);
    expect(yield* runs.runById(row.id)).toBe(before);
  }),
);
const accountingLayer = (runs: ThreadRunStorage<ThreadTx>) =>
  threadRunAccountingLayer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(ThreadRunStoreFactory, ThreadRunStoreFactory.of({ create: () => runs })),
        Layer.succeed(ThreadOwner, ThreadOwner.of({ id: runs.ownerId })),
      ),
    ),
  );
