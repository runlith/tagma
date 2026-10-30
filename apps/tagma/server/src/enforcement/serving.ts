import { rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Cause, Context, Effect, FiberSet, FileSystem, Layer, Option, Result } from 'effect';
import { WorkDebt } from '../graph/contract/service/workDebt.js';
import { ProjectLaw } from '../graph/contract/service/law.js';
import { endingDebt } from './rules/ending.js';
import { lawReading } from './rules/projectLaw.js';
import { Git } from '@runlith/git/Git';
import type { GraphJournal } from '../graph/contract/service/journal.js';
import { ServedGraphs } from '../graph/contract/service/serving.js';
import { ActState } from '../graph/contract/service/transaction.js';
import { journalRevision } from '../graph/journal/eventLog.js';
import { dataPathOf, type GraphStore, MachineStore } from '../platform/contract/service/store.js';
import { Maintenance } from '../platform/contract/service/maintenance.js';
import { Background } from '../platform/contract/service/background.js';
import { RootPublished } from '../workspace/contract/service/roots.js';
import { placeAt } from '../projects/identity.js';
import { ProjectChanges } from '../projects/contract/service/changes.js';
import { ProjectIdentification, Projects } from '../projects/contract/service/registry.js';
import { CommitGateCli, CommitHooks, commitHooks, NO_COMMIT_HOOKS } from './commits/hooks.js';
import { CommitQueue, commitQueue } from './commits/queue.js';
import { CommitRecords } from './contract/service/commitRecords.js';
import { RuleJudgement } from './contract/service/judge.js';
import { RuleChecks } from './contract/service/ruleChecks.js';
import { RuleRevision } from './contract/service/ruleRevision.js';
import { GateMemory, gateMemoryAt } from './judging/gateMemory.js';
import type { JudgeServices } from './judging/judge.js';
import { ruleChecks, triggerIndex } from './judging/ruleChecks.js';
import { type RemeasureGraph, type RemeasureServices, remeasures } from './remeasure/driver.js';
import { landingJournal } from './remeasure/journal.js';
import { refusalRecord } from './refusals/record.js';
import { MachineUnits } from '../platform/contract/service/units.js';
import { Remeasure } from './contract/service/remeasure.js';
import { drive } from '../platform/contract/service/drives.js';
import { ProgramRoad } from '../executions/contract/service/programs.js';
import { Inspections } from './workers/inspectionLanes.js';
import { Configs } from '../config/contract/service/configs.js';
import { GateRefusal } from '../platform/contract/wire/refusal.js';

export type InspectionsInstalled = Inspections;

export type JudgingServices =
  | Inspections
  | RuleChecks
  | CommitRecords
  | RuleJudgement
  | GateMemory
  | Remeasure
  | CommitQueue
  | CommitHooks
  | WorkDebt
  | ProjectLaw;

type ServedMachine = Context.Context<
  | Exclude<JudgeServices | RemeasureServices, Inspections | ProgramRoad | Configs>
  | GraphStore
  | GraphJournal
  | Projects
  | ProjectIdentification
  | ProjectChanges
>;

