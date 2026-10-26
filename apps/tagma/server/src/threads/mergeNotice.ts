import { Effect } from 'effect';
import { journalLaneFaces } from '@runlith/agent/thread/transition/lane';
import { actDigest, type Keyed } from '@runlith/agent/thread/keyed';
import { ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import { sealThreadEvents } from '@runlith/agent/thread/ThreadEventDoor';
import { ThreadNotFoundError } from '@runlith/agent/thread/storage/aggregate';
import { prepareTransition, transitionIn, type TransitionDeps } from '@runlith/agent/thread/transition/kernel';
import { ThreadVersionStaleError, type TransitionPlan } from '@runlith/agent/thread/transition/port';
import type { Unit, WriteUnit } from '../platform/contract/service/units.js';
import { WORKTREE_ENTRY, worktreeEntryIds, type WorktreeEntry } from '../worktrees/contract/wire/entries.js';
import { MergeNoticeConflict, MergeNoticeFailed, MergeNotice } from '../landing/contract/service/mergeNotice.js';
import { NativeStorage, ThreadJournal } from './contract/service/engine.js';
import { ThreadEntryKinds } from '@runlith/agent/transcript/kinds';
import { JournalOrder } from './journal/lane.js';

export const makeMergeNotice = Effect.gen(function* () {
  const { threads: store, transitions } = yield* NativeStorage;
  const log = yield* ThreadJournal;
  const lane = journalLaneFaces(yield* JournalOrder);
  const kinds = yield* ThreadEntryKinds;
  const deps: TransitionDeps<Unit<'machine'>, WriteUnit<'machine'>> = { store, log, transitions, lane, kinds };
  return MergeNotice.of({
    prepare: Effect.fn('MergeNotice.prepare')(function* (threadId, receipt, recorded) {
      const entry: WorktreeEntry = {
        type: WORKTREE_ENTRY,
        id: worktreeEntryIds.merged(receipt.rootId, receipt.commit),
        event: 'merged',
        rootId: receipt.rootId,
        name: receipt.name,
        branch: receipt.branch,
        base: receipt.base,
        mode: receipt.mode,
        commit: receipt.commit,
        after: receipt.after,
        waitedSince: receipt.waitedSince ?? undefined,
        occurredAt: receipt.at,
      };
      const declared = sealThreadEvents([{ kind: WORKTREE_ENTRY, payload: { entry } }]);
      yield* log.open(threadId).pipe(Effect.mapError((failure) => new MergeNoticeFailed({ threadId, reason: failure.message })));
      const prepared = yield* Effect.result(prepareTransition(deps, threadId, declared));
      if (prepared._tag === 'Failure') {
        if (prepared.failure instanceof ThreadNotFoundError) return null;
        return yield* new MergeNoticeFailed({ threadId, reason: prepared.failure.message });
      }
      const key: Keyed = {
        evidence: { owned: { namespace: `merge-notice:${receipt.rootId}`, id: `${receipt.commit}:${threadId}` } },
        digest: actDigest({ rootId: receipt.rootId, commit: receipt.commit, threadId }),
      };
      const plan: TransitionPlan<null, Unit<'machine'>> = {
        declared,
        owned: {
          read: (tx) =>
            Effect.mapError(
              Effect.map(recorded(tx), (noted) =>
                noted ? { kind: 'present' as const, digest: key.digest, result: null } : { kind: 'absent' as const },
              ),
              (cause) => new ThreadStorageFailed({ call: 'mergeNotice.recorded', cause }),
            ),
          write: () => Effect.void,
        },
        decide: () => Effect.succeed({ apply: true, result: null }),
      };
      return (unit) =>
        transitionIn(deps, unit, prepared.success, plan, key).pipe(
          Effect.asVoid,
          Effect.mapError((failure) =>
            failure instanceof ThreadVersionStaleError
              ? new MergeNoticeConflict({ threadId })
              : new MergeNoticeFailed({ threadId, reason: failure.message }),
          ),
        );
    }),
  });
});
