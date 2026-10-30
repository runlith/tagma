import { Effect } from 'effect';
import { workerGone, workerLink, type WorkerUnavailable } from '@runlith/utils/worker';
import { RolloutReads, type RolloutRead } from '../contract/service/rolloutReads.js';

export type RestScanAsk = { readonly id: number; readonly path: string };

export type RestScan = {
  readonly bytes: number;
  readonly torn: boolean;
  readonly unreadable: boolean;
  readonly checkpoints: readonly string[];
  readonly pruned: readonly string[];
};

export type RestScanAnswer = { readonly id: number } & (
  | ({ readonly kind: 'scanned' } & RestScan)
  | { readonly kind: 'unreadable' }
  | { readonly kind: 'failed'; readonly reason: string }
);

export type RestScanRead = { readonly id: number; readonly kind: 'read'; readonly reads: readonly RolloutRead[] };

const WORKER = 'rollout rest scan worker';

const link = workerLink<RestScanAsk, RestScanAnswer, RestScanRead>(
  WORKER,
  () => new Worker(new URL('./restScan.worker.ts', import.meta.url), { type: 'module' }),
  (message): message is RestScanRead => message.kind === 'read',
);

export const scanForRest = (path: string): Effect.Effect<RestScan | null, WorkerUnavailable> =>
  Effect.flatMap(RolloutReads, (read) =>
    link.ask(
      (id) => ({ id, path }),
      [],
      (note) => {
        for (const one of note.reads) read(one);
      },
    ),
  ).pipe(
    Effect.flatMap((answer) => {
      if (answer.kind === 'scanned') return Effect.succeed(answer);
      if (answer.kind === 'unreadable') return Effect.succeed(null);
      return Effect.fail(workerGone(WORKER, answer.reason));
    }),
    Effect.withSpan('ThreadRollout.rest.scan', { attributes: { path } }),
  );
