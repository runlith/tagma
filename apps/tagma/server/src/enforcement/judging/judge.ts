import { newViolations, siteRows } from '@tagma/inspection/verdict';
import { Context, Effect, Layer, Result, Semaphore } from 'effect';
import { RuleJudgement } from '../contract/service/judge.js';
import { Projects } from '../../projects/contract/service/registry.js';
import {
  bodiesOf,
  crossingOf,
  inspectionBase,
  inspectionRelevant,
  type LandingUnjudged,
  type RuleCrossing,
  type RuleRun,
  type Watched,
} from '../contract/wire/enforcement.js';
import type { LawEnforcement, TriggerPhase } from '../../graph/contract/wire/enforcement.js';
import {
  type Descriptions,
  isProgrammed,
  isUnrun,
  type Law,
  MAP_RECOVERY,
  type MapReading,
  readLaw,
  unrunReason,
} from '../contract/wire/document.js';
import type { ConfigVersion } from '../../config/contract/service/configs.js';
import { descriptionsAt } from '../rules/descriptions.js';
import { changedKeys, measureRules } from './descriptionChanges.js';
import { blockName } from '../../graph/contract/wire/references.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { type Checked, type HeadSubject, type JudgedTree, type TreeSubject, UNCHECKED } from '../contract/wire/checks.js';
import type { TerminalActor } from '../../executions/contract/wire/terminals.js';
import { Git } from '@runlith/git/Git';
import { type BuiltTree, pathsOf } from './trees.js';
import type { JudgeLane } from '../workers/asks.js';
import { type GateMemory, gatedIn } from './gateMemory.js';
import { Inspections, RULES_AT_ONCE } from '../workers/inspectionLanes.js';
import { againstParents, type Bound, boundOf, type Merging, mergingOf, type Reading, UNBOUND } from './merged.js';
import { headOf, measureAt } from '../rules/measure.js';
import { judgedDebt } from '../rules/held.js';
import { measuredRoot } from '../../graph/contract/service/serving.js';
import { judgeBindings, type BoundRule } from '../programs/bindings.js';
import { covers, enforcedRules, enforcedStatutes, moduleMapOf, runsBefore, afterTriggered, runsOn } from '../rules/reach.js';
import { attributed, evidenceOf, wireOf } from './excess.js';
import { type Failed, failedRefusal, MERGE_OP, type Rule, violatedRefusal } from '../contract/wire/refusals.js';
import type { Act, BlockNames } from '../../graph/contract/service/acts.js';

type Ruled = Rule & { readonly body: string };

type InPlay =
  | (Ruled & { readonly document: Law; readonly paths: readonly string[]; readonly places: readonly string[]; readonly changed: boolean })
  | (Ruled & { readonly document: null; readonly reason: string; readonly ways: readonly string[] });

const findingRules = (...lists: readonly (readonly { readonly rule: string }[])[]): string[] =>
  lists.flatMap((list) => list.map((one) => one.rule));

export const WAYS_OUT: ReadonlySet<string> = new Set([
  'read_block',
  'read_inspections',
  'read_enforcement',
  'read_vocabulary',
  'read_tags',
  'check_rules',
]);

const unrunWays = (name: string, key: string): readonly string[] => [
  `declare the inspection ${key} in tagma.config.ts of this version, so the commit carries what it is judged by`,
  `or move ${name} first: enforce_rule ${name} with an inspection tagma.config.ts at HEAD declares, or with strictness watch or off`,
];

const OPERATOR: TerminalActor = { _tag: 'Operator' };

const versionOf = (
  projectId: number,
  root: string,
  tree: string,
  caller: TerminalActor | undefined,
  commonDir: string | undefined,
): ConfigVersion => ({
  projectId,
  actor: caller ?? OPERATOR,
  root,
  tree,
  commonDir,
});

export type Judgement = Checked & {
  readonly rules: readonly string[];
  readonly inspections: number;
  readonly ms: number;
  readonly programs?: readonly string[];
  readonly readyMs?: number;
};

export type JudgedPhase = TriggerPhase | 'landed';

const laneOf = (op: string): JudgeLane => (op === MERGE_OP ? 'merge' : 'landing');

