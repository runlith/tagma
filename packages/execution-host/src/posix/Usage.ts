import { Effect } from 'effect';
import { UsageUnavailable, type UsageReader } from '../UsageReader';
import { openProcessWorker, type WorkerUnanswered } from './ProcessWorker';

const unavailable = (failure: WorkerUnanswered) => new UsageUnavailable({ detail: failure.detail });

export const openUsage = Effect.fn('posix.Usage.open')(function* (path: string) {
  const worker = yield* openProcessWorker(path).pipe(Effect.mapError(unavailable));
  return { machineName: worker.machineName, read: (demand) => Effect.mapError(worker.usage(demand), unavailable) } satisfies UsageReader;
});
