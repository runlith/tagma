import { Context, Effect, Layer } from 'effect';
import { DeclaredCollaboration } from '../../../collaboration/CollaborationConfig';
import { collaborationResidencyLayer, SpawnSeats, spawnSeatsLayer } from '../../../collaboration/collaborationResidency';
import { ThreadEntryKinds } from '../../../transcript/kinds';
import { EndingStages } from '../../ending';
import { inMemoryEndingStages } from '../../storage/InMemoryEndingStages';
import { makeAggregateStorage, type InMemoryAggregateStorage } from '../../storage/InMemoryAggregateStorage';
import type { ThreadRunStorage } from '../../storage/runs';
import {
  ModelRuns,
  ThreadEventJournal,
  ThreadAttachments,
  ThreadInbox,
  ThreadRunStoreFactory,
  ThreadStore,
  ThreadToolOutputVault,
  ThreadTransitions,
  type ThreadTx,
  type ThreadWriteTx,
  type ThreadRhythms,
  threadHostLayer,
} from '../../ThreadPorts';
import { ThreadJournalLane, type ThreadJournalLaneFaces, writerOrderedLane } from '../../transition/lane';
import { threadRunSequencesLayer } from '../../transition/sequence';
import { RunLifecycle, runLifecycleLayer } from '../../run/lifecycle/RunLifecycle';
import { runAdmissionLayer } from '../../run/runAdmission';
import { runControlLayer } from '../../run/RunControl';
import type { Transports } from '../../transport/Transports';
import { fakeAdapter, transportsOver } from '../fakeTransport';
import { threadChangesLayer } from '../../run/ThreadChanges';
import { ThreadRunSettlements, threadRunSettlementsLayer } from '../../run/ThreadRunSettlements';
import { threadSettlementOutboxLayer } from '../../run/ThreadSettlementOutbox';
import { emptyToolOutputs } from './runDoubles';
import { recordingJournal } from './eventLog';
import { inboxFixture } from './inbox';

export const RUN_RHYTHMS: ThreadRhythms = {
  lease: { heartbeatIntervalMs: 30_000, staleRunningAfterMs: 30_000, takeoverAfterMs: 0 },
  reaper: { staleSweepIntervalMs: 30_000, recoveryBatch: 1, resumeWithinMs: 20 * 60_000, resumeAttemptLimit: 1 },
  settlement: {
    settledClaimAfterMs: 30_000,
    settledHeartbeatIntervalMs: 30_000,
    settledNotificationBatch: 1,
    settledNotifyAttemptLimit: 1,
  },
  streamFlushIntervalMs: 0,
};

export type LifecycleOptions = {
  readonly aggregate?: InMemoryAggregateStorage;
  readonly journal?: ReturnType<typeof recordingJournal>;
  readonly inbox?: ThreadInbox['Service'];
  readonly endings?: EndingStages['Service'];
  readonly catalogs?: ModelRuns['Service'];
  readonly lane?: ThreadJournalLaneFaces;
  readonly rhythms?: ThreadRhythms;
  readonly transports?: Layer.Layer<Transports>;
};

export function lifecycleFixture(runs: ThreadRunStorage<ThreadTx, ThreadWriteTx>, options: LifecycleOptions = {}) {
  const aggregate = options.aggregate ?? makeAggregateStorage();
  const journal = options.journal ?? recordingJournal();
  const inbox = options.inbox ?? inboxFixture().inbox;
  const unread = () => Effect.die(new Error('This run does not use this collaboration configuration member.'));
  const residency = collaborationResidencyLayer.pipe(
    Layer.provideMerge(spawnSeatsLayer),
    Layer.provide(
      Layer.succeed(DeclaredCollaboration, {
        models: () => {
          throw new Error('This run does not list models.');
        },
        subAgentDepth: unread,
        delegation: unread,
        reconcileIntervalMs: 0,
        spawnSlots: 1,
      }),
    ),
  );
  const layer = runLifecycleLayer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        threadRunSequencesLayer,
        runAdmissionLayer,
        runControlLayer.pipe(Layer.provideMerge(options.transports ?? transportsOver(fakeAdapter()))),
      ),
    ),
    Layer.provideMerge(threadSettlementOutboxLayer),
    Layer.provideMerge(
      Layer.mergeAll(
        Layer.succeed(ThreadStore, aggregate),
        Layer.succeed(ThreadTransitions, aggregate),
        Layer.succeed(ThreadEventJournal, journal.log),
        Layer.succeed(ThreadInbox, inbox),
        Layer.succeed(
          ThreadAttachments,
          ThreadAttachments.of({ keep: unread, resolve: unread, addressed: unread, hydrate: unread, sizes: unread }),
        ),
        Layer.succeed(ThreadRunStoreFactory, ThreadRunStoreFactory.of({ create: () => runs })),
        Layer.succeed(EndingStages, options.endings ?? inMemoryEndingStages()),
        Layer.succeed(ThreadToolOutputVault, ThreadToolOutputVault.of({ scope: () => emptyToolOutputs, settleOpen: () => Effect.void })),
        Layer.succeed(ThreadJournalLane, options.lane ?? writerOrderedLane),
        options.catalogs === undefined ? Layer.empty : Layer.succeed(ModelRuns, options.catalogs),
        residency,
        threadHostLayer({ ownerId: runs.ownerId, rhythms: options.rhythms ?? RUN_RHYTHMS }),
        threadRunSettlementsLayer,
        threadChangesLayer,
        ThreadEntryKinds.layer([]),
      ),
    ),
  );
  return { layer, aggregate, journal, inbox };
}

export const lifecycleWorld = Effect.fnUntraced(function* (
  runs: ThreadRunStorage<ThreadTx, ThreadWriteTx>,
  options: LifecycleOptions = {},
) {
  const fixture = lifecycleFixture(runs, options);
  const context = yield* Layer.build(fixture.layer);
  return {
    ...fixture,
    context,
    lifecycle: Context.get(context, RunLifecycle),
    seats: Context.get(context, SpawnSeats),
    settlements: Context.get(context, ThreadRunSettlements),
  };
});
