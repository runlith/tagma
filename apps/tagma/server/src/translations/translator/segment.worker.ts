import { partsOf, type Segmented } from './parts.js';
import type { SegmentAnswer } from './segment.js';

declare const self: Worker;

self.onmessage = (event: MessageEvent<Segmented>) => {
  self.postMessage({ state: 'parts', parts: partsOf(event.data) } satisfies SegmentAnswer);
};
self.postMessage({ state: 'ready' });
