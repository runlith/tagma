import { createDeferred } from './deferred.js';

export class NeverPresented extends Error {
  constructor() {
    super('The overlay was closed before it reached the document');
    this.name = 'NeverPresented';
  }
}

export type OverlaySignals<Result> = {
  readonly presented: Promise<void>;
  readonly closed: Promise<Result>;
  readonly wasPresented: () => boolean;
  readonly present: () => void;
  readonly end: (result: Result) => void;
  readonly fail: (reason: unknown) => void;
};

export function createOverlaySignals<Result>(): OverlaySignals<Result> {
  const presented = createDeferred<void>();
  const closed = createDeferred<Result>();
  let shown = false;

  presented.promise.catch(() => undefined);
  closed.promise.catch(() => undefined);

  return {
    presented: presented.promise,
    closed: closed.promise,
    wasPresented: () => shown,
    present() {
      if (shown) return;
      shown = true;
      presented.resolve(undefined);
    },
    end(result) {
      if (!shown) presented.reject(new NeverPresented());
      closed.resolve(result);
    },
    fail(reason) {
      if (!shown) presented.reject(reason);
      closed.reject(reason);
    },
  };
}
