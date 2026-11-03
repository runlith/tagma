import { graph as declaration } from './contract/wire/module.js';
import { Context, Layer } from 'effect';
import { graphVerbs } from './cli.js';
import { GRAPH_FEED, GRAPH_RECOVERY_FEED, GRAPH_WORK_FEED } from './contract/wire/feed.js';
import { GraphRecoveries } from './contract/service/recovery.js';
import { HolderCopies } from './contract/service/holders.js';
import { ServedGraphs } from './contract/service/serving.js';
import { BEHAVIOURS } from './contract/service/behaviours.js';
import { graphBehaviours } from './behaviours.js';
import { RELOCATIONS } from '../platform/contract/service/relocation.js';
import { MACHINE_REGISTRY } from '../platform/contract/service/machineRegistry.js';
import { graphRelocation } from './storage/relocation.js';
import type { GraphLive } from './contract/service/live.js';
import { GRAPH_SETTING_KEYS, GRAPH_SETTING_SECTIONS } from './settings.js';
import { lazyLayer, liveOf, manifest } from '../platform/contract/service/manifest.js';
import { graphCapability } from './contract/wire/capability.js';
import { aimingARead } from './doctrine/aimingARead.js';
import { blockReferences } from './doctrine/blockReferences.js';
import { general } from './doctrine/general.js';
import { graphEvidence } from './doctrine/graphEvidence.js';
import { graphReading } from './doctrine/graphReading.js';
import { graphRefusals } from './doctrine/graphRefusals.js';
import { graphWriting } from './doctrine/graphWriting.js';
import { review } from './doctrine/review.js';
import { theCheckoutAndTheGraph } from './doctrine/theCheckoutAndTheGraph.js';
import { theLongLivedBranch } from './doctrine/theLongLivedBranch.js';
import { whatItIs } from './doctrine/whatItIs.js';
import { operationContextForm, ruleOperationContextForm } from './steps/operationContexts.js';
import { graphPools } from './contract/service/lanes.js';

const FEEDS = [GRAPH_FEED, GRAPH_WORK_FEED, GRAPH_RECOVERY_FEED] as const;

const live: GraphLive = liveOf(FEEDS, async (door) =>
  (await import('./journal/channel.js')).graphChannel(
    Context.get(door, ServedGraphs),
    Context.get(door, GraphRecoveries),
    Context.get(door, HolderCopies),
  ),
);

export const graph = manifest({
  ...declaration,
  capabilities: [graphCapability],
  verbs: graphVerbs,
  bodies: async () => Object.values((await import('./operations/pairs.js')).GRAPH_PAIRS),
  presentation: async () => (await import('./presentation.js')).GRAPH_PRESENTATION,
  subjects: async () => (await import('./subjects.js')).GRAPH_SUBJECTS,
  live,
  settings: [...GRAPH_SETTING_KEYS],
  settingSections: GRAPH_SETTING_SECTIONS,
  contributions: [
    ...BEHAVIOURS.of(...graphBehaviours),
    ...RELOCATIONS.of(graphRelocation),
    ...MACHINE_REGISTRY.of({ id: 'graph/policy', load: async () => (await import('./machineRegistry.js')).policyRows }),
  ],
  formSteps: [operationContextForm, ruleOperationContextForm],
  pools: graphPools,
  sections: [
    { id: 'aiming-a-read', place: { law: 100 }, owner: 'graph', render: aimingARead, path: 'src/graph/doctrine/aimingARead.ts' },
    {
      id: 'block-references',
      place: { prompt: 230 },
      owner: 'graph',
      render: blockReferences,
      path: 'src/graph/doctrine/blockReferences.ts',
    },
    { id: 'general', place: { law: 10 }, owner: 'graph', render: general, path: 'src/graph/doctrine/general.ts' },
    {
      id: 'graph-evidence',
      place: { prompt: 160, law: 150 },
      owner: 'graph',
      render: graphEvidence,
      path: 'src/graph/doctrine/graphEvidence.ts',
    },
    {
      id: 'graph-reading',
      place: { prompt: 140, law: 90 },
      owner: 'graph',
      render: graphReading,
      path: 'src/graph/doctrine/graphReading.ts',
    },
    {
      id: 'graph-refusals',
      place: { prompt: 130, law: 120 },
      owner: 'graph',
      render: graphRefusals,
      path: 'src/graph/doctrine/graphRefusals.ts',
    },
    {
      id: 'graph-writing',
      place: { prompt: 150, law: 140 },
      owner: 'graph',
      render: graphWriting,
      path: 'src/graph/doctrine/graphWriting.ts',
    },
    { id: 'review', place: { prompt: 170, 'REVIEW.md': 10 }, owner: 'graph', render: review, path: 'src/graph/doctrine/review.ts' },
    {
      id: 'the-checkout-and-the-graph',
      place: { prompt: 110, law: 80 },
      owner: 'graph',
      render: theCheckoutAndTheGraph,
      path: 'src/graph/doctrine/theCheckoutAndTheGraph.ts',
      when: 'code',
    },
    {
      id: 'the-long-lived-branch',
      place: { 'LIFECYCLE.md': 10 },
      owner: 'graph',
      render: theLongLivedBranch,
      path: 'src/graph/doctrine/theLongLivedBranch.ts',
    },
    { id: 'what-tagma-is', place: { prompt: 30, law: 40 }, owner: 'graph', render: whatItIs, path: 'src/graph/doctrine/whatItIs.ts' },
  ],
  tables: async () => {
    const [{ block, blockField, blockTag, edge, event, farEdge, meta, ref, searchIndex, source, touch, unboundEdge }, { projectPolicy }] =
      await Promise.all([import('./store/tables.js'), import('./store/policy.js')]);
    return {
      entities: [meta, block, blockTag, blockField, edge, farEdge, unboundEdge, searchIndex, ref, source, projectPolicy],
      history: [touch, event],
    };
  },
  lifetimes: {
    afterRecovery: lazyLayer(
      () => import('./storage/retirement.js'),
      ({ mirrorRetirementLayer }) => mirrorRetirementLayer,
    ),
    installation: lazyLayer(
      async () => ({
        ...(await import('./layer.js')),
        ...(await import('./steps/sequence.js')),
        ...(await import('./work/tasks/ended.js')),
        ...(await import('./work/tasks/holders.js')),
      }),
      ({ graphLayer, graphStepsLayer, workEndsLayer, holderStandingsLayer, holderCopiesLayer }) =>
        Layer.orDie(graphLayer({})).pipe(
          Layer.provideMerge(graphStepsLayer),
          Layer.provideMerge(workEndsLayer),
          Layer.provideMerge(holderStandingsLayer),
          Layer.provideMerge(holderCopiesLayer),
        ),
    ),
    serving: lazyLayer(
      async () => ({
        ...(await import('./serving/poolLayer.js')),
        ...(await import('./steps/sequence.js')),
        ...(await import('./storage/retirement.js')),
      }),
      ({ graphPoolLayer, graphStepsLayer, mirrorsLayer }) =>
        graphPoolLayer.pipe(Layer.provide(graphStepsLayer), Layer.provideMerge(mirrorsLayer)),
    ),
  },
});