const triggers = (document: LawEnforcement, op: string, phase: JudgedPhase): boolean =>
  phase === 'before' ? runsBefore(document, op) : phase === 'after' ? afterTriggered(document, op) : runsOn(document, op);

const touching = (document: Law, places: readonly string[], paths: readonly string[]): readonly string[] => {
  const inside = covers(places);
  return paths.filter((path) => inside(path) || inspectionRelevant(document.check, path));
};

const inPlay = Effect.fn('enforcement.inPlay')(function* (op: string, phase: JudgedPhase, subject: TreeSubject) {
  const { projectId, paths } = subject;
  const found: InPlay[] = [];
  const statutes = yield* enforcedStatutes(projectId);
  const changed = yield* changedKeys(
    versionOf(projectId, subject.root, subject.built, subject.caller, subject.commonDir),
    subject.base,
    subject.paths,
    statutes.flatMap((entry) => (entry.document !== null && triggers(entry.document, op, phase) ? [entry.document.inspection] : [])),
  );
  let described: { readonly descriptions: Descriptions; readonly reading: MapReading } | undefined;
  for (const entry of statutes) {
    const rule = { name: blockName(entry.rule.uuid), title: entry.rule.title, body: entry.rule.body };
    if (entry.document === null) {
      if (paths.some(covers(yield* entry.reach(''))))
        found.push({ ...rule, document: null, reason: entry.unreadable.reason, ways: entry.unreadable.unblock });
      continue;
    }
    if (!triggers(entry.document, op, phase)) continue;
    described ??= {
      descriptions: yield* descriptionsAt(versionOf(projectId, subject.root, subject.built, subject.caller, subject.commonDir)),
      reading: yield* moduleMapOf(projectId),
    };
    const document = readLaw(entry.document, described.descriptions, described.reading);
    const places = yield* entry.reach(inspectionBase(document.check));
    const touched = isUnrun(document.check) && document.check.undeclared === true ? paths : touching(document, places, paths);
    const moved = changed.has(document.inspection);
    if (touched.length > 0 || moved) found.push({ ...rule, document, paths: touched, places, changed: moved });
  }
  return { found, gated: gatedIn(statutes) };
});

type Unread = { readonly message: string };

const unread = (op: string, failure: Unread, started: number): Judgement => {
  const again = `read_enforcement says why this project's rules cannot be read; ${op} is judged again once they can`;
  return {
    refused: {
      code: 'inspection-failed',
      reason: `the enforced rules of this project could not be read, so nothing says what a gate would find: ${failure.message}`,
      unblock: failure instanceof GateRefusal ? [...failure.unblock, again] : [again],
    },
    watched: [],
    unjudged: [],
    rules: [],
    inspections: 0,
    ms: Math.round(performance.now() - started),
  };
};

const ungated = (root: string, why: string, started: number): Judgement => ({
  refused: null,
  watched: [],
  unjudged: [{ gate: 'unread', cause: `the graph of ${root} could not be read: ${why}` }],
  rules: [],
  inspections: 0,
  ms: Math.round(performance.now() - started),
});

const verdictOf = (judged: Judgement): string =>
  judged.refused?.code ?? (judged.unjudged.length > 0 ? 'unjudged' : judged.watched.length > 0 ? 'watched' : 'clean');

const annotated = (op: string, files: number, judged: Judgement): Effect.Effect<Judgement> =>
  Effect.as(
    Effect.annotateCurrentSpan({
      'gate.op': op,
      'gate.rules': judged.rules.join(','),
      'gate.inspections': judged.inspections,
      'gate.files': files,
      'gate.ms': judged.ms,
      'gate.verdict': verdictOf(judged),
    }),
    judged,
  );

