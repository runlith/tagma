/// <reference types="bun" />

import * as BunRuntime from '@effect/platform-bun/BunRuntime';
import * as BunWorkerRunner from '@effect/platform-bun/BunWorkerRunner';
import * as Effect from 'effect/Effect';
import * as Fiber from 'effect/Fiber';
import * as Queue from 'effect/Queue';
import * as WorkerRunner from 'effect/workers/WorkerRunner';
import type { LossKindCounts } from '../protocol/records.js';
import { runSession } from './session.js';
import type { StoreAnswer, StoreRequest } from './wire.js';

const main = Effect.scoped(
  Effect.gen(function* () {
    const platform = yield* WorkerRunner.WorkerRunnerPlatform;
    const runner = yield* platform.start<StoreAnswer, StoreRequest>();
    const incoming = yield* Queue.unbounded<StoreRequest>();
    const running = yield* Effect.forkScoped(
      runner.run<void, never, never>((_portId, request) => Effect.asVoid(Queue.offer(incoming, request))),
    );
    yield* Effect.raceFirst(
      runSession(incoming, (answer) => runner.send(0, answer)),
      Effect.asVoid(Fiber.await(running)),
    );
  }),
).pipe(Effect.provide(BunWorkerRunner.layer));

BunRuntime.runMain(main);

export const workerDrops: LossKindCounts = {};
