import type { ThreadScratch } from '../scratch.js';
import type { EvictingResourceKind } from './evict.js';

export function scratchKind(scratch: ThreadScratch): EvictingResourceKind {
  return {
    kind: 'scratch',
    release: (row) => scratch.release(row.id),
    evict: (row) => scratch.release(row.id),
    describe: (row) => ({
      kind: row.kind,
      id: row.id,
      detail: 'the directory this thread`s agent writes long text into and hands doors the path of',
      heldAt: row.heldAt.toISOString(),
    }),
  };
}