export const enforcementServingLayer = Layer.effectContext(
  Effect.gen(function* () {
    const store = yield* MachineStore;
    const served = yield* ServedGraphs;
    const maintenance = yield* Maintenance;
    const machineGraph: ServedMachine = yield* Effect.context<
      | Exclude<JudgeServices | RemeasureServices, Inspections | ProgramRoad | Configs>
      | GraphStore
      | GraphJournal
      | Projects
      | ProjectIdentification
      | ProjectChanges
    >();
    const git = yield* Git;
    const commitGate = Option.getOrUndefined(yield* Effect.serviceOption(CommitGateCli));
    const data = dataPathOf(store.path);
    const inMemory = data === null;
    const home = data === null ? null : join(data, 'enforcement');
    if (home !== null)
      yield* Effect.promise(() =>
        Promise.all(['adopted', 'checkers', 'trees'].map((left) => rm(join(home, left), { recursive: true, force: true }))),
      );
    const inspections = Context.make(Inspections, yield* Inspections).pipe(
      Context.add(ProgramRoad, yield* ProgramRoad),
      Context.add(Configs, yield* Configs),
    );

    const revisionOf = (context: Context.Context<GraphStore | GraphJournal>) =>
      RuleRevision.of({
        current: (projectId) =>
          Effect.flatMap(Effect.serviceOption(ActState), (active) =>
            Option.isSome(active) ? Effect.succeed(null) : Effect.provide(journalRevision(projectId), context),
          ),
      });
    const judgedBy = (freshened: boolean) => (projectId: number, cwd: string | null) =>
      inMemory
        ? Effect.succeed(Context.add(Context.merge(machineGraph, inspections), RuleRevision, revisionOf(machineGraph)))
        : served.resolve(cwd === null ? { projectId } : { projectId, cwd }).pipe(
            Effect.tap((graph) => (freshened ? graph.fresh() : Effect.void)),
            Effect.map((graph) =>
              Context.add(
                Context.add(Context.merge(graph.context, inspections), MachineStore, store),
                RuleRevision,
                revisionOf(graph.context),
              ),
            ),
          );
    const servedAt = judgedBy(true);
    const standing = judgedBy(false);
    const remeasureAt: RemeasureGraph = (projectId, root) =>
      inMemory
        ? servedAt(projectId, root)
        : Effect.gen(function* () {
            const checkout = root ?? (yield* Context.get(machineGraph, Projects).byId(projectId)).rootPath;
            const graph = yield* served.holdServed({ projectId, checkout });
            if (graph === null)
              return yield* new GateRefusal('not-served', `the graph copy of ${checkout} is closed`, [
                'open the graph copy to resume its re-measurement',
              ]);
            yield* graph.fresh();
            return Context.add(
              Context.add(Context.merge(graph.context, inspections), MachineStore, store),
              RuleRevision,
              revisionOf(graph.context),
            );
          });
    const triggers = triggerIndex(standing);
    const gates = gateMemoryAt(home === null ? null : join(home, 'gated.json'));
    const units = yield* MachineUnits;
    const { remeasure: remeasured, drive: remeasuring } = yield* remeasures({
      graphOf: remeasureAt,
      open: (projectId, root) =>
        inMemory ? Effect.succeed(root) : Effect.map(served.resolve({ projectId, cwd: root }), (graph) => graph.checkout),
      memory: home === null ? null : join(home, 'remeasured.json'),
      start: maintenance.opened,
      forget: triggers.forget,
      journal: landingJournal(store.db, units),
      background: yield* Background,
    });
    const projects = Context.get(machineGraph, Projects);
    const projectAt = (root: string) =>
      Effect.map(
        Effect.flatMap(placeAt(root), (here) => projects.resolve(undefined, here)),
        (row) => row?.id ?? null,
      ).pipe(Effect.provideService(ProjectIdentification, Context.get(machineGraph, ProjectIdentification)));
    const queue = yield* commitQueue({
      path: home === null ? null : join(home, 'commits.jsonl'),
      judge: (queued) => Effect.suspend(() => checks.record(queued)),
    });
    const checks = ruleChecks({
      graphOf: servedAt,
      triggers,
      standing,
      commits: { git, projectAt, queue },
      memory: gates,
      driver: remeasured,
      refusals: refusalRecord(store.db, units),
    });
    const fork = yield* FiberSet.makeRuntime<never, void, never>();
    const hooks =
      commitGate === undefined
        ? NO_COMMIT_HOOKS
        : commitHooks(git, commitGate, maintenance, (effect) => {
            fork(effect);
          });
    yield* Effect.acquireRelease(
      Effect.sync(() =>
        served.copies.subscribe(({ kind, projectId, checkout }) => {
          if (kind !== 'opened') remeasured.closed(projectId, checkout);
        }),
      ),
      (unsubscribe) => Effect.sync(unsubscribe),
    );
    yield* drive(
      'remeasure',
      Effect.andThen(
        Effect.acquireRelease(
          Effect.sync(() =>
            served.copies.subscribe(({ kind, projectId, checkout }) => {
              if (kind === 'opened') remeasured.opened(projectId, checkout);
            }),
          ),
          (unsubscribe) => Effect.sync(unsubscribe),
        ),
        remeasuring,
      ),
    );
    if (commitGate !== undefined)
      yield* drive(
        'commit-hooks',
        maintenance.opened.pipe(
          Effect.andThen(projects.list()),
          Effect.flatMap((rows) => hooks.sweep(rows.flatMap((row) => (row.kind === 'folder' ? [row.rootPath] : [])))),
          Effect.tapCause((cause) =>
            Effect.logWarning('the commit gate could not be carried into the registered checkouts', { cause: Cause.pretty(cause) }),
          ),
        ),
      );
    const files = yield* FileSystem.FileSystem;
    const workDebt = WorkDebt.of({
      remaining: Effect.fn('WorkDebt.remaining')(function* (input) {
        const read = yield* Effect.result(
          Effect.flatMap(standing(input.projectId, input.root), (context) =>
            Effect.provide(endingDebt(input), Context.add(context, FileSystem.FileSystem, files)),
          ),
        );
        return Result.isSuccess(read) ? read.success : { debtUnreadable: [read.failure.message] };
      }),
    });
    const projectLaw = ProjectLaw.of({
      read: (at) => lawReading(at).pipe(Effect.provide(Context.add(inspections, Git, git))),
    });
    const context = Context.add(inspections, RuleChecks, checks).pipe(
      Context.add(WorkDebt, workDebt),
      Context.add(ProjectLaw, projectLaw),
      Context.add(CommitRecords, checks),
      Context.add(RuleJudgement, yield* RuleJudgement),
      Context.add(GateMemory, gates),
      Context.add(Remeasure, remeasured),
      Context.add(CommitQueue, queue),
      Context.add(CommitHooks, hooks),
      Context.add(RootPublished, { published: (root: { readonly path: string }) => hooks.install(root.path) }),
    );
    return context;
  }),
);
