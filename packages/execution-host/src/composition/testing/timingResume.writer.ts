import { Clock, Effect, Schedule } from 'effect';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { childHosting } from '@runlith/sqlite-process/children';
import { ProcessPool } from '@runlith/sqlite-process/ProcessPool';
import { kernelClock } from '../../KernelClock';
import { loadLibrary } from '../../posix/Library';
import { ExecutionStore } from '../../store/ExecutionStore';
import { OPERATION, admit, operation, ownersOver, ref, storeOver, worldOf } from '../../testing/timingFixture';

const [directory, library] = process.argv.slice(2);

const writing = Effect.gen(function* () {
  const loaded = yield* loadLibrary(library!);
  const clock = yield* kernelClock(() => loaded.abi.uptimeNanos());
  const written = yield* Effect.gen(function* () {
    const store = yield* ExecutionStore;
    yield* admit;
    yield* ownersOver(store, worldOf(), 50, false);
    yield* store
      .rulesOf(ref.execution)
      .pipe(Effect.repeat({ schedule: Schedule.spaced(10), until: (rules) => rules !== undefined && rules.length > 0 }));
    return {
      operation: OPERATION,
      generation: (yield* store.incarnation()).incarnation,
      call: yield* store.callOf(operation),
      rules: yield* store.rulesOf(ref.execution),
      pace: yield* store.paceOf(ref.execution),
    };
  }).pipe(
    Effect.provide(storeOver(directory!, new ProcessPool(undefined, 'stop', undefined, childHosting))),
    Effect.provideService(Clock.Clock, clock),
  );
  process.stdout.write(JSON.stringify(written));
}).pipe(Effect.scoped);

await Effect.runPromise(writing.pipe(Effect.provide(BunFileSystem.layer)));
process.exit(0);
