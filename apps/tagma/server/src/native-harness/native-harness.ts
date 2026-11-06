import { nativeHarness as declaration } from './contract/wire/module.js';
import { Context, Effect, Layer } from 'effect';
import { nativeHarnessVerbs } from './cli.js';
import { lazyLayer, liveOf, manifest } from '../platform/contract/service/manifest.js';
import { NATIVE_CAPABILITIES } from './contract/wire/capability.js';
import { CallActivity } from './contract/service/calls.js';
import type { NativeLive } from './contract/service/live.js';
import { OwnSkillDirectories } from './contract/service/ownSkills.js';
import { ViewCapabilities } from '../views/contract/service/capabilities.js';
import { NATIVE_SETTING_KEYS, NATIVE_SETTING_SECTIONS } from './contract/wire/settingDeclarations.js';
import { keepWarmTurns } from './doctrine/keepWarm.js';
import { typedTools } from './doctrine/typedTools.js';
import { CALLS_FEED } from './contract/wire/calls.js';
import { THREAD_NATIVE_FEEDS } from './contract/wire/threadFeeds.js';
import { ThreadLaunchGate, ThreadLive } from '../threads/contract/service/engine.js';
import type { NativeThreadState } from '../threads/contract/service/state.js';
import { instructionForm } from './steps/projectInstructions.js';
import { developerForm } from './steps/developerForm.js';
import { developerRetired, rulesRetired } from './steps/retired.js';
import { nativeRowForm } from './steps/nativeRow.js';
import { START_ENTRY, StartEntry } from './contract/wire/start.js';
import { NATIVE_RULES } from './contract/service/rules.js';
import { instructionSource } from './turns/instructionRule.js';
import { touchSource } from './capabilities/touchRule.js';
import { explicitSkillSource } from './capabilities/skills.js';
import { delegationSource } from './turns/delegationRule.js';
import { budgetSource } from './turns/budgetRule.js';
import { teamSource } from './turns/teamRule.js';
import { checkSource } from './capabilities/checkRule.js';
import { availabilitySource } from './capabilities/availability.js';
import { cueSource } from './capabilities/cueRule.js';

const FEEDS = [CALLS_FEED, ...THREAD_NATIVE_FEEDS] as const;

const live: NativeLive = liveOf(FEEDS, async (door) =>
  (await import('./calls/channel.js')).callChannel({ activity: Context.get(door, CallActivity) }),
);

export const nativeHarness = manifest({
  ...declaration,
  capabilities: NATIVE_CAPABILITIES,
  contributions: NATIVE_RULES.of(
    instructionSource,
    touchSource,
    explicitSkillSource,
    delegationSource,
    budgetSource,
    teamSource,
    checkSource,
    availabilitySource,
    cueSource,
  ),
  verbs: nativeHarnessVerbs,
  bodies: async () => {
    const loaded = await Promise.all([
      import('./inputs/operations.js').then(({ INPUT_PAIRS }) => INPUT_PAIRS),
      import('./compaction/operations.js').then(({ COMPACTION_PAIRS }) => COMPACTION_PAIRS),
      import('./models/operations.js').then(({ MODEL_PAIRS }) => MODEL_PAIRS),
      import('./operations/calls.js').then(({ CALL_PAIRS }) => CALL_PAIRS),
      import('./workflows/operations.js').then(({ WORKFLOW_PAIRS }) => WORKFLOW_PAIRS),
      import('./skills/operations.js').then(({ SKILL_PAIRS }) => SKILL_PAIRS),
      import('./evidence/operations.js').then(({ EVIDENCE_PAIRS }) => EVIDENCE_PAIRS),
      import('./context/operations.js').then(({ CONTEXT_PAIRS }) => CONTEXT_PAIRS),
      import('./agents/operations.js').then(({ NATIVE_AGENT_PAIRS }) => NATIVE_AGENT_PAIRS),
      import('./capabilities/operations.js').then(({ CAPABILITY_PAIRS }) => CAPABILITY_PAIRS),
    ]);
    return loaded.flatMap((pairs) => Object.values(pairs));
  },
  presentation: async () => (await import('./context/operations.js')).CONTEXT_PRESENTATION,
  live,
  retiredTables: ['retired_run_transition'],
  formSteps: [instructionForm, developerForm, developerRetired, nativeRowForm, rulesRetired],
  entryKinds: [{ type: START_ENTRY, schema: StartEntry }],
  settings: [...NATIVE_SETTING_KEYS],
  settingSections: NATIVE_SETTING_SECTIONS,
  tables: async () => {
    const [
      {
        targetSnapshot,
        threadCacheObservation,
        threadCompactionCheckpoint,
        threadHistoryItem,
        threadLog,
        threadPrunedToolCall,
        threadRev,
        threadRunReceipt,
      },
      { thread, threadEntry, threadRun, threadRunTally },
      { modelPreference },
    ] = await Promise.all([import('./store/thread.js'), import('../threads/store/kernel.js'), import('./store/preferences.js')]);
    return {
      entities: [thread, threadRev, threadLog, modelPreference],
      history: [
        targetSnapshot,
        threadRun,
        threadRunTally,
        threadRunReceipt,
        threadHistoryItem,
        threadEntry,
        threadCompactionCheckpoint,
        threadPrunedToolCall,
        threadCacheObservation,
      ],
    };
  },
  sections: [
    {
      id: 'keep-warm',
      place: { prompt: 260 },
      owner: 'native-harness',
      render: keepWarmTurns,
      path: 'src/native-harness/doctrine/keepWarm.ts',
    },
    {
      id: 'typed-tools',
      place: { prompt: 40 },
      owner: 'native-harness',
      render: typedTools,
      path: 'src/native-harness/doctrine/typedTools.ts',
    },
  ],
  drivers: [{ id: 'stalled-runs' }, { id: 'compaction-calibration' }, { id: 'native-sweeps' }],
  lifetimes: {
    installation: lazyLayer(
      () =>
        Promise.all([
          import('@runlith/agent/thread/run/ThreadLiveFeed'),
          import('@runlith/agent/thread/AgentHarness'),
          import('./tools/webSearch.js'),
          import('./assembly.js'),
          import('./inputs/cache.js'),
        ]),
      ([{ makeThreadLiveFeed }, { newLaunchGate }, { webSearchLayer }, { nativeStoresLayer }, { workspaceInputsLayer }]) =>
        Layer.mergeAll(
          Layer.effect(ThreadLive, makeThreadLiveFeed<NativeThreadState>()),
          Layer.sync(ThreadLaunchGate, newLaunchGate),
          webSearchLayer,
          nativeStoresLayer,
          Layer.unwrap(
            Effect.gen(function* () {
              const own = yield* OwnSkillDirectories;
              return workspaceInputsLayer(own, (yield* ViewCapabilities).all);
            }),
          ),
        ),
    ),
    workspace: lazyLayer(
      () => import('./kernel.js'),
      ({ nativeEngineLayer, nativeKernelLayer, nativeKernelServices }) =>
        Layer.mergeAll(nativeEngineLayer, nativeKernelServices).pipe(Layer.provideMerge(nativeKernelLayer)),
    ),
    serving: lazyLayer(
      () => import('./assembly.js'),
      ({ nativeHarnessLayer }) => nativeHarnessLayer,
    ),
  },
});
