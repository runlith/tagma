import { Effect } from 'effect';
import type { MergeSides } from '@runlith/git/merge';
import { debtReconciled } from './graphMerge.js';

declare const self: Worker;

self.onmessage = (event: MessageEvent<readonly MergeSides[]>) => {
  Effect.runPromise(Effect.forEach(event.data, (sides) => debtReconciled(sides))).then(
    (answer) => self.postMessage(answer),
    (failure) => {
      throw failure;
    },
  );
};
self.postMessage({ state: 'ready' });
