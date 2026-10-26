import { Effect } from 'effect';
import { type WorkerUnavailable, workerLink } from '@runlith/utils/worker';
import type { Classified } from './envelope';

export type LineAsk = { readonly id: number; readonly buffer: ArrayBuffer };

export type LineAnswer = { readonly id: number; readonly classified: Classified | null };

const link = workerLink<LineAsk, LineAnswer>(
  'line parsing worker',
  () => new Worker(new URL('./envelope.worker.ts', import.meta.url), { type: 'module' }),
);

export const parseOffLoop = (buffer: ArrayBuffer): Effect.Effect<Classified | null, WorkerUnavailable> =>
  Effect.map(
    link.ask((id) => ({ id, buffer }), [buffer]),
    (answer) => answer.classified,
  );
