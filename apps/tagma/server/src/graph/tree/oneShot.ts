import { Effect } from 'effect';
import { eventReason } from '@runlith/utils/worker';

export type OneShotReady = { readonly state: 'ready' };

const isReady = <Answer>(message: Answer | OneShotReady): message is OneShotReady =>
  (message as { readonly state?: unknown }).state === 'ready';

export const askOnce = <Answer, E>(url: URL, job: unknown, gone: (reason: string) => E): Effect.Effect<Answer, E> =>
  Effect.callback<Answer, E>((resume) => {
    let started: Worker | undefined;
    const settle = (effect: Effect.Effect<Answer, E>) => {
      started?.terminate();
      resume(effect);
    };
    const failed = (reason: string) => settle(Effect.fail(gone(reason)));
    try {
      started = new Worker(url, { type: 'module' });
    } catch (cause) {
      failed(String(cause));
      return;
    }
    const worker = started;
    worker.addEventListener('message', (event: MessageEvent<Answer | OneShotReady>) => {
      const message = event.data;
      if (!isReady(message)) {
        settle(Effect.succeed(message));
        return;
      }
      try {
        worker.postMessage(job);
      } catch (cause) {
        failed(String(cause));
      }
    });
    worker.addEventListener('error', (event: ErrorEvent) => failed(eventReason(event, 'the worker failed')));
    worker.addEventListener('messageerror', () => failed('the worker answer could not be read'));
    worker.addEventListener('close', () => failed('the worker closed before answering'));
    return Effect.sync(() => worker.terminate());
  });
