import { threads as declaration } from './contract/wire/module.js';
import { Context, Effect, Layer } from 'effect';
import { ApprovalModes } from '@runlith/agent/modes/ApprovalModes';
import { RELOCATIONS } from '../platform/contract/service/relocation.js';
import { ROLLOUT_HOME } from './contract/wire/rolloutHome.js';
import { threadsVerbs } from './cli.js';
import type { OperationPair } from '../platform/contract/service/body.js';
import { lazyLayer, liveOf, manifest, type SettingControlSource } from '../platform/contract/service/manifest.js';
import { THREAD_CAPABILITIES } from './contract/wire/capability.js';
import { ThreadFeeds } from './contract/service/feeds.js';
import type { ThreadLive } from './contract/service/live.js';
import { dirname, join } from 'node:path';
import { THREAD_FEEDS } from './contract/wire/feeds.js';
import { birthApprovalMode, THREADS_SETTING_KEYS, THREADS_SETTING_SECTIONS } from './contract/wire/settings.js';
import { THREADS_ENTRY_KINDS } from './contract/wire/entryKinds.js';
import { SECTIONS } from './doctrine/registry.js';
import { BUILTIN_NOTES } from './contract/service/notes.js';
import { HOME_FOLLOWERS } from '../thread-record/contract/service/homes.js';
import { stance } from './notes/stance.js';
import { recordMetaForm } from './steps/recordMeta.js';
import { questionEndorsedForm } from './steps/questionEndorsed.js';
import { appBindingForm } from './steps/appBinding.js';

const live: ThreadLive = liveOf(THREAD_FEEDS, (door) => {
  const feeds = Context.get(door, ThreadFeeds);
  return {
    'thread.subscribe': feeds['thread.subscribe'],
    'threads.subscribe': feeds['threads.subscribe'],
    'threads.presence': feeds['threads.presence'],
    'attention.subscribe': feeds['attention.subscribe'],
    'threads.pulse': feeds['threads.pulse'],
  };
});

