import { type DeclaredAnswer, type DeclaredJob, declaredAt } from './declaredNames.js';

declare const self: Worker;

self.onmessage = (event: MessageEvent<DeclaredJob>) => {
  declaredAt(event.data).then(
    (declared) => self.postMessage({ state: 'judged', declared } satisfies DeclaredAnswer),
    (error: unknown) =>
      self.postMessage({ state: 'failed', message: error instanceof Error ? error.message : String(error) } satisfies DeclaredAnswer),
  );
};
self.postMessage({ state: 'ready' });