export const judgement = Effect.fn('enforcement.judgement')(function* (
  op: string,
  subject: TreeSubject,
  memory?: GateMemory['Service'],
  phase: JudgedPhase = 'before',
) {
  const started = performance.now();
  const settled = yield* Effect.result(
    Effect.gen(function* () {
      const read = yield* inPlay(op, phase, subject);
      if (memory !== undefined) yield* memory.remember(subject.projectId, read.gated);
      return read;
    }),
  );
  if (Result.isFailure(settled)) return ungated(subject.root, settled.failure.message, started);
  const rules = settled.success.found;
  const inspections = yield* Inspections;
  const evidence = evidenceOf(subject.root, subject.base, subject.built);
  const crossed: RuleCrossing[] = [];
  const failed: Failed[] = [];
  const watched: Watched[] = [];
  const unjudged: LandingUnjudged[] = [];
  const runs: RuleRun[] = [];
  const rechecked: RuleCrossing[] = [];
  const full = yield* measureRules(
    versionOf(subject.projectId, subject.root, subject.built, subject.caller, subject.commonDir),
    rules.flatMap((rule) =>
      rule.document !== null && rule.changed && !isUnrun(rule.document.check) && rule.places.length > 0
        ? [
            {
              norm: { rule: rule.name, title: rule.title, strictness: rule.document.strictness },
              inspection: rule.document.check,
              places: rule.places,
              debt: rule.document.debt,
            },
          ]
        : [],
    ),
    subject.caller ?? null,
    laneOf(op),
    subject.workdir,
  );
  let inspected = 0;
  const judging = Effect.gen(function* () {
    const binding = { ...subject, caller: subject.caller ?? null, lane: laneOf(op) };
    const boundRules = rules.flatMap((rule): BoundRule[] => {
      if (rule.document === null) return [];
      const { check } = rule.document;
      return isProgrammed(check) && rule.paths.length > 0
        ? [{ rule: rule.name, inspection: check, places: rule.places, debt: rule.document.debt }]
        : [];
    });
    const merging = yield* mergingOf(
      subject,
      rules.some((rule) => rule.document !== null && rule.document.debt.length > 0),
    );
    const answering = (parents: Merging, bound: Bound) => (rule: (typeof rules)[number]) => {
      const { document } = rule;
      if (document === null) return Effect.succeed(undefined);
      const inspection = document.check;
      if (isUnrun(inspection) || rule.paths.length === 0) return Effect.succeed(undefined);
      const asked = againstParents(
        parents,
        { base: subject.base, paths: rule.paths, evidence },
        bound,
        (base, paths, readings, debt) =>
          isProgrammed(inspection)
            ? Effect.fromResult(readings.get(rule.name)!.answer)
            : inspections.judge({
                lane: laneOf(op),
                root: subject.root,
                base,
                built: subject.built,
                paths,
                places: rule.places,
                inspection,
                debt: judgedDebt(debt),
                checkout: subject.checkout,
              }),
        (changed) => touching(document, rule.places, changed),
        document.debt,
      );
      const attributing = Effect.flatMap(asked, (reading) =>
        Effect.map(attributed(subject, evidence, reading.verdict), (rows) => ({ rows, unjudged: reading.verdict.unjudged })),
      );
      const timed = Effect.suspend(() => {
        const ran = performance.now();
        return Effect.map(Effect.result(attributing), (answer) => ({
          answer,
          ms: (bound.ms.get(rule.name) ?? 0) + Math.round(performance.now() - ran),
        }));
      });
      return timed.pipe(
        Effect.withSpan('enforcement.rule', {
          attributes: {
            'enforcement.rule': rule.name,
            'inspection.builtin': isProgrammed(inspection) ? 'bindings' : inspection.builtin,
            files: rule.paths.length,
          },
        }),
      );
    };
    const runsProgram = (rule: (typeof rules)[number]) => rule.document !== null && isProgrammed(rule.document.check);
    const programRules = rules.filter(runsProgram);
    const builtinRules = rules.filter((rule) => !runsProgram(rule));
    const [settledBindings, builtinAnswers] = yield* Effect.all(
      [boundOf(binding, boundRules, merging), Effect.forEach(builtinRules, answering(merging, UNBOUND), { concurrency: RULES_AT_ONCE })],
      { concurrency: 2 },
    );
    const programAnswers = yield* Effect.forEach(programRules, answering(settledBindings.merging, settledBindings.bound), {
      concurrency: RULES_AT_ONCE,
    });
    const answers = new Map([
      ...builtinRules.map((rule, at) => [rule, builtinAnswers[at]] as const),
      ...programRules.map((rule, at) => [rule, programAnswers[at]] as const),
    ]);
    for (const rule of rules) {
      if (rule.document === null) {
        failed.push({ name: rule.name, title: rule.title, why: rule.reason, cause: 'undecodable', ways: rule.ways });
        runs.push({ rule: rule.name, ms: 0, reached: true, failed: rule.reason });
        continue;
      }
      const { document } = rule;
      const inspection = document.check;
      const gate = phase === 'before' && document.strictness === 'gate';
      inspected += 1;
      if (isUnrun(inspection)) {
        const why = unrunReason(document.inspection, inspection);
        runs.push({ rule: rule.name, strictness: document.strictness, on: document.on, ms: 0, reached: true, failed: why });
        failed.push({
          name: rule.name,
          title: rule.title,
          why,
          cause: inspection.cause ?? 'unsupported',
          ways: inspection.cause === 'module-map' ? MAP_RECOVERY : unrunWays(rule.name, document.inspection),
        });
        continue;
      }
      const reach = full.get(rule.name);
      let reachFailure: string | undefined;
      if (reach !== undefined) {
        if (Result.isFailure(reach.answer)) {
          const { cause, reason, ways } = reach.answer.failure;
          reachFailure = `the inspection over the changed description's whole reach failed (${cause}): ${reason}`;
          failed.push({ name: rule.name, title: rule.title, why: reachFailure, cause, ways });
        } else {
          rechecked.push(...reach.answer.success.violations.filter((one) => one.owed !== true));
          unjudged.push(...reach.answer.success.unjudged);
        }
      }
      if (rule.paths.length === 0) {
        runs.push({
          rule: rule.name,
          strictness: document.strictness,
          on: document.on,
          ms: reach?.ms ?? 0,
          reached: true,
          failed: reachFailure,
        });
        continue;
      }
      const { answer, ms } = answers.get(rule)!;
      const said = { rule: rule.name, strictness: document.strictness, on: document.on, ms: ms + (reach?.ms ?? 0), reached: true };
      if (Result.isFailure(answer)) {
        const why = `the inspection failed (${answer.failure.cause}): ${answer.failure.reason}`;
        const { cause, ways } = answer.failure;
        runs.push({ ...said, failed: why });
        failed.push({ name: rule.name, title: rule.title, why, cause, ways });
        continue;
      }
      runs.push({ ...said, failed: reachFailure });
      const { rows: found, unjudged: loose } = answer.success;
      unjudged.push(...loose.map((one) => ({ rule: rule.name, ...one })));
      const norm = { rule: rule.name, title: rule.title, strictness: document.strictness };
      for (const { violation, holders, withheld } of found) {
        const crossing = crossingOf(norm, inspection, violation, withheld, holders);
        if (gate) crossed.push(crossing);
        else watched.push(crossing);
      }
    }
  });
  yield* judging;
  const bodies = bodiesOf(rules, findingRules(crossed, watched, rechecked));
  unjudged.push(...failed.map(({ name, why, cause, ways }) => ({ rule: name, cause, failed: why, ways })));
  const refusal = crossed.length > 0 ? violatedRefusal(op, 'tree', crossed, failed, subject.checkout ?? subject.root, bodies) : null;
  const blocking = new Set([...crossed.map((one) => one.rule), ...failed.map((one) => one.name)]);
  const times = runs.filter((run) => blocking.has(run.rule) && run.reached);
  return {
    refused:
      refusal === null || times.length === 0
        ? refusal
        : {
            ...refusal,
            reason: [refusal.reason, 'inspection times:', ...times.map((run) => `  ${run.rule} ran in ${run.ms} ms`)].join('\n'),
          },
    watched,
    rechecked,
    unjudged,
    crossed,
    bodies,
    runs,
    rules: rules.map((rule) => rule.name),
    inspections: inspected,
    ms: Math.round(performance.now() - started),
  } satisfies Judgement;
});

