import * as BunPath from '@effect/platform-bun/BunPath';
import { Context, Effect, FileSystem, Layer } from 'effect';
import { type GraphStore, MachineStore } from '../platform/contract/service/store.js';
import type { GraphServices } from '../graph/contract/service/services.js';
import { MachineUnits } from '../platform/contract/service/units.js';
import { lazyLayer } from '../platform/contract/service/manifest.js';
import { LineWrites } from '../change-record/contract/service/lineWrites.js';
import { lineWrites } from './lineWrites.js';
import { modelAsksLayer } from '../providers/asks.js';
import { askSettingsLayer } from '../providers/askSettings.js';
import { compactionAsksLayer } from '../providers/compactionAsks.js';
import { defaultSelectionLayer } from '../native-harness/models/defaultSelection.js';
import { Holdings } from '../change-record/contract/service/holdings.js';
import { HeldPathCounts } from '../threads/contract/service/parts.js';
import { WorldPreferences } from '../executions/contract/service/worlds.js';
import type { ExecutionServices } from '../executions/assembly.js';
import { executions } from '../executions/executions.js';
import { programRoadOver, worktreeRootEnding, worktreeSetup } from '../executions/ports.js';
import { ProgramRoad } from '../executions/contract/service/programs.js';
import { changeRecord } from '../change-record/change-record.js';
import { commitSteps } from '../commit-steps/commit-steps.js';
import { config } from '../config/config.js';
import { checkoutFiles } from '../checkout-files/checkout-files.js';
import { RipgrepBinary } from '../platform/contract/service/ripgrep.js';
import { Renames } from '../checkout-files/contract/service/renames.js';
import { ScratchFolders } from '../checkout-files/contract/service/scratch.js';
import { ChangeRecord } from '../change-record/contract/service/record.js';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import { ScratchAreas } from '../threads/contract/service/scratch.js';
import { ripgrepBinary } from './ripgrepBinary.js';
import { graph } from '../graph/graph.js';
import { ServingPool } from '../graph/serving/poolLayer.js';
import { makeGraphDelivery } from '../graph/serving/delivery.js';
import { enforcement } from '../enforcement/enforcement.js';
import { RuleChecks } from '../enforcement/contract/service/ruleChecks.js';
import { OperationChecks } from '../invocation/contract/service/operationChecks.js';
import { GraphChanging } from '../landing/contract/service/graphChanges.js';
import { GraphSyncing } from '../landing/contract/service/graphSyncing.js';
import { graphSyncOf } from '../landing/graphSync.js';

import { runAdmissionLayer } from '@runlith/agent/thread/run/runAdmission';
import { landingAdmissionLayer } from './preparedChanges.js';
import { operationChecks } from './operationChecks.js';
import { landing } from '../landing/landing.js';
import { mcp } from '../mcp/mcp.js';
import { notify } from '../notify/notify.js';
import { outcomes } from './outcomes.js';
import { push } from '../push/push.js';
import { schedule } from '../schedule/schedule.js';
import { translations } from '../translations/translations.js';
import { ticks } from './ticks.js';
import { buildSteps } from './buildSteps.js';
import { ThreadGraphs } from '../native-harness/contract/service/graphs.js';
import { SetupReadings } from '../native-harness/contract/service/setups.js';
import { CapabilityOffers } from '../native-harness/contract/service/execution.js';
import { OperationCatalog } from '../invocation/contract/service/catalog.js';
import { invocationAssembly } from '../invocation/assembly.js';
import { checkoutWorld } from '../native-harness/contract/wire/settings.js';
import { nativeHarness } from '../native-harness/native-harness.js';
import { Settings } from '../settings/contract/service/values.js';
import { HarnessSandboxes } from '../threads/contract/service/engine.js';
import { Sandboxes } from '../sandbox/contract/service/sandboxes.js';
import type { GraphOrigin } from '../threads/contract/wire/target.js';
import { threadTeardownLayer } from '../threads/teardown.js';
import { BranchTitling } from '../threads/naming/titles.js';
import { threadFeedsLayer } from '../threads/list/feeds.js';
import { threadCopiesLayer } from './threadCopies.js';
import { threads } from '../threads/threads.js';
import { makeAssignmentLedger } from '../workspace/assignments/membership.js';
import { makeAssignmentStore } from '../workspace/store/assignments.js';
import { Assignments } from '../workspace/contract/service/assignments.js';
import { workspace } from '../workspace/workspace.js';
import { BranchTitles, BranchTwinning } from '../worktrees/contract/service/branches.js';
import { RootEndings } from '../worktrees/contract/service/rootEndings.js';
import { Mirrors } from '../graph/contract/service/mirrors.js';
import { GraphDelivering, WorktreeDeparture } from '../worktrees/contract/service/retirement.js';
import { CheckDriver, CheckPreparation } from '../worktrees/contract/service/mergeChecks.js';
import { WorktreeHeld } from '../worktrees/contract/service/listing.js';
import { graphDriver } from '../enforcement/commits/graphMerge.js';
import { SetupCommands } from '../worktrees/contract/service/setup.js';
import { WorktreeOwners } from '../worktrees/contract/service/owners.js';
import { worktrees } from '../worktrees/worktrees.js';
import { setupStateLayer } from '../worktrees/layer.js';
import { externalHarnesses } from '../external-harnesses/external-harnesses.js';
import { Git } from '@runlith/git/Git';
import { DoctrineFacts } from '../platform/contract/service/facts.js';
import type { FactCheckout } from '../platform/contract/wire/section.js';
import type { Assembly } from './manifest.js';
import { BuiltinNotes } from '../threads/contract/service/notes.js';
import { HomeFollowers } from '../thread-record/contract/service/homes.js';
import { DeclaredCapabilities } from '../native-harness/contract/service/capabilities.js';
import { nativeDoor } from './nativeDoor.js';
import { navigationServing } from './navigation.js';

