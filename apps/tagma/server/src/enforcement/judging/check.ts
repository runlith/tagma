import { type Unjudged } from '@tagma/inspection/verdict';
import { Effect, Result, Semaphore } from 'effect';
import type { BlockRecord, BlockRow } from '../../graph/contract/service/acts.js';
import { measuredRoot } from '../../graph/contract/service/serving.js';
import { Projects } from '../../projects/contract/service/registry.js';
import {
  type CheckedViolation,
  crossingOf,
  inspectionBase,
  inspectionRelevant,
  type LandingUnjudged,
  type RuleRun,
} from '../contract/wire/enforcement.js';
import type { Norm } from '../contract/wire/findings.js';
import { hasTrigger } from '../../graph/contract/wire/enforcement.js';
import type { Assembled } from '@tagma/inspection/builtins';
import { type CountedDebt, isProgrammed, isUnrun, type Programmed, unrunReason } from '../contract/wire/document.js';
import type { ConfigVersion } from '../../config/contract/service/configs.js';
import { inspectionAt } from '../rules/descriptions.js';
import { blockAddress, blockName } from '../../graph/contract/wire/references.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { TreeSubject } from '../contract/wire/checks.js';
import type { TerminalActor } from '../../executions/contract/wire/terminals.js';
import { type InspectionFailed, Inspections, RULES_AT_ONCE } from '../workers/inspectionLanes.js';
import { headOf, indexViolations, reachRefusal } from '../rules/measure.js';
import { changedKeys, measureRules } from './descriptionChanges.js';
import { judgedDebt } from '../rules/held.js';
import { type BoundRule } from '../programs/bindings.js';
import { attributed, evidenceOf } from './excess.js';
import { againstParents, type Bound, boundOf, type Merging, mergingOf, type Reading, UNBOUND } from './merged.js';
import { covers, enforcedRules, moduleMapOf, reachOf, within } from '../rules/reach.js';

const LANDING = 'submit_work';

type Said = Pick<RuleRun, 'rule' | 'strictness' | 'on'>;

type Target = {
  readonly name: string;
  readonly title: string;
  readonly said: Said;
  readonly gatesLanding: boolean;
  readonly key?: string;
  readonly places: readonly string[];
} & (
  | { readonly inspection: Assembled | Programmed; readonly debt: readonly CountedDebt[] }
  | { readonly inspection: null; readonly failed: string | null; readonly anyPath?: true }
);

export type Targets = { readonly targets: readonly Target[] };

export type RuleCheckInput = {
  readonly projectId: number;
  readonly caller: TerminalActor | null;
  readonly rules: 'all' | readonly string[];
  readonly inspection?: string;
  readonly row?: BlockRow;
  readonly root?: string;
};

export type Checking = {
  readonly head: string;
  readonly counts: ReadonlyMap<string, ReadonlyMap<string, number>>;
  readonly violations: readonly CheckedViolation[];
  readonly fingerprints: readonly string[];
  readonly unjudged: readonly LandingUnjudged[];
  readonly rules: readonly RuleRun[];
  readonly refuses?: boolean;
};

const naming = (rule: BlockRecord) => {
  const hex = rule.uuid.replaceAll('-', '').toLowerCase();
  return (asked: string) => {
    const address = blockAddress(asked);
    return (address.projectId === null || address.projectId === rule.projectId) && hex.endsWith(address.name.toLowerCase());
  };
};

export const checkTargets = Effect.fn('enforcement.checkTargets')(function* (ask: RuleCheckInput, version: ConfigVersion) {
  if (ask.inspection !== undefined) {
    const inspection = yield* inspectionAt(version, ask.inspection, yield* moduleMapOf(ask.projectId));
    const base = inspectionBase(inspection);
    const places = ask.row === undefined ? within([''], base) : yield* reachOf(ask.row, base);
    const name = ask.row === undefined ? '' : blockName(ask.row.uuid);
    if (places.length === 0) return yield* reachRefusal(name === '' ? 'the project' : name, base);
    const title = `inspection ${ask.inspection}`;
    const targets: readonly Target[] = [
      isUnrun(inspection)
        ? { name, title, said: { rule: name }, gatesLanding: false, places, inspection: null, failed: inspection.unrun }
        : { name, title, said: { rule: name }, gatesLanding: false, places, inspection, debt: [] },
    ];
    return { targets } satisfies Targets;
  }
  const asked = ask.rules === 'all' ? null : ask.rules;
  const known = new Set<string>();
  const targets: Target[] = [];
  const asking = (rule: BlockRecord): boolean => {
    const matched = asked === null ? [] : asked.filter(naming(rule));
    for (const one of matched) known.add(one);
    return asked === null || matched.length > 0;
  };
  const enforced = yield* enforcedRules(ask.projectId, version);
  for (const entry of enforced) {
    if (!asking(entry.rule)) continue;
    const name = blockName(entry.rule.uuid);
    const title = entry.rule.title;
    if (entry.document === null) {
      targets.push({
        name,
        title,
        said: { rule: name },
        gatesLanding: true,
        places: yield* entry.reach(''),
        inspection: null,
        failed: entry.unreadable.reason,
      });
      continue;
    }
    const { check: inspection, strictness, on, debt } = entry.document;
    const said = { rule: name, strictness, on };
    const gatesLanding = strictness === 'gate' && hasTrigger(on, LANDING, 'before');
    const places = yield* entry.reach(inspectionBase(inspection));
    targets.push(
      isUnrun(inspection)
        ? {
            name,
            title,
            said,
            gatesLanding,
            key: entry.document.inspection,
            places,
            inspection: null,
            failed: unrunReason(entry.document.inspection, inspection),
            anyPath: inspection.undeclared,
          }
        : { name, title, said, gatesLanding, key: entry.document.inspection, places, inspection, debt },
    );
  }
  const unknown = (asked ?? []).filter((one) => !known.has(one));
  if (unknown.length > 0) {
    return yield* new GateRefusal('not-enforced', `no enforced rule of this graph answers ${unknown.join(', ')}`, [
      'read_enforcement lists the enforced rules; name one as a read printed it',
    ]);
  }
  return { targets } satisfies Targets;
});