export const headJudgement = Effect.fn('enforcement.headJudgement')(function* (op: string, subject: HeadSubject) {
  const started = performance.now();
  const root = subject.root ?? (yield* measuredRoot(yield* (yield* Projects).byId(subject.projectId)));
  const head = yield* Effect.result(headOf(root));
  if (Result.isFailure(head)) return unread(op, { message: head.failure.reason }, started);
  const settled = yield* Effect.result(
    enforcedRules(subject.projectId, versionOf(subject.projectId, root, head.success, subject.caller, undefined)),
  );
  if (Result.isFailure(settled)) return unread(op, settled.failure, started);
  const crossed: RuleCrossing[] = [];
  const failed: Failed[] = [];
  const watched: Watched[] = [];
  const unjudged: LandingUnjudged[] = [];
  const names: string[] = [];
  const boundRules: BoundRule[] = [];
  for (const entry of settled.success) {
    if (entry.document === null || !runsBefore(entry.document, op)) continue;
    const { check } = entry.document;
    if (!isProgrammed(check)) continue;
    const places = yield* entry.reach('');
    if (places.length > 0) boundRules.push({ rule: blockName(entry.rule.uuid), inspection: check, places, debt: entry.document.debt });
  }
  const boundPlaces = new Map(boundRules.map((rule) => [rule.rule, rule.places]));
  const bound = yield* judgeBindings(
    { projectId: subject.projectId, root, built: head.success, base: null, paths: null, caller: subject.caller ?? null, lane: laneOf(op) },
    boundRules,
  );
  const ruled: Ruled[] = [];
  for (const entry of settled.success) {
    const rule = { name: blockName(entry.rule.uuid), title: entry.rule.title };
    ruled.push({ ...rule, body: entry.rule.body });
    if (entry.document === null) {
      if (WAYS_OUT.has(op)) continue;
      names.push(rule.name);
      if ((yield* entry.reach('')).length > 0) {
        failed.push({
          name: rule.name,
          title: rule.title,
          why: entry.unreadable.reason,
          cause: 'undecodable',
          ways: entry.unreadable.unblock,
        });
      }
      continue;
    }
    if (!runsBefore(entry.document, op)) continue;
    const { document } = entry;
    const gate = document.strictness === 'gate';
    names.push(rule.name);
    const inspection = document.check;
    const places = isProgrammed(inspection) ? (boundPlaces.get(rule.name) ?? []) : yield* entry.reach(inspectionBase(inspection));
    if (places.length === 0) continue;
    if (isUnrun(inspection)) {
      const why = unrunReason(document.inspection, inspection);
      if (gate)
        failed.push({
          ...rule,
          why,
          cause: inspection.cause ?? 'unsupported',
          ways: inspection.cause === 'module-map' ? MAP_RECOVERY : unrunWays(rule.name, document.inspection),
        });
      else watched.push({ rule: rule.name, cause: inspection.cause ?? 'unsupported', failed: why });
      continue;
    }
    const measured = yield* Effect.result(
      isProgrammed(inspection)
        ? Effect.fromResult(bound.get(rule.name)!.answer).pipe(Effect.map((reading): Reading => reading))
        : measureAt(root, head.success, inspection, places).pipe(Effect.map((reading): Reading => ({ verdict: reading.verdict }))),
    );
    if (Result.isFailure(measured)) {
      const why = `the inspection failed (${measured.failure.cause}): ${measured.failure.reason}`;
      const { cause, ways } = measured.failure;
      if (gate) failed.push({ ...rule, why, cause, ways });
      else watched.push({ rule: rule.name, cause, failed: why });
      continue;
    }
    unjudged.push(...measured.success.verdict.unjudged.map((one) => ({ rule: rule.name, ...one })));
    const norm = { rule: rule.name, title: rule.title, strictness: document.strictness };
    for (const violation of siteRows(newViolations(measured.success.verdict.violations, [], judgedDebt(document.debt)).violations)) {
      const crossing = crossingOf(norm, inspection, wireOf(violation));
      if (gate) crossed.push(crossing);
      else watched.push(crossing);
    }
  }
  const bodies = bodiesOf(ruled, findingRules(crossed, watched));
  return {
    refused:
      crossed.length > 0
        ? violatedRefusal(op, 'head', crossed, failed, root, bodies)
        : failed.length > 0
          ? failedRefusal(op, 'head', failed)
          : null,
    watched,
    unjudged,
    bodies,
    rules: names,
    inspections: names.length,
    ms: Math.round(performance.now() - started),
  } satisfies Judgement;
});

