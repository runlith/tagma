import type { ThreadResourceKind } from '@runlith/agent/resources/ResourcesConfig';
import { Effect } from 'effect';
import type { WriteUnit } from '../../platform/contract/service/units.js';
import type { SandboxHolds } from '../../sandbox/contract/service/holds.js';
import type { Sandboxes } from '../../sandbox/contract/service/sandboxes.js';
import type { ThreadResourceStore } from '../store/resources.js';

export function sandboxKind(sandboxes: Sandboxes['Service']): ThreadResourceKind<WriteUnit<'machine'>> {
  return {
    kind: 'sandbox',
    end: (rows, tx) => Effect.forEach(rows, (row) => sandboxes.discard(row.id, tx), { discard: true }),
    describe: (row) => ({
      kind: row.kind,
      id: row.id,
      detail: 'the prepared tree this thread works in, and the guest standing over it',
      heldAt: row.heldAt.toISOString(),
    }),
  };
}

export const sandboxHolds = (ledger: ThreadResourceStore): SandboxHolds['Service'] => ({
  hold: (sandbox, threadId, tx) => Effect.asVoid(ledger.hold({ kind: 'sandbox', id: sandbox, threadId }, tx)),
});
