import { Effect } from 'effect';
import type { ThreadPortFailure } from '@runlith/agent/thread/ThreadBorder';
import type { ThreadResourceStorage } from '@runlith/agent/thread/storage/resources';
import type { Unit } from '../../platform/contract/service/units.js';
import { rolloutId } from './kinds/rollout.js';

export function holdThreadResources(
  ledger: ThreadResourceStorage<Unit<'machine'>>,
  thread: { readonly threadId: string; readonly projectId: number },
  tx: Unit<'machine'>,
): Effect.Effect<void, ThreadPortFailure> {
  const { threadId, projectId } = thread;
  return Effect.asVoid(
    Effect.all(
      [
        ledger.hold({ kind: 'scratch', id: threadId, threadId }, tx),
        ledger.hold({ kind: 'attachments', id: threadId, threadId }, tx),
        ledger.hold({ kind: 'toolOutputs', id: threadId, threadId }, tx),
        ledger.hold({ kind: 'evidenceReads', id: threadId, threadId }, tx),
        ledger.hold({ kind: 'terminals', id: threadId, threadId }, tx),
        ledger.hold({ kind: 'rollout', id: rolloutId(projectId, threadId), threadId }, tx),
      ],
      { concurrency: 1 },
    ),
  );
}