const worldPreferences = Layer.effect(
  WorldPreferences,
  Effect.map(Settings, (settings) => ({ checkout: () => settings.value(checkoutWorld) })),
);

const assignments = Layer.effect(
  Assignments,
  Effect.flatMap(MachineStore, ({ db }) => makeAssignmentLedger({ store: makeAssignmentStore({ db }) })),
);

const targetSnapshots = lazyLayer(
  () => import('../native-harness/assembly.js'),
  ({ targetSnapshotsLayer }) => targetSnapshotsLayer,
);

const setupCommands = Layer.effect(SetupCommands, Effect.map(Effect.context<ExecutionServices>(), worktreeSetup));

const rootEndings = Layer.effect(
  RootEndings,
  Effect.gen(function* () {
    return worktreeRootEnding(yield* Effect.context<ExecutionServices>(), yield* MachineUnits);
  }),
);

const setupReadings = Layer.effect(
  SetupReadings,
  Effect.map(WorktreeOwners, (owners) => owners.setups),
);

const sandboxes = Layer.effect(
  HarnessSandboxes,
  Effect.map(Sandboxes, (standing) => standing),
);

const branchTitling = Layer.effect(
  BranchTitling,
  Effect.map(BranchTitles, (titles) => titles.titled),
);

const heldPathCounts = Layer.effect(
  HeldPathCounts,
  Effect.map(Holdings, (holdings) => {
    const counts = (threadIds: readonly string[]) =>
      Effect.map(
        holdings.threads(threadIds),
        (totals) =>
          new Map(
            [...totals].flatMap(([thread, total]) =>
              total.paths + total.unproven > 0 ? [[thread, { paths: total.paths, unproven: total.unproven }] as const] : [],
            ),
          ),
      );
    return { counts, moved: counts };
  }),
);

const PROGRAM_SHELL = '/bin/sh';

const programs = Layer.effect(
  ProgramRoad,
  Effect.map(Effect.context<ExecutionServices>(), (standing) => programRoadOver(standing, PROGRAM_SHELL)),
);

const configured = config.lifetimes.serving.pipe(Layer.provide(programs));

const shaped = commitSteps.lifetimes.serving.pipe(Layer.provide(Layer.merge(programs, configured)));

const recorded = changeRecord.lifetimes.serving.pipe(
  Layer.provideMerge(
    Layer.mergeAll(
      shaped,
      configured,
      landingAdmissionLayer.pipe(Layer.provideMerge(runAdmissionLayer)),
      Layer.succeed(LineWrites, lineWrites),
    ),
  ),
);

const written = workspace.lifetimes.serving.pipe(Layer.provideMerge(recorded));

const pooled = graph.lifetimes.serving.pipe(Layer.provideMerge(written));

const judged = enforcement.lifetimes.serving.pipe(Layer.provideMerge(programs.pipe(Layer.provideMerge(pooled))));

const graphBindings = Layer.effectContext(
  Effect.gen(function* () {
    const pool = yield* ServingPool;
    const mirrors = yield* Mirrors;
    const delivery = yield* makeGraphDelivery;
    const machine = yield* Effect.context<GraphServices | GraphStore | MachineStore>();
    const graphFor = (projectId: number) =>
      Effect.flatMap(pool.resolve({ projectId }), (served) => Effect.as(served.fresh(), served.context));
    const graphAt = (origin: GraphOrigin) =>
      Effect.flatMap(pool.resolve({ projectId: origin.projectId, cwd: origin.root }), (served) => Effect.as(served.fresh(), served));
    return Context.make(ThreadGraphs, { graph: machine, graphFor, graphAt }).pipe(
      Context.add(GraphSyncing, graphSyncOf(pool)),
      Context.add(CheckPreparation, pool.mergeFormat),
      Context.add(WorktreeHeld, {
        held: () => new Set(pool.held().map((copy) => copy.checkout)),
        moved: (listener) => pool.copies.subscribe((event) => listener(event.projectId)),
      }),
      Context.add(GraphChanging, (projectId, at) => pool.graphChanges({ projectId, ...at })),
      Context.add(BranchTwinning, { twins: pool.followBranch }),
      Context.add(WorktreeDeparture, { departed: mirrors.departed }),
      Context.add(GraphDelivering, delivery),
      Context.add(OperationChecks, operationChecks(yield* RuleChecks)),
    );
  }),
);

