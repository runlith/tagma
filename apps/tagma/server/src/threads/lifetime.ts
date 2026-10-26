import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context, Effect, FiberSet, Layer } from 'effect';
import type { ThreadResourceKind } from '@runlith/agent/resources/ResourcesConfig';
import { threadJournalLane } from '@runlith/agent/thread/transition/lane';
import { Custody } from '../executions/contract/service/custody.js';
import { Sandboxes } from '../sandbox/contract/service/sandboxes.js';
import { dataPathOf, MachineStore } from '../platform/contract/service/store.js';
import type { Unit } from '../platform/contract/service/units.js';
import { Background } from '../platform/contract/service/background.js';
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
import { makeThreadLiveSpells } from './list/liveSpells.js';
import { makeMandateRows } from './mandate.js';
import { makeRestedReads } from './journal/restedReads.js';
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
import { ActivityRecord } from '@runlith/activity/store/record';
import { activeNarrowed } from './list/active.js';
import { letGoDetached } from '@runlith/agent/resources/threadResourceLedger';
import { ROLLOUT_HOME } from './contract/wire/rolloutHome.js';

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
  const activity = yield* ActivityRecord;
  const order = yield* threadJournalLane;
  const registry = harnessRegistry();
  const reads = yield* makeThreadListReads;
  const forms = yield* makeRolloutForms({ journal: journalEntry(order) });
  const rested = yield* makeRestedReads({ forms, home: rolloutHome, lagging: (threadId) => rollouts.formRested(threadId) });
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
    repair: yield* makeThreadRolloutRepair,
    runAppend: append,
    forms,
    background: yield* Background,
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
  );
  return Context.make(ThreadRollouts, rollouts).pipe(
    Context.add(HarnessRegistry, registry),
    Context.add(ThreadReleasing, releasing),
    Context.add(ThreadList, list),
    Context.add(ThreadLookup, reads),
    Context.add(ThreadWindows, {
      ...reads,
      list: (ownerId, projectId, selection) =>
        Effect.flatMap(activeNarrowed(activity, projectId, selection), (narrowed) => reads.list(ownerId, projectId, narrowed)),
      ids: (ownerId, projectId, selection) =>
        Effect.flatMap(activeNarrowed(activity, projectId, selection), (narrowed) => reads.ids(ownerId, projectId, narrowed)),
    }),
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
    const core = yield* makeThreadsLifetime({ rolloutHome: home === undefined ? undefined : join(home, ROLLOUT_HOME) }).pipe(
      Effect.provideService(ScratchAreas, scratch),
      Effect.provideService(AttachmentFiles, attachments),
    );
    return core.pipe(Context.add(ScratchAreas, scratch), Context.add(AttachmentFiles, attachments));
  }),
);
