import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context, Effect, FiberSet, Layer } from 'effect';
import type { ThreadResourceKind } from '@runlith/agent/resources/ResourcesConfig';
import { threadJournalLane } from '@runlith/agent/thread/transition/lane';
import { Custody } from '../executions/contract/service/custody.js';
import { Sandboxes } from '../sandbox/contract/service/sandboxes.js';
import { dataPathOf, MachineStore } from '../platform/contract/service/store.js';
import type { Unit } from '../platform/contract/service/units.js';
import { ExternalRolloutPart, NativeResourceKinds, NativeRolloutPart, ThreadFilesPlace } from './contract/service/parts.js';
import { ScratchAreas } from './contract/service/scratch.js';
import { JournalOrder, makeThreadRollouts } from './journal/lane.js';
import { ThreadRollouts } from './contract/service/rollouts.js';
import { makeThreadProjection } from './journal/projection.js';
import { makeThreadRolloutRepair } from './journal/repair.js';
import { makeThreadRolloutReport } from './journal/report.js';
import { rolloutBirth, type RolloutParts } from './journal/rolloutMeta.js';
import { rolloutWriter, RolloutWriting } from './journal/rolloutWriter.js';
import { makeThreadListReads } from './list/store.js';
import { ThreadListing } from './contract/service/listing.js';
import { LISTING, makeListedPlugins } from './listing.js';
import { PluginPoints } from '../plugins/contract/service/points.js';
import { makeThreadLiveSpells } from './list/liveSpells.js';
import { makeMandateRows } from './mandate.js';
import { makeRestedReads } from './journal/restedReads.js';
import { makeSourcePublisher } from './journal/sourcePublisher.js';
import { makeSourceReplacement } from './journal/sourceReplacement.js';
import { sourceRetention } from './journal/sourceRetention.js';
import { sourceRewrites } from './journal/sourceRewrites.js';
import { sourcePublication } from './journal/sourceFiles.js';
import { makeRolloutForms } from './journal/rolloutForming.js';
import { journalEntry } from './journal/rolloutContext.js';
import { RestedRollouts } from './contract/service/rested.js';
import { ThreadMandate } from './contract/service/mandate.js';
import { WorkSpells } from '../thread-record/contract/service/spells.js';
import { ThreadLookup, ThreadPlaces, ThreadReading, ThreadRunning, ThreadShelving, ThreadWindows } from './contract/service/reads.js';
import { AttachmentFiles, makeThreadAttachments } from './resources/attachments.js';
import { makeBaseReach } from './journal/base.js';
import { attachmentsKind } from './resources/kinds/attachments.js';
import { rolloutKind } from './resources/kinds/rollout.js';
import { scratchKind } from './resources/kinds/scratch.js';
import { terminalsKind } from './resources/kinds/terminal.js';
import { sandboxKind } from './resources/sandbox.js';
import { makeThreadScratch } from './resources/scratch.js';
import { makeThreadResourceStore, ThreadResources } from './store/resources.js';
import { HarnessRegistry } from './contract/service/harness.js';
import { harnessRegistry } from './harness/registry.js';
import { threadReleasing } from './harness/releasing.js';
import { ThreadReleasing } from './contract/service/releasing.js';
import { makeThreadList } from './list/threadList.js';
import { ThreadList } from './contract/service/list.js';
import { letGoDetached } from '@runlith/agent/resources/threadResourceLedger';
import { ROLLOUT_HOME } from './contract/wire/rolloutHome.js';
import { OwnWork } from './contract/service/ownWork.js';
import { makeOwnWork } from './collaboration/ownWork.js';
import { ThreadRows } from './contract/service/rows.js';
import { makeThreadRows } from './list/rows.js';

export const releasedResources = Layer.effectDiscard(
  Effect.gen(function* () {
    const resources = yield* ThreadResources;
    yield* Effect.forkScoped(letGoDetached(resources));
  }),
);

export type ThreadsLifetime =
  | ThreadLookup
  | ThreadWindows
  | ThreadRunning
  | ThreadPlaces
  | ThreadShelving
  | ThreadReading
  | ThreadRollouts
  | ThreadResources
  | RolloutWriting
  | JournalOrder
  | HarnessRegistry
  | ThreadReleasing
  | ThreadList
  | OwnWork
  | ThreadRows
  | RestedRollouts
  | ThreadMandate
  | WorkSpells;

