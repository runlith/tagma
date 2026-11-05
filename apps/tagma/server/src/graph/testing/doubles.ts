import { Context, Effect, type FileSystem, Layer } from 'effect';
import { Catalogs, NO_CATALOGS } from '../contract/wire/catalogs.js';
import { actLayer as actLayerValue } from '../acts/unit.js';
import { ZONE_PAGE_BUDGET as zonePageBudgetValue } from '../reading/block.js';
import { instructionChanges as instructionChangesFn, instructionText as instructionTextFn } from '../orientation/Instructions.js';
import { tagPrompts as tagPromptsFn } from '../orientation/tagPrompts.js';
import { type GraphPool, makeGraphPool } from '../serving/pool.js';
import { type MachineContext, machineGraphOf as machineGraphOfFn } from '../serving/machine.js';
import type { MigrationChain } from '../../platform/contract/service/store.js';
import { SessionIdentity } from '../../platform/contract/wire/session.js';
import { GraphMigrations, GraphSource } from '../contract/service/source.js';
import { GraphSteps } from '../contract/service/steps.js';
import { shippedSteps } from '../steps/sequence.js';
import { shadowGateKey as shadowGateKeyFn } from '../serving/permits.js';
import { OtherGraphs as OtherGraphsValue } from '../serving/policy.js';
import { ROUTED, routedContext as routedContextFn, routedSeams as routedSeamsFn } from '../serving/routing.js';
import {
  checkoutMode as checkoutModeValue,
  commentPolicy as commentPolicyValue,
  graphCommit as graphCommitValue,
  mapBudget as mapBudgetValue,
} from '../settings.js';
import { resolveStorageLayout as resolveStorageLayoutFn, storageHomes as storageHomesFn } from '../storage/layout.js';
import { treeHeadStamp as treeHeadStampFn } from '../tree/stamp.js';
import { scanTree as scanTreeFn } from '../tree/scan.js';
import { ShadowGit } from '../tree/shadow.js';
import { syncTopology as syncTopologyFn } from '../tree/topology.js';
import { settingReactionLayer as settingReactionLayerValue } from '../vocabulary/settingsReaction.js';
import { TagIndex as TagIndexClass } from '../vocabulary/tagIndex.js';
import { tagsLayer as tagsLayerValue } from '../vocabulary/tagTable.js';
import { makeWorkEnds } from '../work/tasks/ended.js';
import { makeHolderStandings } from '../work/tasks/holders.js';
import { HolderStandings } from '../contract/service/holders.js';
import { heldTasks as heldTasksFn } from '../work/tasksHeld.js';
import { Background } from '../../platform/contract/service/background.js';
import { makeBackground } from '../../platform/background.js';
import { Mirrors } from '../contract/service/mirrors.js';

export const idleMirrors: Mirrors['Service'] = { serve: Effect.never, departed: () => Effect.void };
import { Capacity, heavyPool, serverCapacity, thisMachine } from '../../platform/contract/service/capacity.js';
import { graphPools } from '../contract/service/lanes.js';
import { CheckoutRows } from '../../workspace/contract/service/checkouts.js';
import { unwatchedCheckouts } from '../../workspace/testing/doubles.js';

export const tagIndex = (...input: ConstructorParameters<typeof TagIndexClass>): TagIndexClass => new TagIndexClass(...input);

export const workEndsOver = makeWorkEnds;

export const commentPolicy = () => commentPolicyValue;

export const mapBudget = () => mapBudgetValue;

export const checkoutMode = () => checkoutModeValue;

export const graphCommit = () => graphCommitValue;

export const graphPool = Effect.fnUntraced(function* ({
  machine,
  identity,
  migrations,
  steps,
  ...source
}: GraphSource['Service'] & {
  readonly machine: MachineContext;
  readonly identity: SessionIdentity['Service'];
  readonly migrations: MigrationChain<'graph'>;
  readonly steps?: GraphSteps['Service'];
}): Effect.fn.Return<GraphPool, never, FileSystem.FileSystem> {
  const existing = Context.getOption(machine, Background);
  const background = existing._tag === 'Some' ? existing.value : yield* makeBackground;
  return yield* Effect.provide(
    makeGraphPool,
    Context.add(machine, GraphSource, source).pipe(
      Context.add(SessionIdentity, identity),
      Context.add(GraphMigrations, migrations),
      Context.add(GraphSteps, steps ?? shippedSteps),
      Context.add(HolderStandings, Context.getOrElse(machine, HolderStandings, makeHolderStandings)),
      Context.add(Background, background),
      Context.add(
        Mirrors,
        Context.getOrElse(machine, Mirrors, () => idleMirrors),
      ),
      Context.add(
        Capacity,
        Context.getOrElse(machine, Capacity, () => serverCapacity([heavyPool(thisMachine()), ...graphPools(thisMachine())])),
      ),
      Context.add(
        CheckoutRows,
        Context.getOrElse(machine, CheckoutRows, () => unwatchedCheckouts),
      ),
    ),
  );
});

export const shadowGitOpen = (...input: Parameters<typeof ShadowGit.open>) => ShadowGit.open(...input);

export const shadowGitOpenInPlace = (...input: Parameters<typeof ShadowGit.openInPlace>) => ShadowGit.openInPlace(...input);

export const tagsLayer = () => tagsLayerValue.pipe(Layer.provide(Layer.succeed(Catalogs, NO_CATALOGS)));

export const settingReactionLayer = () => settingReactionLayerValue;

export const actLayer = () => actLayerValue;

export const OtherGraphs = () => OtherGraphsValue;

export const ZONE_PAGE_BUDGET = () => zonePageBudgetValue;

export const routedStubs = (): Context.Context<never> =>
  ROUTED.reduce<Context.Context<never>>(
    (context, tag) => Context.add(context, tag as unknown as Context.Key<never, object>, {}),
    Context.empty(),
  );

export const routedContext = (...input: Parameters<typeof routedContextFn>) => routedContextFn(...input);

export const routedSeams = (...input: Parameters<typeof routedSeamsFn>) => routedSeamsFn(...input);

export const tagPrompts = (...input: Parameters<typeof tagPromptsFn>) => tagPromptsFn(...input);

export const syncTopology = (...input: Parameters<typeof syncTopologyFn>) => syncTopologyFn(...input);

export const storageHomes = (...input: Parameters<typeof storageHomesFn>) => storageHomesFn(...input);

export const resolveStorageLayout = (...input: Parameters<typeof resolveStorageLayoutFn>) => resolveStorageLayoutFn(...input);

export const treeHeadStamp = (...input: Parameters<typeof treeHeadStampFn>) => treeHeadStampFn(...input);

export const instructionText = (...input: Parameters<typeof instructionTextFn>) => instructionTextFn(...input);

export const instructionChanges = (...input: Parameters<typeof instructionChangesFn>) => instructionChangesFn(...input);

export const heldTasks = (...input: Parameters<typeof heldTasksFn>) => heldTasksFn(...input);

export const scanTree = (...input: Parameters<typeof scanTreeFn>) => scanTreeFn(...input);

export const shadowGateKey = (...input: Parameters<typeof shadowGateKeyFn>) => shadowGateKeyFn(...input);

export const machineGraphOf = <R>(context: Parameters<typeof machineGraphOfFn<R>>[0]) => machineGraphOfFn(context);