type Collected = {
  readonly counts: Map<string, ReadonlyMap<string, number>>;
  readonly violations: CheckedViolation[];
  readonly unjudged: LandingUnjudged[];
  readonly rules: RuleRun[];
};

const collecting = (): Collected => ({ counts: new Map(), violations: [], unjudged: [], rules: [] });

const settled = (head: string, collected: Collected, refuses?: boolean): Checking => ({
  head,
  counts: collected.counts,
  violations: collected.violations,
  fingerprints: [...new Set(collected.violations.map((one) => one.fingerprint))].sort(),
  unjudged: collected.unjudged,
  rules: collected.rules,
  refuses,
});

const normOf = (target: Target): Norm => ({ rule: target.name, title: target.title, strictness: target.said.strictness });

const tagged = (rule: string, unjudged: readonly Unjudged[]): LandingUnjudged[] => unjudged.map((one) => ({ rule, ...one }));

const failedOf = (failure: InspectionFailed): string => `(${failure.cause}) ${failure.reason}`;

export const checkHead = Effect.fn('enforcement.checkHead')(function* (
  ask: RuleCheckInput,
  { targets }: Targets,
  { root, head }: { readonly root: string; readonly head: string },
) {
  const collected = collecting();
  const readings = yield* measureRules(
    { projectId: ask.projectId, root, tree: head, actor: ask.caller ?? { _tag: 'Operator' } },
    targets.flatMap((target) =>
      target.inspection !== null && target.places.length > 0
        ? [{ norm: normOf(target), inspection: target.inspection, places: target.places, debt: target.debt }]
        : [],
    ),
    ask.caller,
  );
  for (const target of targets) {
    if (target.inspection === null) {
      collected.rules.push({ ...target.said, ms: 0, reached: false, failed: target.failed ?? undefined });
      continue;
    }
    if (target.places.length === 0) {
      collected.rules.push({ ...target.said, ms: 0, reached: false });
      continue;
    }
    const { answer, ms } = readings.get(target.name)!;
    if (Result.isFailure(answer)) {
      collected.rules.push({ ...target.said, ms, reached: true, failed: failedOf(answer.failure) });
      continue;
    }
    collected.rules.push({ ...target.said, ms, reached: true });
    collected.unjudged.push(...answer.success.unjudged);
    collected.violations.push(...answer.success.violations);
    collected.counts.set(target.name, answer.success.counts);
  }
  return settled(head, collected);
});

