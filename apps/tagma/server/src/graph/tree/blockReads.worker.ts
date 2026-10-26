import { type BlockReadsAnswer, type BlockReadsJob, blockReadsOf } from './blockReads.js';
import { BlockTreeUnreadable } from './layout.js';

declare const self: Worker;

const answer = (job: BlockReadsJob): BlockReadsAnswer => {
  try {
    return { state: 'read', reads: blockReadsOf(job) };
  } catch (error) {
    if (error instanceof BlockTreeUnreadable) return { state: 'failed', path: error.path, message: error.message };
    return { state: 'failed', path: job.treeRoot, message: error instanceof Error ? error.message : String(error) };
  }
};

self.onmessage = (event: MessageEvent<BlockReadsJob>) => {
  self.postMessage(answer(event.data));
};
self.postMessage({ state: 'ready' });
