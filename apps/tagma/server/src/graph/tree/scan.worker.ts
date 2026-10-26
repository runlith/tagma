import { Effect } from 'effect';
import { BlockTreeUnreadable, holdsBlocks } from './layout.js';
import { type ScanAnswer, type ScanJob, readTreeScan } from './scan.js';

declare const self: Worker;

const answer = (job: ScanJob): Effect.Effect<ScanAnswer, BlockTreeUnreadable> =>
  job.whole
    ? Effect.map(readTreeScan(job.root), (scan) => ({ state: 'scanned', scan }))
    : Effect.try({
        try: (): ScanAnswer => ({ state: 'holds', holds: holdsBlocks(job.root) }),
        catch: (error) =>
          new BlockTreeUnreadable({ reason: 'io', path: job.root, message: error instanceof Error ? error.message : String(error) }),
      });

self.onmessage = (event: MessageEvent<ScanJob>) => {
  const result = Effect.runSync(Effect.result(answer(event.data)));
  self.postMessage(
    result._tag === 'Success'
      ? result.success
      : ({
          state: 'failed',
          reason: result.failure.reason,
          path: result.failure.path,
          message: result.failure.message,
        } satisfies ScanAnswer),
  );
};
self.postMessage({ state: 'ready' });
