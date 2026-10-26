import { pathToFileURL } from 'node:url';
import { Context, Effect } from 'effect';
import type { RuleChecks } from '../contract/service/ruleChecks.js';
import { Remeasure } from '../contract/service/remeasure.js';
import { checkChange, checkHead, checkTargets } from '../judging/check.js';
import { GateMemory, gateMemoryAt } from '../judging/gateMemory.js';
import { type JudgeGraph, type JudgeServices, judgingOver } from '../judging/judge.js';
import { type CommitRoad, ruleChecks, triggerIndex } from '../judging/ruleChecks.js';
import { CommitQueue } from '../commits/queue.js';
import { remeasures } from '../remeasure/driver.js';
import { makeBackground } from '../../platform/background.js';
import type { LandingJournal } from '../contract/service/remeasure.js';
import { landingJournal } from '../remeasure/journal.js';
import { type RefusalRecord, refusalRecord } from '../refusals/record.js';
import { chosenRules, remeasureRule, traceEscapes } from '../remeasure/rule.js';
import { applyEnforcement, planEnforcement } from '../rules/enforce.js';
import { applyModules, planModules } from '../rules/modules.js';
import { currentEnforcementRevision } from '../rules/revision.js';
import { InspectionFailed, Inspections, inspections, pool } from '../workers/inspectionLanes.js';
import { QUIET_CHECKOUTS, QUIET_DRIVER } from './doubles.js';
import { CheckoutRows } from '../../workspace/contract/service/checkouts.js';
import { Coverage } from '../../workspace/contract/service/roots.js';
import { fixedCoverage } from '../../workspace/testing/doubles.js';
import { ProjectRootsUnavailable } from '../../workspace/contract/wire/coverage.js';

export type Lanes = Inspections['Service'];

export type Closable = Lanes & { readonly close: () => void };

export type QuietServices = Inspections | GateMemory | Remeasure;

export type Graphing = JudgeGraph;

export type Triggers = ReturnType<typeof triggerIndex>;

export const workerLanes = (code?: string): Closable => inspections(code === undefined ? {} : { code });

export const dyingLanes = (entry: string): Closable => {
  const held = pool(pathToFileURL(entry), ['dying worker']);
  return {
    judge: (ask) => held.ask({ ...ask, kind: 'judge' }),
    reach: (ask) => held.ask({ ...ask, kind: 'reach' }),
    packs: () => Effect.fail(new InspectionFailed({ cause: 'worker', reason: 'the worker dies' })),
    facts: () => Effect.fail(new InspectionFailed({ cause: 'worker', reason: 'the worker dies' })),
    history: () => Effect.fail(new InspectionFailed({ cause: 'worker', reason: 'the worker dies' })),
    close: held.close,
  };
};

export const quiet = (
  faces: Lanes,
  options: { readonly kept?: string | null; readonly driver?: Remeasure['Service'] } = {},
): Context.Context<QuietServices> =>
  Context.make(Inspections, faces).pipe(
    Context.add(GateMemory, gateMemoryAt(options.kept ?? null)),
    Context.add(Remeasure, options.driver ?? QUIET_DRIVER),
  );

export const withLanes = <R>(context: Context.Context<R>, faces: Lanes): Context.Context<R | Inspections> =>
  Context.merge(context, Context.make(Inspections, faces));

export const triggersOver = (graphOf: Graphing): Triggers => triggerIndex(graphOf);

export const checksOver = (options: {
  readonly graphOf: Graphing;
  readonly triggers?: Triggers;
  readonly kept?: string;
  readonly driver?: Remeasure['Service'];
  readonly refusals?: RefusalRecord;
  readonly commits?: CommitRoad;
}): RuleChecks['Service'] =>
  ruleChecks({
    graphOf: options.graphOf,
    triggers: options.triggers ?? triggerIndex(options.graphOf),
    memory: options.kept === undefined ? undefined : gateMemoryAt(options.kept),
    driver: options.driver,
    refusals: options.refusals,
    commits: options.commits,
  });