export const checkChange = Effect.fn('enforcement.checkChange')(function* (ask: RuleCheckInput, { targets }: Targets, change: TreeSubject) {
  const inspections = yield* Inspections;
  const collected = collecting();
  const evidence = evidenceOf(change.root, change.base, change.built);
  const version = {
    projectId: ask.projectId,
    root: change.root,
    tree: change.built,
    commonDir: change.commonDir,
    actor: ask.caller ?? { _tag: 'Operator' as const },
  };
  const keys = yield* changedKeys(
    version,
    change.base,
    change.paths,
    targets.flatMap((target) => (target.key === undefined ? [] : [target.key])),
  );
  const rechecked = targets.filter((target) => target.key !== undefined && keys.has(target.key));
  const full = yield* checkHead(ask, { targets: rechecked }, { root: change.root, head: change.built });
  collected.violations.push(...full.violations);
  collected.unjudged.push(...full.unjudged);
  for (const [rule, counts] of full.counts) collected.counts.set(rule, counts);
  const fullRuns = new Map(full.rules.map((run) => [run.rule, run]));
  const locationOf = (one: CheckedViolation) => JSON.stringify([one.rule, one.fingerprint, one.file, one.line]);
  const locations = new Map(collected.violations.map((one, at) => [locationOf(one), at]));
  let refuses = rechecked.some((target) => target.gatesLanding && fullRuns.get(target.name)?.failed !== undefined);
  const running = Effect.gen(function* () {
    const binding = { ...change, caller: ask.caller, lane: 'landing' as const };
    const boundRules = targets.flatMap((target): BoundRule[] =>
      target.inspection !== null &&
      isProgrammed(target.inspection) &&
      change.paths.some((path) => covers(target.places)(path) || inspectionRelevant(target.inspection!, path))
        ? [{ rule: target.name, inspection: target.inspection, places: target.places, debt: target.debt }]
        : [],
    );
    const merging = yield* mergingOf(
      change,
      targets.some((target) => target.inspection !== null && target.debt.length > 0),
    );
    const touchedBy = (target: Targets['targets'][number], changed: readonly string[]): readonly string[] => {
      const inside = covers(target.places);
      const judged = target.inspection;
      return changed.filter((path) => inside(path) || (judged !== null && inspectionRelevant(judged, path)));
    };
    const pathsOf = (target: Targets['targets'][number]): readonly string[] => touchedBy(target, change.paths);
    const answering = (parents: Merging, bound: Bound) => (target: Targets['targets'][number]) => {
      const paths = pathsOf(target);
      const { inspection } = target;
      if (inspection === null || paths.length === 0) return Effect.succeed(undefined);
      const asked = againstParents(
        parents,
        { base: change.base, paths, evidence },
        bound,
        (base, judged, readings, debt) =>
          isProgrammed(inspection)
            ? Effect.fromResult(readings.get(target.name)!.answer)
            : inspections.judge({
                lane: 'landing',
                root: change.root,
                base,
                built: change.built,
                paths: judged,
                places: target.places,
                inspection,
                debt: judgedDebt(debt),
                job: change.job,
              }),
        (changed) => touchedBy(target, changed),
        target.debt,
      );
      const attributing = Effect.flatMap(asked, (reading) =>
        Effect.map(attributed(change, evidence, reading.verdict), (rows) => ({
          rows,
          unjudged: reading.verdict.unjudged,
          counts: indexViolations(reading.verdict.violations).counts,
        })),
      );
      const timed = Effect.suspend(() => {
        const started = performance.now();
        return Effect.map(Effect.result(attributing), (answer) => ({
          answer,
          ms: (bound.ms.get(target.name) ?? 0) + Math.round(performance.now() - started),
        }));
      });
      return timed.pipe(
        Effect.withSpan('enforcement.rule', {
          attributes: {
            'enforcement.rule': target.name,
            'inspection.builtin': isProgrammed(inspection) ? 'bindings' : inspection.builtin,
            files: paths.length,
          },
        }),
      );
    };
    const runsProgram = (target: Targets['targets'][number]) => target.inspection !== null && isProgrammed(target.inspection);
    const programTargets = targets.filter(runsProgram);
    const builtinTargets = targets.filter((target) => !runsProgram(target));
    const [settledBindings, builtinAnswers] = yield* Effect.all(
      [boundOf(binding, boundRules, merging), Effect.forEach(builtinTargets, answering(merging, UNBOUND), { concurrency: RULES_AT_ONCE })],
      { concurrency: 2 },
    );
    const programAnswers = yield* Effect.forEach(programTargets, answering(settledBindings.merging, settledBindings.bound), {
      concurrency: RULES_AT_ONCE,
    });
    const answers = new Map([
      ...builtinTargets.map((target, at) => [target, builtinAnswers[at]] as const),
      ...programTargets.map((target, at) => [target, programAnswers[at]] as const),
    ]);
    for (const target of targets) {
      const paths = pathsOf(target);
      const { inspection } = target;
      if (inspection === null) {
        if (target.failed === null) {
          collected.rules.push({ ...target.said, ms: 0, reached: false });
          continue;
        }
        const reached =
          paths.length > 0 || fullRuns.has(target.name) || ('anyPath' in target && target.anyPath === true && change.paths.length > 0);
        collected.rules.push({ ...target.said, ms: 0, reached, failed: target.failed });
        if (reached && target.gatesLanding) refuses = true;
        continue;
      }
      const judged = answers.get(target);
      const fullRun = fullRuns.get(target.name);
      if (judged === undefined) {
        collected.rules.push(fullRun ?? { ...target.said, ms: 0, reached: false });
        continue;
      }
      const { answer } = judged;
      const ms = judged.ms + (fullRun?.ms ?? 0);
      if (Result.isFailure(answer)) {
        collected.rules.push({ ...target.said, ms, reached: true, failed: failedOf(answer.failure) });
        if (target.gatesLanding) refuses = true;
        continue;
      }
      collected.rules.push({ ...target.said, ms, reached: true, failed: fullRun?.failed });
      const { rows, unjudged, counts } = answer.success;
      if (fullRun === undefined) collected.counts.set(target.name, counts);
      collected.unjudged.push(...tagged(target.name, unjudged));
      const norm = normOf(target);
      for (const { violation, holders, withheld } of rows) {
        if (holders.length === 0 && target.gatesLanding) refuses = true;
        const crossing = {
          ...crossingOf(norm, inspection, violation, withheld),
          holders: holders.length === 0 ? undefined : holders,
        };
        const at = locations.get(locationOf(crossing));
        if (at === undefined) collected.violations.push(crossing);
        else collected.violations[at] = crossing;
      }
    }
  });
  yield* running;
  return settled(change.base, collected, refuses);
});
