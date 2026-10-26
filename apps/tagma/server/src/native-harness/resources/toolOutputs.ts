import { Effect } from 'effect';
import { ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import type { ThreadToolOutputStore } from '../tools/outputStore.js';
import type { EvictingResourceKind } from '../../threads/resources/kinds/evict.js';
import { type BaseReach, ThreadFilesReferenced } from '../../threads/journal/base.js';

export function toolOutputsKind(outputs: ThreadToolOutputStore, reach: BaseReach): EvictingResourceKind {
  return {
    kind: 'toolOutputs',
    release: (row) =>
      reach.referenced(row.id).pipe(
        Effect.mapError((cause) => new ThreadStorageFailed({ call: 'toolOutputs.release', cause })),
        Effect.flatMap((held) =>
          held
            ? Effect.fail(new ThreadStorageFailed({ call: 'toolOutputs.release', cause: new ThreadFilesReferenced(row.id) }))
            : outputs.releaseThread(row.id),
        ),
      ),
    evict: (row) => outputs.releaseThread(row.id),
    describe: (row) => ({
      kind: row.kind,
      id: row.id,
      detail: 'the folder holding the complete answers of tools whose output outran the context',
      heldAt: row.heldAt.toISOString(),
    }),
  };
}