export const threads = manifest({
  ...declaration,
  capabilities: THREAD_CAPABILITIES,
  verbs: threadsVerbs,
  entryKinds: THREADS_ENTRY_KINDS,
  formSteps: [recordMetaForm, questionEndorsedForm, appBindingForm],
  sections: Object.values(SECTIONS),
  contributions: [
    ...RELOCATIONS.of({
      id: 'threads/rollouts',
      carried: (data) => [join(data, ROLLOUT_HOME), join(data, 'scratch'), join(data, 'attachments')],
      relocate: () => Effect.succeed([]),
    }),
    ...BUILTIN_NOTES.of(stance),
    ...HOME_FOLLOWERS.of({ id: 'threads/places', load: async () => (await import('./homeFollowing.js')).threadHomes }),
  ],
  snapshots: async (home) =>
    (await import('./journal/rolloutSnapshot.js')).rolloutParticipant(home.machine, join(dirname(home.machine), ROLLOUT_HOME)),
  live,
  subjects: async () => (await import('./subjects.js')).THREAD_SUBJECTS,
  bodies: async (): Promise<readonly OperationPair[]> => {
    const [
      { TURN_PAIRS },
      { ROUTE_PAIRS },
      { UPDATE_WORKTREE_PAIRS },
      { AGENT_PAIRS },
      { READ_PAIRS },
      { ACT_PAIRS },
      { FOLDER_PAIRS },
      { SEARCH_PAIRS },
      { COLLABORATION_PAIRS },
      { ATTENTION_PAIRS },
      { SUBSCRIPTION_PAIRS },
      { RECAP_PAIRS },
      { PIN_PAIRS },
      { NOTE_PAIRS },
    ] = await Promise.all([
      import('./operations/turns.js'),
      import('./operations/routes.js'),
      import('./operations/updateWorktree.js'),
      import('./operations/agents.js'),
      import('./operations/reads.js'),
      import('./operations/acts.js'),
      import('./operations/folders.js'),
      import('./operations/search.js'),
      import('./operations/collaboration.js'),
      import('./operations/attention.js'),
      import('./operations/subscriptions.js'),
      import('./operations/recap.js'),
      import('./operations/pins.js'),
      import('./operations/notes.js'),
    ]);
    return [
      ...Object.values(TURN_PAIRS),
      ...Object.values(ROUTE_PAIRS),
      ...Object.values(UPDATE_WORKTREE_PAIRS),
      ...Object.values(AGENT_PAIRS),
      ...Object.values(READ_PAIRS),
      ...Object.values(ACT_PAIRS),
      ...Object.values(FOLDER_PAIRS),
      ...Object.values(SEARCH_PAIRS),
      ...Object.values(COLLABORATION_PAIRS),
      ...Object.values(ATTENTION_PAIRS),
      ...Object.values(SUBSCRIPTION_PAIRS),
      ...Object.values(RECAP_PAIRS),
      ...Object.values(PIN_PAIRS),
      ...Object.values(NOTE_PAIRS),
    ];
  },
  presentation: async () => (await import('./presentation.js')).THREADS_PRESENTATION,
  settingControls: [
    {
      id: birthApprovalMode.id,
      read: (context) => ({
        kind: 'choice',
        choices: Context.get(context, ApprovalModes)
          .declared()
          .map((mode) => ({ value: mode.id, label: mode.label, hint: mode.description })),
      }),
    },
  ] satisfies readonly SettingControlSource<ApprovalModes>[],
  settings: [...THREADS_SETTING_KEYS],
  settingSections: THREADS_SETTING_SECTIONS,
  tables: async () => {
    const [
      { threadSeen, threadInbox, threadInboxWake, threadResource, threadTargetOperation },
      { threadViewPin },
      { threadBase, threadEvent, threadJournalPlace, threadRolloutCursor, threadRolloutForm, threadRolloutHome, threadRolloutRefusal },
      { approvalPreference },
      { threadMandate, threadLiveSpell },
      { workflowRun },
      { owedCall, spentCallKey, spentEpoch, threadCall },
      { threadMessage, threadConversation, threadQuietRun, threadMessageGap },
      { threadPlace, threadCopy },
      { operatorNote },
      { threadSubscription },
    ] = await Promise.all([
      import('./store/tables.js'),
      import('./store/pins.js'),
      import('./store/journal.js'),
      import('./store/preferences.js'),
      import('./store/mandate.js'),
      import('./store/workflow.js'),
      import('./store/calls.js'),
      import('./store/conversation.js'),
      import('./store/places.js'),
      import('./notes/table.js'),
      import('./store/subscriptions.js'),
    ]);
    return {
      entities: [
        threadBase,
        threadPlace,
        threadCopy,
        threadConversation,
        threadResource,
        threadSeen,
        threadViewPin,
        threadJournalPlace,
        threadRolloutCursor,
        threadRolloutForm,
        threadRolloutHome,
        threadRolloutRefusal,
        approvalPreference,
        threadMandate,
        threadLiveSpell,
        spentEpoch,
        operatorNote,
        threadSubscription,
      ],
      history: [
        threadMessage,
        threadQuietRun,
        threadMessageGap,
        threadInbox,
        threadInboxWake,
        threadTargetOperation,
        threadEvent,
        workflowRun,
        threadCall,
        owedCall,
        spentCallKey,
      ],
    };
  },
  rowFacts: async () => (await import('./list/inputs.js')).threadRowDeclarations,
  drivers: [{ id: 'thread-sweeps' }, { id: 'rollout-shelving' }, { id: 'rollout-reconciling' }, { id: 'said-backfill' }],
  lifetimes: {
    installation: lazyLayer(
      () => Promise.all([import('./assembly.js'), import('./worlds.js'), import('./lifetime.js')]),
      ([{ threadStoresLayer, threadTargetsLayer, worktreeThreadsLayer }, { threadWorldsLayer }, { threadsCoreLayer }]) =>
        Layer.mergeAll(threadStoresLayer, threadTargetsLayer, worktreeThreadsLayer).pipe(
          Layer.provideMerge(threadWorldsLayer),
          Layer.provideMerge(threadsCoreLayer),
        ),
    ),
    workspace: lazyLayer(
      () => Promise.all([import('./harness/engine.js'), import('./assembly.js')]),
      ([{ threadEngineLayer }, { harnessFillersLayer, placingLayer }]) =>
        threadEngineLayer.pipe(Layer.provideMerge(harnessFillersLayer), Layer.provideMerge(placingLayer)),
    ),
    serving: lazyLayer(
      () => import('./assembly.js'),
      ({ threadsLayer }) => threadsLayer,
    ),
    afterRecovery: lazyLayer(
      () => import('./lifetime.js'),
      ({ releasedResources }) => releasedResources,
    ),
  },
});
