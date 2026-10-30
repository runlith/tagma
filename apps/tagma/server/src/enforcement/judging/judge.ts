import { newViolations, siteRows } from '@tagma/inspection/verdict';
import { Context, Effect, Layer, Result, Semaphore } from 'effect';
import { RuleJudgement } from '../contract/service/judge.js';
import { Projects } from '../../projects/contract/service/registry.js';
import {
  type CarriedViolation,
  crossingOf,
  type InspectionFailure,
  inspectionBase,
  inspectionRelevant,
  type JudgeRefusalReport,
  type LandingUnjudged,
  type RuleCrossing,
  type RuleRun,
  type Watched,
} from '../contract/wire/enforcement.js';
import { findingLines } from '../contract/wire/findings.js';
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
import { GateRefusal, type Words } from '../../platform/contract/wire/refusal.js';
import {
  COMMIT_OPERATIONS,
  type Checked,
  type HeadSubject,
  type JudgedTree,
  type TreeSubject,
  UNCHECKED,
} from '../contract/wire/checks.js';
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

type Rule = { readonly name: string; readonly title: string };

type InPlay =
  | (Rule & { readonly document: Law; readonly paths: readonly string[]; readonly places: readonly string[]; readonly changed: boolean })
  | (Rule & { readonly document: null; readonly reason: string; readonly ways: readonly string[] });

type Failed = Rule & { readonly why: string; readonly cause: InspectionFailure | 'undecodable'; readonly ways?: readonly string[] };

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

const MERGE_OP = 'merge_worktree';

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
    const rule = { name: blockName(entry.rule.uuid), title: entry.rule.title };
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

const withheldNote = (one: RuleCrossing): string =>
  one.withheld === undefined ? '' : `standing only on ${one.withheld}, which this session holds and this change leaves out`;

const failedLine = (one: Failed): string => `${one.name} "${one.title}": ${one.why}`;

const quoted = (title: string): string => `“${title}”`;

const crossedWords = (kind: 'tree' | 'head', crossed: readonly RuleCrossing[]): Words => {
  const blocked = kind === 'head' ? 'HEAD breaks' : 'Blocked by';
  const titles = [...new Map(crossed.map((one) => [one.rule, one.title])).values()];
  const [first, second] = titles;
  if (first === undefined) return { text: `${blocked} a rule` };
  if (second === undefined) return { text: `${blocked} rule ${quoted(first)}` };
  const more = titles.length > 2 ? ` and ${titles.length - 2} more` : '';
  return { text: `${blocked} ${titles.length} rules: ${quoted(first)}, ${quoted(second)}${more}` };
};

const failedWords = (failed: readonly Failed[]): Words => {
  const [first] = failed;
  return {
    text:
      first === undefined || failed.length > 1
        ? `${failed.length} rules could not check this change`
        : `Rule ${quoted(first.title)} could not check this change`,
  };
};

const committing = (op: string): boolean => COMMIT_OPERATIONS.includes(op);

const actSaid = (op: string, kind: 'tree' | 'head'): string =>
  kind === 'head' ? `${op} at HEAD` : op === MERGE_OP ? 'this merge' : committing(op) ? 'this commit' : `this ${op}`;

const firstWay = (op: string, kind: 'tree' | 'head'): string =>
  kind === 'head'
    ? 'fix each violation where it stands at HEAD as its fix says, and land the fix'
    : op === MERGE_OP
      ? "fix each crossing as its fix says on the worktree's branch, commit it there, then merge again"
      : committing(op)
        ? 'fix each crossing as its fix says, or take its path out of the index with `git restore --staged <path>`, then commit again'
        : 'fix each crossing as its fix says, or land the paths that carry none first: submit_work with `paths` naming them';

const absorbWay = (crossed: readonly RuleCrossing[], checkout: string): string => {
  const ruled = new Map<string, Set<string>>();
  for (const one of crossed) ruled.set(one.rule, (ruled.get(one.rule) ?? new Set()).add(one.fingerprint));
  const named = [...ruled].map(
    ([rule, fingerprints]) =>
      `enforce_rule ${rule} with \`checkout\` ${JSON.stringify(checkout)} and \`absorb\` [${[...fingerprints].map((one) => `"${one}"`).join(', ')}]`,
  );
  return `where the code belongs here and the place itself is shaped wrong, do not bend the code to the rule: absorb the crossing as debt — ${named.join('; ')} — owned by a new task that names the area and what you saw, your view that the rule misfits this code included, and name that debt in your answer; the design is that task's`;
};

