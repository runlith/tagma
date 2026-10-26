import type { CountAnswer } from './counting.js';
import { type SearchSubject, searchRowsOf } from './words.js';

declare const self: Worker;

self.onmessage = (event: MessageEvent<readonly SearchSubject[]>) => {
  let answer: CountAnswer;
  try {
    answer = { state: 'counted', rows: searchRowsOf(event.data) };
  } catch (cause) {
    answer = { state: 'failed', message: cause instanceof Error ? cause.message : String(cause) };
  }
  self.postMessage(answer);
};
self.postMessage({ state: 'ready' });