export const unqueued = CommitQueue.of({
  admit: () => Effect.die('the commit queue is not reached by this check'),
  close: () => Effect.die('the commit queue is not reached by this check'),
  reopen: () => Effect.die('the commit queue is not reached by this check'),
  drained: () => Effect.die('the commit queue is not reached by this check'),
});

export const refusalsOver = (...input: Parameters<typeof refusalRecord>) => refusalRecord(...input);

export const judgedOver = (graphOf: Graphing) => judgingOver(graphOf);

export const checksIn = Effect.map(Effect.context<JudgeServices>(), (context) => checksOver({ graphOf: () => Effect.succeed(context) }));

export const checksKeeping = (refusals: RefusalRecord) =>
  Effect.map(Effect.context<JudgeServices>(), (context) => checksOver({ graphOf: () => Effect.succeed(context), refusals }));

export const driverOver = (options: {
  readonly graphOf: Parameters<typeof remeasures>[0]['graphOf'];
  readonly open?: Parameters<typeof remeasures>[0]['open'];
  readonly start?: Effect.Effect<void>;
  readonly memory?: string | null;
  readonly forget?: (projectId: number) => void;
  readonly delayMs?: number;
  readonly journal?: LandingJournal;
  readonly checkouts?: CheckoutRows['Service'];
  readonly coverage?: Coverage['Service'];
}) =>
  Effect.flatMap(makeBackground, (background) =>
    remeasures({
      graphOf: options.graphOf,
      open: options.open ?? ((_projectId, root) => Effect.succeed(root)),
      memory: options.memory ?? null,
      start: options.start ?? Effect.void,
      forget: options.forget ?? (() => undefined),
      delayMs: options.delayMs,
      journal: options.journal,
      background,
    }).pipe(
      Effect.tap(({ drive: remeasuring }) => remeasuring),
      Effect.map(({ remeasure }) => remeasure),
      Effect.provideService(CheckoutRows, options.checkouts ?? QUIET_CHECKOUTS),
      Effect.provideService(
        Coverage,
        options.coverage ?? {
          ...fixedCoverage(0, []),
          covered: (projectId) =>
            Effect.fail(
              new ProjectRootsUnavailable({
                projectId,
                reason: 'unestablished',
                message: 'this driver fixture declares no checkout coverage',
              }),
            ),
        },
      ),
    ),
  );

export const journalOver = (...input: Parameters<typeof landingJournal>) => landingJournal(...input);

export const targetsOf = (ask: Parameters<typeof checkTargets>[0], version: Parameters<typeof checkTargets>[1]) =>
  checkTargets(ask, version);

export const headChecked = (
  ask: Parameters<typeof checkHead>[0],
  targets: Parameters<typeof checkHead>[1],
  at: Parameters<typeof checkHead>[2],
) => checkHead(ask, targets, at);

export const changeChecked = (
  ask: Parameters<typeof checkChange>[0],
  targets: Parameters<typeof checkChange>[1],
  change: Parameters<typeof checkChange>[2],
) => checkChange(ask, targets, change);

export const rulesChosen = (projectId: Parameters<typeof chosenRules>[0], aim: Parameters<typeof chosenRules>[1]) =>
  chosenRules(projectId, aim);

export const ruleRemeasured = (projectId: Parameters<typeof remeasureRule>[0], rule: Parameters<typeof remeasureRule>[1]) =>
  Effect.flatMap(remeasureRule(projectId, rule, []), (measured) =>
    measured._tag !== 'Measured' || measured.tracing === undefined
      ? Effect.succeed(measured)
      : Effect.map(traceEscapes(projectId, measured.tracing), (traced) =>
          traced._tag === 'Measured' ? { ...measured, escaped: [...measured.escaped, ...traced.escaped], tracing: undefined } : traced,
        ),
  );

export const enforcementBaseOf = (row: Parameters<typeof currentEnforcementRevision>[0]) => currentEnforcementRevision(row);

export const modulesDrawn = (input: Parameters<typeof planModules>[0]) => Effect.flatMap(planModules(input), applyModules);

export const enforcementApplied = (row: Parameters<typeof planEnforcement>[0], ask: Parameters<typeof planEnforcement>[1]) =>
  Effect.flatMap(planEnforcement(row, ask), applyEnforcement);