const violatedRefusal = (
  op: string,
  kind: 'tree' | 'head',
  crossed: readonly RuleCrossing[],
  failed: readonly Failed[],
  checkout: string,
): JudgeRefusalReport => {
  const unblock: [string, ...string[]] = [firstWay(op, kind), absorbWay(crossed, checkout)];
  for (const way of new Set(failed.flatMap((one) => one.ways ?? []))) unblock.push(way);
  const withheld = [...new Set(crossed.flatMap((one) => (one.withheld === undefined ? [] : [one.withheld])))];
  if (withheld.length > 0) {
    const one = withheld.length === 1;
    unblock.unshift(
      `${op} with \`paths\` that also names ${withheld.join(', ')}: this session holds ${one ? 'it' : 'them'}, and each crossing standing on ${one ? 'it' : 'them'} ends once ${one ? 'it lands' : 'they land'} in the same commit`,
    );
  }
  const own =
    kind === 'head'
      ? 'HEAD'
      : op === MERGE_OP
        ? "this merge's lines"
        : committing(op)
          ? 'what the index holds'
          : "this session's own lines";
  const act = committing(op) ? 'the commit' : op;
  return {
    code: 'rule-violated',
    reason: [
      `${crossed.length} ${kind === 'head' ? '' : 'new '}crossing${crossed.length === 1 ? '' : 's'} of a gated rule in ${own}, so ${act} did not run:`,
      ...findingLines(crossed, '  ', withheldNote),
      ...(failed.length === 0 ? [] : [`and a gated inspection could not run: ${failed.map(failedLine).join('; ')}`]),
    ].join('\n'),
    unblock,
    words: crossedWords(kind, crossed),
  };
};

const failedRefusal = (op: string, kind: 'tree' | 'head', failed: readonly Failed[]): JudgeRefusalReport => {
  if (failed.every((one) => one.cause === 'module-map')) {
    return {
      code: 'module-map-invalid',
      reason: `the module map does not hold together, so ${actSaid(op, kind)} was refused: ${failed.map(failedLine).join('; ')}`,
      unblock: MAP_RECOVERY,
      words: { text: 'The module map does not hold together' },
    };
  }
  const causes = new Set(failed.map((one) => one.cause));
  const unblock: [string, ...string[]] = [
    'check_rules with `rules` naming the rule shows what it reads, what it could not read and how long it takes',
  ];
  if (causes.has('deadline')) {
    unblock.push(
      'a program stopped when its life ran out is given more by the life rule that bound it, in whichever list stands it (read_command_rules, write_command_rule)',
    );
  }
  if (causes.has('worker')) unblock.push('a worker that died twice is started afresh by the next judgement: run the act again');
  if (causes.has('git')) unblock.push("read_checkout says whether git can read this checkout's objects; the gate judges again once it can");
  if (causes.has('envelope')) {
    unblock.push(
      "a subject past the builtin's envelope is never judged: land it in smaller changes, or the rule's owner narrows its reach, or moves it to watch, through enforce_rule",
    );
  }
  if (causes.has('program')) {
    unblock.push("the program's own stderr in the reason says why it failed; its run stands in read_commands under the caller");
  }
  if (causes.has('host'))
    unblock.push('read_commands says whether the execution host stands and takes commands; the gate judges again once it does');
  if (causes.has('caller')) {
    unblock.push(
      op === MERGE_OP
        ? 'a merge queued before its caller was stored has no caller to run a program as: merge_worktree again, which runs it as you'
        : `this ${op} names no caller to run a program as; run it from a thread`,
    );
  }
  if (causes.has('setup')) {
    unblock.push('the worktree setup of the inspected tree failed: worktrees.setupCopy and worktrees.setupRun ready it');
  }
  for (const way of new Set(failed.flatMap((one) => one.ways ?? []))) unblock.push(way);
  return {
    code: 'inspection-failed',
    reason: `a gated rule could not judge ${actSaid(op, kind)}, and a gate that cannot judge refuses: ${failed.map(failedLine).join('; ')}`,
    unblock,
    words: failedWords(failed),
  };
};

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
    carriedViolations: [],
    unjudged: [],
    rules: [],
    inspections: 0,
    ms: Math.round(performance.now() - started),
  };
};

const ungated = (root: string, why: string, started: number): Judgement => ({
  refused: null,
  watched: [],
  carriedViolations: [],
  unjudged: [
    { gate: 'unread', cause: `the graph of ${root} could not be read, and this project was never read enforcing a rule at gate: ${why}` },
  ],
  rules: [],
  inspections: 0,
  ms: Math.round(performance.now() - started),
});

