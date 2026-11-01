import { Effect, Layer } from 'effect';
import { ApprovalModes } from '../modes/ApprovalModes';
import { DeclaredCollaboration, type CollaborationConfig } from '../collaboration/CollaborationConfig';
import { agentTypes } from '../collaboration/native/types';
import { ThreadTypes } from '../collaboration/types';
import { DeclaredResources, type ResourcesConfig } from '../resources/ResourcesConfig';
import { DeclaredWorkflow, type WorkflowConfig } from '../workflow/WorkflowConfig';
import { makeAgentRegistry, type AgentRegistry } from './agents/AgentRegistry';
import { ThreadAgents } from './agents/ThreadAgents';
import type { ThreadAttachmentStorage } from './attachmentStorage';
import { EndingStages } from './ending';
import type { ThreadEntryKinds } from '../transcript/kinds';
import { type ThreadCompaction, ThreadCompactor } from './run/ThreadCompaction';
import { makeLandingHolds, RunAdmission } from './run/runAdmission';
import type { ThreadCacheObservationStorage } from './storage/cacheObservations';
import type { ThreadEventLogStorage } from './storage/eventLog';
import { makeInMemoryCacheObservations } from './storage/InMemoryCacheObservationStorage';
import { inMemoryEndingStages } from './storage/InMemoryEndingStages';
import type { ThreadInboxStorage } from './storage/inbox';
import type { ThreadOwnerSettingsStorage } from './storage/ownerSettings';
import type { ThreadRunStorage } from './storage/runs';
import {
  ThreadAttachments,
  ThreadCacheObservations,
  ThreadEventJournal,
  type ThreadHostPorts,
  ThreadInbox,
  ThreadOwnerSettings,
  ThreadRunStoreFactory,
  ThreadStore,
  ThreadToolOutputVault,
  ThreadToolRegistry,
  ThreadTransitions,
  threadToolSources,
  type ThreadToolOutputFaces,
  type ThreadTx,
  type ThreadWriteTx,
} from './ThreadPorts';
import type { ThreadAggregateStorage } from './storage/aggregate';
import { pictureKeepingVault } from './toolPictures';
import { journalLaneFaces, ThreadJournalLane, threadJournalLane } from './transition/lane';
import type { ThreadTransitionStorage } from './transition/port';

export type ThreadStorageHost<TTx, TWrite extends TTx = TTx> = {
  readonly storage: ThreadAggregateStorage<TTx, TWrite>;
  readonly eventLog: ThreadEventLogStorage<TTx, TWrite>;
  readonly transitions: ThreadTransitionStorage<TTx, TWrite>;
  readonly createRuns: (ownerId: string) => ThreadRunStorage<TTx, TWrite>;
  readonly attachments: ThreadAttachmentStorage<TTx>;
  readonly inbox: ThreadInboxStorage<TTx, TWrite>;
  readonly toolOutputs: ThreadToolOutputFaces<TWrite>;
  readonly ownerSettings: ThreadOwnerSettingsStorage;
  readonly cacheObservations?: ThreadCacheObservationStorage<TTx, TWrite>;
};

export type ThreadStoragePorts =
  | ThreadStore
  | ThreadEventJournal
  | ThreadTransitions
  | ThreadRunStoreFactory
  | ThreadAttachments
  | ThreadInbox
  | ThreadToolOutputVault
  | ThreadOwnerSettings
  | ThreadCacheObservations;

export function threadStorageLayer<TTx, TWrite extends TTx>(host: ThreadStorageHost<TTx, TWrite>): Layer.Layer<ThreadStoragePorts> {
  const kernel = host as unknown as ThreadStorageHost<ThreadTx, ThreadWriteTx>;
  return Layer.mergeAll(
    Layer.succeed(ThreadStore, kernel.storage),
    Layer.succeed(ThreadEventJournal, kernel.eventLog),
    Layer.succeed(ThreadTransitions, kernel.transitions),
    Layer.succeed(ThreadRunStoreFactory, { create: (ownerId: string) => kernel.createRuns(ownerId) }),
    Layer.succeed(ThreadAttachments, kernel.attachments),
    Layer.succeed(ThreadInbox, kernel.inbox),
    Layer.succeed(ThreadToolOutputVault, pictureKeepingVault(kernel.toolOutputs, kernel.attachments)),
    Layer.succeed(ThreadOwnerSettings, kernel.ownerSettings),
    kernel.cacheObservations === undefined
      ? Layer.effect(ThreadCacheObservations, makeInMemoryCacheObservations)
      : Layer.succeed(ThreadCacheObservations, kernel.cacheObservations),
  );
}

export type ThreadFeatures<TTx = ThreadTx, TWrite extends TTx = TTx> = {
  readonly collaboration?: CollaborationConfig;
  readonly workflow?: WorkflowConfig;
  readonly resources?: ResourcesConfig<TTx, TWrite>;
};

export type ThreadFeaturePorts = DeclaredCollaboration | DeclaredWorkflow | DeclaredResources;

export function threadFeaturesLayer<TTx, TWrite extends TTx>(features: ThreadFeatures<TTx, TWrite>): Layer.Layer<ThreadFeaturePorts> {
  const declared = features as ThreadFeatures<ThreadTx, ThreadWriteTx>;
  return Layer.mergeAll(
    Layer.succeed(DeclaredCollaboration, declared.collaboration ?? null),
    Layer.succeed(DeclaredWorkflow, declared.workflow ?? null),
    Layer.succeed(DeclaredResources, declared.resources ?? null),
  );
}

export function threadCompactorLayer<TWrite>(compaction: ThreadCompaction<TWrite>): Layer.Layer<ThreadCompactor> {
  return Layer.succeed(ThreadCompactor, compaction as unknown as ThreadCompaction<ThreadWriteTx>);
}

export function threadAgentsLayer<TWrite>(agents: AgentRegistry<TWrite>): Layer.Layer<ThreadAgents> {
  return Layer.succeed(ThreadAgents, agents as unknown as AgentRegistry);
}

export type ThreadGivenPorts = ThreadStoragePorts | ThreadHostPorts | ThreadCompactor | ThreadEntryKinds | ApprovalModes;

export type ThreadDefaultedPorts = ThreadFeaturePorts | EndingStages | RunAdmission | ThreadAgents | ThreadToolRegistry | ThreadTypes;

const defaults = Layer.mergeAll(
  threadFeaturesLayer({}),
  Layer.sync(EndingStages, inMemoryEndingStages),
  Layer.sync(RunAdmission, makeLandingHolds),
  Layer.effect(ThreadJournalLane, Effect.map(threadJournalLane, journalLaneFaces)),
  Layer.effect(ThreadAgents, makeAgentRegistry()),
  Layer.sync(ThreadToolRegistry, threadToolSources),
);

export function threadKernelPorts(given: Layer.Layer<ThreadGivenPorts>): Layer.Layer<ThreadGivenPorts | ThreadDefaultedPorts> {
  const standing = Layer.merge(defaults, given);
  const types = Layer.unwrap(Effect.map(ThreadAgents, agentTypes)).pipe(Layer.provide(standing));
  return Layer.mergeAll(defaults, types, given);
}
