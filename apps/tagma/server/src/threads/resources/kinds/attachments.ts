import { Effect } from 'effect';
import type { ThreadResourceKind } from '@runlith/agent/resources/ResourcesConfig';
import { ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import type { Unit } from '../../../platform/contract/service/units.js';
import type { ThreadAttachmentStore } from '../attachments.js';
import { type BaseReach, ThreadFilesReferenced } from '../../journal/base.js';

export function attachmentsKind(attachments: ThreadAttachmentStore, reach: BaseReach): ThreadResourceKind<Unit<'machine'>> {
  return {
    kind: 'attachments',
    release: (row) =>
      reach.referenced(row.id).pipe(
        Effect.mapError((cause) => new ThreadStorageFailed({ call: 'attachments.release', cause })),
        Effect.flatMap((held) =>
          held
            ? Effect.fail(new ThreadStorageFailed({ call: 'attachments.release', cause: new ThreadFilesReferenced(row.id) }))
            : attachments.deleteThread(row.id),
        ),
      ),
    describe: (row) => ({
      kind: row.kind,
      id: row.id,
      detail: 'the folder holding the bytes of every image pinned onto this thread',
      heldAt: row.heldAt.toISOString(),
    }),
  };
}