const verdictOf = (judged: Judgement): string =>
  judged.refused?.code ??
  (judged.unjudged.some((one) => 'gate' in one)
    ? 'unjudged'
    : judged.watched.length > 0
      ? 'watched'
      : judged.carriedViolations.length > 0
        ? 'carried'
        : 'clean');

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
  if (Result.isFailure(settled)) return yield* unresolved(op, subject.root, settled.failure, memory, subject.projectId);
  const rules = settled.success.found;
  const inspections = yield* Inspections;
  const evidence = evidenceOf(subject.root, subject.base, subject.built);
  const crossed: RuleCrossing[] = [];
  const failed: Failed[] = [];
  const watched: Watched[] = [];
  const carried: CarriedViolation[] = [];
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
        if (gate)
          failed.push({
            name: rule.name,
            title: rule.title,
            why,
            cause: inspection.cause ?? 'unsupported',
            ways: inspection.cause === 'module-map' ? MAP_RECOVERY : unrunWays(rule.name, document.inspection),
          });
        else watched.push({ rule: rule.name, cause: inspection.cause ?? 'unsupported', failed: why });
        continue;
      }
      const reach = full.get(rule.name);
      let reachFailure: string | undefined;
      if (reach !== undefined) {
        if (Result.isFailure(reach.answer)) {
          const { cause, reason, ways } = reach.answer.failure;
          reachFailure = `the inspection over the changed description's whole reach failed (${cause}): ${reason}`;
          if (gate) failed.push({ name: rule.name, title: rule.title, why: reachFailure, cause, ways });
          else watched.push({ rule: rule.name, cause, failed: reachFailure });
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
        if (gate) failed.push({ name: rule.name, title: rule.title, why, cause, ways });
        else watched.push({ rule: rule.name, cause, failed: why });
        continue;
      }
      runs.push({ ...said, failed: reachFailure });
      const { rows: found, unjudged: loose } = answer.success;
      unjudged.push(...loose.map((one) => ({ rule: rule.name, ...one })));
      const norm = { rule: rule.name, title: rule.title, strictness: document.strictness };
      for (const { violation, holders, withheld } of found) {
        const crossing = crossingOf(norm, inspection, violation, withheld);
        if (holders.length > 0) carried.push({ ...crossing, holders });
        else if (gate) crossed.push(crossing);
        else watched.push(crossing);
      }
    }
  });
  yield* judging;
  const refusal =
    crossed.length > 0
      ? violatedRefusal(op, 'tree', crossed, failed, subject.checkout ?? subject.root)
      : failed.length > 0
        ? failedRefusal(op, 'tree', failed)
        : null;
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
    carriedViolations: carried,
    rechecked,
    unjudged,
    crossed,
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
  for (const entry of settled.success) {
    const rule = { name: blockName(entry.rule.uuid), title: entry.rule.title };
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
  return {
    refused:
      crossed.length > 0
        ? violatedRefusal(op, 'head', crossed, failed, root)
        : failed.length > 0
          ? failedRefusal(op, 'head', failed)
          : null,
    watched,
    carriedViolations: [],
    unjudged,
    rules: names,
    inspections: names.length,
    ms: Math.round(performance.now() - started),
  } satisfies Judgement;
});

export type JudgeServices = Effect.Services<ReturnType<typeof judgement>> | Effect.Services<ReturnType<typeof headJudgement>>;

export type JudgeGraph = (
  projectId: number,
  root: string | null,
) => Effect.Effect<Context.Context<JudgeServices>, { readonly message: string }>;

const unbuilt = (op: string, why: string, memory: GateMemory['Service'] | undefined, projectId: number): Effect.Effect<Judgement> =>
  Effect.map(memory === undefined ? Effect.succeed(true) : memory.gated(projectId), (gated): Judgement => ({
    refused: gated
      ? {
          code: 'inspection-failed',
          reason: `the tree ${op} would land could not be read from git, so nothing judged it: ${why}`,
          unblock: ['read what git said and clear it, then commit again'],
        }
      : null,
    watched: [],
    carriedViolations: [],
    unjudged: gated ? [] : [{ gate: 'unread', cause: `the tree ${op} would land could not be read from git: ${why}` }],
    rules: [],
    inspections: 0,
    ms: 0,
  }));

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
  carriedViolations: [],
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
    const failed = (failure: Unread) =>
      Effect.map(unresolved(op, root, failure, memory, projectId), (judged): Built => ({ judged, tree: null }));
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
      Effect.map((tree) => ({ tree })),
      Effect.catch((failure) => Effect.map(unbuilt(op, failure.message, memory, projectId), (read) => ({ read }))),
      Effect.flatMap((made): Effect.Effect<Built> =>
        'read' in made ? Effect.succeed({ judged: made.read, tree: null }) : judged(made.tree),
      ),
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
            Effect.catch((failure) => unresolved(op, root ?? `project ${subject.projectId}`, failure, memory, subject.projectId)),
          )
        : unresolved(op, root ?? `project ${subject.projectId}`, graph.failure, memory, subject.projectId),
    ).pipe(Effect.flatMap((judged) => annotated(op, subject.kind === 'tree' ? subject.paths.length : 0, judged)));
  };

export const ruleJudgementLayer = Layer.succeed(
  RuleJudgement,
  RuleJudgement.of({ built: judgingBuilt, over: judgingOver, head: headJudgement }),
);