export type JudgeServices =
  | Effect.Services<ReturnType<typeof judgement>>
  | Effect.Services<ReturnType<typeof headJudgement>>
  | Act
  | BlockNames;

export type JudgeGraph = (
  projectId: number,
  root: string | null,
) => Effect.Effect<Context.Context<JudgeServices>, { readonly message: string }>;

const unbuilt = (op: string, why: string): Judgement => ({
  refused: null,
  watched: [],
  unjudged: [{ gate: 'unread', cause: `the tree ${op} would land could not be read from git: ${why}` }],
  rules: [],
  inspections: 0,
  ms: 0,
});

export const unresolved = (
  op: string,
  root: string,
  failure: Unread,
  memory: GateMemory['Service'] | undefined,
  projectId: number,
): Effect.Effect<Judgement> => {
  const started = performance.now();
  if (memory === undefined) return Effect.succeed(unread(op, failure, started));
  return Effect.map(memory.gated(projectId), (gated) => (gated ? unread(op, failure, started) : ungated(root, failure.message, started)));
};

export const unowned = (root: string, cause = `no project this server serves holds ${root}, so no rule of its judges it`): Judgement => ({
  refused: null,
  watched: [],
  unjudged: [{ gate: 'unread', cause }],
  rules: [],
  inspections: 0,
  ms: 0,
});

