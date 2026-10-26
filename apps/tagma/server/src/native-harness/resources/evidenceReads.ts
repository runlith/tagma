import { Effect } from 'effect';
import { ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import type { ThreadResourceKind } from '@runlith/agent/resources/ResourcesConfig';
import type { Unit } from '../../platform/contract/service/units.js';
import type { EvidenceReads } from '../../threads/contract/service/evidence.js';

export function evidenceReadsKind(reads: EvidenceReads['Service']): ThreadResourceKind<Unit<'machine'>> {
  return {
    kind: 'evidenceReads',
    release: (row) => Effect.mapError(reads.release(row.id), (cause) => new ThreadStorageFailed({ call: 'evidenceReads.release', cause })),
    describe: (row) => ({
      kind: row.kind,
      id: row.id,
      detail: 'the folder holding the pinned descriptors of the evidence readings this thread has open',
      heldAt: row.heldAt.toISOString(),
    }),
  };
}