const machineServed = graphBindings.pipe(Layer.provideMerge(judged));

const asking = Layer.merge(compactionAsksLayer, askSettingsLayer).pipe(
  Layer.provideMerge(modelAsksLayer.pipe(Layer.provide(defaultSelectionLayer))),
);

const stores = (assembly: Assembly) =>
  threads.lifetimes.installation.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        asking,
        worldPreferences,
        assignments,
        targetSnapshots,
        heldPathCounts,
        Layer.succeed(BuiltinNotes, { notes: assembly.notes }),
        Layer.effect(
          HomeFollowers,
          Effect.map(
            Effect.promise(() => Promise.all(assembly.homeFollowers.map((follower) => follower.load()))),
            (all) => ({ all }),
          ),
        ),
      ),
    ),
    Layer.provideMerge(machineServed),
  );

const worktreeOwners = (assembly: Assembly) =>
  worktrees.lifetimes.workspace.pipe(
    Layer.provideMerge(
      Layer.mergeAll(setupCommands, rootEndings, setupStateLayer, BunPath.layer, Layer.succeed(CheckDriver, graphDriver)).pipe(
        Layer.provideMerge(stores(assembly)),
      ),
    ),
  );

const doctrineFacts = (facts: Assembly['facts']) =>
  Layer.effect(
    DoctrineFacts,
    Effect.map(Git, (git) => ({
      read: (ids: readonly string[], checkout: FactCheckout) =>
        Effect.map(
          Effect.forEach(
            facts.filter((fact) => ids.includes(fact.id)),
            (fact) => Effect.map(Effect.provideService(fact.read(checkout), Git, git), (value) => [fact.id, value] as const),
          ),
          Object.fromEntries,
        ),
    })),
  );

const capabilityOffers = (capabilities: Assembly['capabilities']) =>
  Layer.merge(
    Layer.effect(CapabilityOffers, Effect.map(OperationCatalog, invocationAssembly.nativeOffers)),
    Layer.succeed(DeclaredCapabilities, capabilities),
  );

const nativeKernel = (assembly: Assembly) =>
  nativeHarness.lifetimes.workspace.pipe(
    Layer.provideMerge(
      Layer.mergeAll(setupReadings, doctrineFacts(assembly.facts), capabilityOffers(assembly.capabilities)).pipe(
        Layer.provideMerge(worktreeOwners(assembly)),
      ),
    ),
  );

const translatedOf = (assembly: Assembly) => {
  const teardown = threadTeardownLayer.pipe(Layer.provideMerge(nativeKernel(assembly)));
  const engine = threads.lifetimes.workspace.pipe(Layer.provideMerge(sandboxes.pipe(Layer.provideMerge(teardown))));
  const nativeServing = nativeHarness.lifetimes.serving.pipe(Layer.provideMerge(engine));
  const threadFeeds = threadFeedsLayer.pipe(Layer.provideMerge(nativeServing));
  const threadsServing = threadCopiesLayer.pipe(
    Layer.provideMerge(threads.lifetimes.serving.pipe(Layer.provideMerge(branchTitling.pipe(Layer.provideMerge(threadFeeds))))),
  );
  const externals = externalHarnesses.lifetimes.workspace.pipe(Layer.provideMerge(threadsServing));
  const externalServing = externalHarnesses.lifetimes.serving.pipe(Layer.provideMerge(externals));
  const takeBack = executions.lifetimes.serving.pipe(Layer.provideMerge(externalServing));
  const landed = landing.lifetimes.serving.pipe(Layer.provideMerge(takeBack));
  const notified = notify.lifetimes.serving.pipe(Layer.provideMerge(outcomes), Layer.provideMerge(landed));
  const waited = mcp.lifetimes.serving.pipe(Layer.provideMerge(notified));
  const pushed = push.lifetimes.serving.pipe(Layer.provideMerge(waited));
  const scheduled = schedule.lifetimes.serving.pipe(Layer.provideMerge(ticks), Layer.provideMerge(buildSteps), Layer.provideMerge(pushed));
  return translations.lifetimes.serving.pipe(Layer.provideMerge(scheduled));
};

const renames = Layer.effect(
  Renames,
  Effect.map(ChangeRecord, (record) => ({ movedTo: record.movedTo })),
);

const scratchFolders = Layer.effect(
  ScratchFolders,
  Effect.map(ScratchAreas, (areas) => ({
    of: (threadId: string) =>
      Effect.try({
        try: () => areas.directory(threadId),
        catch: (cause) => new GateRefusal('files', cause instanceof Error ? cause.message : String(cause), ['name a thread by its id']),
      }),
  })),
);

export const servingOf = (assembly: Assembly) => {
  const filed = checkoutFiles.lifetimes.serving.pipe(
    Layer.provide(Layer.mergeAll(Layer.succeed(RipgrepBinary, ripgrepBinary), renames)),
    Layer.provideMerge(scratchFolders),
    Layer.provideMerge(translatedOf(assembly)),
  );
  const navigated = navigationServing.pipe(Layer.provideMerge(filed));
  return nativeDoor.pipe(Layer.provideMerge(navigated));
};

export type Serving = ReturnType<typeof servingOf>;
