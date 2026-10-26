import { conflictsOf, indexConflicts, type ConflictIndex } from './overlaps.js';
import type { ConflictAnswer, ConflictRequest } from './computation.js';

declare const self: Worker;

let revision = -1;
const indexes = new Map<string, ConflictIndex>();

self.onmessage = (event: MessageEvent<ConflictRequest>) => {
  const { id, job } = event.data;
  let conflicts: ConflictAnswer['conflicts'] = null;
  switch (job.kind) {
    case 'clear':
    case 'index':
      if (revision !== job.revision) {
        indexes.clear();
        revision = job.revision;
      }
      if (job.kind === 'index') indexes.set(job.key, indexConflicts(job.input));
      break;
    case 'read': {
      const index = indexes.get(job.key);
      if (index === undefined) throw new Error('the conflict index is no longer held');
      conflicts = conflictsOf(index, job.names);
      break;
    }
    case 'compute':
      conflicts = conflictsOf(indexConflicts(job.input), job.names);
      break;
  }
  self.postMessage({ id, conflicts } satisfies ConflictAnswer);
};
self.postMessage({ state: 'ready' });