export type Built = { readonly judged: Judgement; readonly tree: JudgedTree | null };

const EMPTY: Judgement = { ...UNCHECKED, rules: [], inspections: 0, ms: 0 };

export const judgingBuilt =
  (graphOf: JudgeGraph, memory: GateMemory['Service'] | undefined, git: Git['Service']) =>
  <E extends { readonly message: string }>(
    op: string,
    projectId: number,
    root: string,
    build: Effect.Effect<BuiltTree, E, Git>,
    phase: JudgedPhase,
    caller: TerminalActor | undefined,
  ): Effect.Effect<Built> => {
    const failed = (failure: Unread) => Effect.succeed<Built>({ judged: ungated(root, failure.message, performance.now()), tree: null });
    const judged = (built: BuiltTree): Effect.Effect<Built> =>
      Effect.flatMap(Effect.result(graphOf(projectId, root)), (graph) =>
        Result.isFailure(graph)
          ? failed(graph.failure)
          : Effect.gen(function* () {
              const { commonDir, ...made } = built;
              const tree = yield* pathsOf(made);
              if (tree.paths.length === 0) return { judged: EMPTY, tree };
              const subject: TreeSubject = { kind: 'tree', ...tree, projectId, commonDir, caller };
              return { judged: yield* judgement(op, subject, memory, phase), tree };
            }).pipe(Effect.provide(graph.success), Effect.catch(failed)),
      );
    return Effect.provideService(build, Git, git).pipe(
      Effect.matchEffect({
        onFailure: (failure) => Effect.succeed<Built>({ judged: unbuilt(op, failure.message), tree: null }),
        onSuccess: judged,
      }),
      Effect.flatMap((built) => Effect.as(annotated(op, built.tree?.paths.length ?? 0, built.judged), built)),
    );
  };

export const judgingOver =
  (graphOf: JudgeGraph, memory?: GateMemory['Service']) =>
  (op: string, subject: TreeSubject | HeadSubject, phase: JudgedPhase = 'before'): Effect.Effect<Judgement> => {
    const root = subject.kind === 'tree' ? (subject.rulesAt ?? subject.root) : (subject.root ?? null);
    return Effect.flatMap(Effect.result(graphOf(subject.projectId, root)), (graph) =>
      Result.isSuccess(graph)
        ? Effect.provide(subject.kind === 'tree' ? judgement(op, subject, memory, phase) : headJudgement(op, subject), graph.success).pipe(
            Effect.catch((failure) =>
              subject.kind === 'tree'
                ? Effect.succeed(ungated(subject.root, failure.message, performance.now()))
                : unresolved(op, root ?? `project ${subject.projectId}`, failure, memory, subject.projectId),
            ),
          )
        : subject.kind === 'tree'
          ? Effect.succeed(ungated(subject.root, graph.failure.message, performance.now()))
          : unresolved(op, root ?? `project ${subject.projectId}`, graph.failure, memory, subject.projectId),
    ).pipe(Effect.flatMap((judged) => annotated(op, subject.kind === 'tree' ? subject.paths.length : 0, judged)));
  };

export const ruleJudgementLayer = Layer.succeed(
  RuleJudgement,
  RuleJudgement.of({ built: judgingBuilt, over: judgingOver, head: headJudgement }),
);