export const makeThreadsLifetime = Effect.fnUntraced(function* ({ rolloutHome }: { readonly rolloutHome?: string }) {
  const store = yield* MachineStore;
  const scratch = yield* ScratchAreas;
  const attachments = yield* AttachmentFiles;
  const custody = yield* Custody;
  const sandboxes = yield* Sandboxes;
  const parts: RolloutParts = { native: yield* NativeRolloutPart, external: yield* ExternalRolloutPart };
  const harnessKinds = yield* NativeResourceKinds;
  const order = yield* threadJournalLane;
  const registry = harnessRegistry();
  const rows = yield* makeThreadRows;
  const own = yield* makeOwnWork.pipe(Effect.provideService(ThreadRows, rows));
  const reads = yield* makeThreadListReads.pipe(Effect.provideService(OwnWork, own));
  const retention = sourceRetention();
  const rewrites = sourceRewrites();
  const publication = sourcePublication(parts.native.folds, retention, rewrites);
  const forms = yield* makeRolloutForms({ journal: journalEntry(order), stage: parts.native.folds.stage, publication });
  const replacement = yield* makeSourceReplacement(publication, rolloutHome);
  const sources = yield* makeSourcePublisher({
    home: rolloutHome,
    journal: journalEntry(order),
    forms,
    publication,
    replacement,
    retention,
  });
  yield* Effect.forkScoped(sources.recover.pipe(Effect.catchCause((cause) => Effect.logError('Journal source cleanup stopped', cause))));
  const rested = yield* makeRestedReads({ forms, sources, home: rolloutHome, lagging: (threadId) => rollouts.formRested(threadId) });
  const mandate = yield* makeMandateRows;
  const ledger = yield* makeThreadResourceStore;
  const writer = rolloutWriter({
    pathOf: (projectId, threadId) => rollouts.pathOf(projectId, threadId),
    birth: rolloutBirth(store, parts),
    pendingDir: rolloutHome === undefined ? undefined : join(rolloutHome, '.pending'),
  });
  const projection = yield* makeThreadProjection;
  const append = yield* FiberSet.makeRuntime<never, void, never>();
  const resources = ThreadResources.of({
    storage: ledger,
    get kinds() {
      return kinds;
    },
  });
  const rollouts = yield* makeThreadRollouts({
    projection,
    rollout: yield* makeThreadRolloutReport({ projection }),
    repair: yield* makeThreadRolloutRepair({ publication, replacement }),
    runAppend: append,
    forms,
    retention,
    publication,
    replacement,
    rewrites,
    home: rolloutHome,
  }).pipe(
    Effect.provideService(ThreadRunning, reads),
    Effect.provideService(ThreadShelving, reads),
    Effect.provideService(ThreadResources, resources),
    Effect.provideService(RolloutWriting, writer),
    Effect.provideService(JournalOrder, order),
  );
  const kinds: readonly ThreadResourceKind<Unit<'machine'>>[] = [
    scratchKind(scratch),
    rolloutKind(rollouts),
    attachmentsKind(attachments, yield* makeBaseReach),
    ...harnessKinds,
    terminalsKind(custody),
    sandboxKind(sandboxes),
  ];
  const releasing = threadReleasing();
  const list = yield* makeThreadList.pipe(
    Effect.provideService(ThreadLookup, reads),
    Effect.provideService(ThreadWindows, reads),
    Effect.provideService(ThreadRunning, reads),
    Effect.provideService(ThreadShelving, reads),
    Effect.provideService(ThreadReading, reads),
    Effect.provideService(ThreadRollouts, rollouts),
    Effect.provideService(ThreadReleasing, releasing),
    Effect.provideService(ThreadRows, rows),
  );
  return Context.make(ThreadRollouts, rollouts).pipe(
    Context.add(OwnWork, own),
    Context.add(ThreadRows, rows),
    Context.add(HarnessRegistry, registry),
    Context.add(ThreadReleasing, releasing),
    Context.add(ThreadList, list),
    Context.add(ThreadLookup, reads),
    Context.add(ThreadWindows, reads),
    Context.add(ThreadRunning, reads),
    Context.add(ThreadPlaces, reads),
    Context.add(ThreadShelving, reads),
    Context.add(ThreadReading, reads),
    Context.add(ThreadResources, resources),
    Context.add(RolloutWriting, writer),
    Context.add(RestedRollouts, rested),
    Context.add(ThreadMandate, mandate),
    Context.add(WorkSpells, yield* makeThreadLiveSpells),
    Context.add(JournalOrder, order),
  );
});

export const threadsCoreLayer = Layer.effectContext(
  Effect.gen(function* () {
    const store = yield* MachineStore;
    const place = yield* ThreadFilesPlace;
    const home = dataPathOf(store.path) ?? undefined;
    const scratch = yield* makeThreadScratch({ root: place.scratch ?? join(home ?? tmpdir(), 'scratch') });
    const reach = yield* makeBaseReach;
    const attachments = yield* makeThreadAttachments({ root: place.attachments, sources: reach.sources });
    const listing = makeListedPlugins();
    yield* Effect.acquireRelease((yield* PluginPoints).declare(LISTING, listing.register), (withdraw) => Effect.sync(withdraw));
    const core = yield* makeThreadsLifetime({ rolloutHome: home === undefined ? undefined : join(home, ROLLOUT_HOME) }).pipe(
      Effect.provideService(ScratchAreas, scratch),
      Effect.provideService(AttachmentFiles, attachments),
      Effect.provideService(ThreadListing, listing),
    );
    return core.pipe(Context.add(ScratchAreas, scratch), Context.add(AttachmentFiles, attachments), Context.add(ThreadListing, listing));
  }),
);
