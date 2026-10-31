import { Worker } from 'node:worker_threads';

export type RetainerNode = { readonly index: number; readonly type: string; readonly name: string };
export type RetainerRow = RetainerNode & {
  readonly selfBytes: number;
  readonly retainedBytes: number;
  readonly dominators: readonly RetainerNode[];
};
export type RetainerSummary = { readonly nonAdditive: true; readonly reachable: number; readonly rows: readonly RetainerRow[] };

type Answer = { readonly ok: true; readonly summary: RetainerSummary } | { readonly ok: false };

export function loadRetainers(file: string, limit: number, signal?: AbortSignal): Promise<RetainerSummary> {
  if (!Number.isSafeInteger(limit) || limit < 1) return Promise.reject(new Error('retainer limit must be a positive integer'));
  const aborted = () => new DOMException('heap retainer analysis aborted', 'AbortError');
  if (signal?.aborted) return Promise.reject(aborted());
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./loadRetainers.worker.ts', import.meta.url), { workerData: { file, limit } });
    let settled = false;
    const finish = (answer: Answer | 'aborted') => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      worker.terminate().then(
        () => {
          if (answer === 'aborted') reject(aborted());
          else if (answer.ok) resolve(answer.summary);
          else reject(new Error('heap retainer analysis failed'));
        },
        () => reject(new Error('heap retainer worker termination failed')),
      );
    };
    const onAbort = () => finish('aborted');
    worker.once('message', finish);
    worker.once('error', () => finish({ ok: false }));
    worker.once('exit', () => finish({ ok: false }));
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}
