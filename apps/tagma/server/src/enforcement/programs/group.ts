import {
  type BindingReach,
  type ProgramInvocation,
  type ProgramMode,
  type ProgramRemeasure,
  type ProgramKey,
  type ProgramResult,
  type ProgramSide,
  readProgramAnswer,
} from '@tagma/inspection/program';
import { newViolations } from '@tagma/inspection/verdict';
import { canonicalJson } from '@runlith/utils/object';
import { Clock, Effect, Option, Result, Schema } from 'effect';
import { ProgramRoad } from '../../executions/contract/service/programs.js';
import type { TerminalActor } from '../../executions/contract/wire/terminals.js';
import type { Checker } from './checker.js';
import type { InspectionCoverage, RuleViolation } from '../contract/wire/enforcement.js';
import { type CountedDebt, isLinter, type Programmed } from '../contract/wire/document.js';
import { MESSAGE_CHARS } from '../contract/wire/pages.js';
import type { JudgeLane } from '../workers/asks.js';
import { InspectionFailed } from '../workers/inspectionLanes.js';
import { programFacts } from './facts.js';
import { inProgramReach } from './reach.js';
import { adapterIn } from './adapters.js';
import { PRELOAD_ROOT, PRELOAD_TREE } from './loading.js';
import { judgedDebt } from '../rules/held.js';

export type ProgramBinding = {
  readonly rule: string;
  readonly check: Programmed;
  readonly places: readonly string[];
  readonly debt: readonly CountedDebt[];
  readonly checker: Checker;
};

export type GroupSubject = {
  readonly mode?: ProgramMode;
  readonly projectId: number;
  readonly root: string;
  readonly tree: string;
  readonly base: string | null;
  readonly sides: readonly [ProgramSide, ...ProgramSide[]];
  readonly caller: TerminalActor | null;
  readonly lane?: JudgeLane;
  readonly paths?: readonly string[] | null;
};

export type BindingReading = {
  readonly rule: string;
  readonly remeasure?: ProgramRemeasure;
  readonly coverage: InspectionCoverage;
  readonly verdict: {
    readonly violations: readonly RuleViolation[];
    readonly unjudged: readonly never[];
    readonly occurrences: readonly RuleViolation[];
    readonly baseOccurrences: readonly RuleViolation[];
  };
  readonly found: readonly string[];
};

export type ProgramRun<A> = {
  readonly answer: Result.Result<A, InspectionFailed>;
  readonly ms: number;
};

const rejected = (reason: string) => new InspectionFailed({ cause: 'program', reason });

type GroupReading = {
  readonly readings: readonly BindingReading[];
  readonly failures: ReadonlyMap<string, InspectionFailed>;
  readonly unprepared: readonly ProgramBinding[];
};

type GroupRun = ProgramRun<readonly BindingReading[]> & { readonly failures: ReadonlyMap<string, InspectionFailed> };

const preparing = (subject: GroupSubject): GroupSubject => ({
  ...subject,
  mode: 'measure',
  base: null,
  sides: [{ side: 'tree', paths: null, files: null }],
  paths: null,
});

export const reachOf = (binding: Pick<ProgramBinding, 'places' | 'check'>): BindingReach => ({
  places: [...new Set(binding.places)].sort(),
  files: binding.check.program.files === undefined ? undefined : [...new Set(binding.check.program.files)].sort(),
});

const askedOf = (check: Programmed): { readonly id: string; readonly params: unknown } =>
  isLinter(check.program)
    ? { id: 'rule' in check.program ? check.program.rule : check.key, params: {} }
    : { id: check.program.name, params: check.program.params };

const scoped = (key: ProgramKey, side: ProgramSide, reading: ProgramResult) => {
  if (!Array.isArray(reading.covered)) return Result.succeed(reading.findings.filter((one) => inProgramReach(key.reach, one.path)));
  if (side.paths === null) return Result.fail(`a whole-reach request needs reach coverage: ${key.key}/${side.side}`);
  const covered = new Set(reading.covered);
  if (side.paths.some((path) => inProgramReach(key.reach, path) && !covered.has(path)))
    return Result.fail(`coverage omits a requested path: ${key.key}/${side.side}`);
  const found = reading.findings.filter((one) => inProgramReach(key.reach, one.path));
  if (found.some((one) => !covered.has(one.path)))
    return Result.fail(`a finding lies outside the reading's coverage: ${key.key}/${side.side}`);
  return Result.succeed(found);
};

const execute = Effect.fn('enforcement.program.group')(function* (
  subject: GroupSubject,
  bindings: readonly [ProgramBinding, ...ProgramBinding[]],
  checker: Checker,
) {
  const road = yield* Effect.serviceOption(ProgramRoad);
  if (Option.isNone(road)) return yield* new InspectionFailed({ cause: 'host', reason: 'this server offers no command road' });
  if (subject.caller === null) return yield* new InspectionFailed({ cause: 'caller', reason: 'no caller stands behind this judgement' });
  const files = checker.descriptor.layout === 'files' ? adapterIn(checker.descriptor.adapter) : undefined;
  if (files === undefined && (checker.descriptor.adapter !== 'program' || checker.descriptor.layout !== 'program'))
    return yield* rejected(`the adapter ${checker.descriptor.adapter} with layout ${checker.descriptor.layout} is not available`);
  const keys = new Map<string, ProgramKey>();
  const routes: { binding: ProgramBinding; key: ProgramKey; signature: string }[] = [];
  const routed = new Set<string>();
  for (const binding of bindings) {
    const asked = askedOf(binding.check);
    const params = Schema.decodeUnknownResult(Schema.Record(Schema.String, Schema.Json))(asked.params);
    if (Result.isFailure(params)) return yield* rejected(`parameters of ${binding.check.key} are not JSON`);
    const reach = reachOf(binding);
    const signature = canonicalJson({ key: binding.check.key, id: asked.id, params: params.success, reach });
    let key = keys.get(signature);
    if (key === undefined) {
      key = { key: String(keys.size), id: asked.id, params: params.success, reach };
      keys.set(signature, key);
    }
    const route = JSON.stringify([binding.rule, signature]);
    if (!routed.has(route)) routes.push({ binding, key, signature });
    routed.add(route);
  }
  const needed = [...new Set(bindings.flatMap((binding) => binding.checker.descriptor.needs?.facts ?? []))];
  const needs = needed.length === 0 ? undefined : { facts: [needed[0]!, ...needed.slice(1)] as const };
  if (needs !== undefined && files !== undefined)
    return yield* rejected(`the ${checker.descriptor.adapter} adapter reads files and takes no facts`);
  const facts =
    needs === undefined
      ? undefined
      : yield* programFacts(
          subject,
          [...keys.values()].map((key) => key.reach),
          needs,
        );
  const input: ProgramInvocation = {
    mode: subject.mode,
    request: crypto.randomUUID(),
    checker: checker.id,
    keys: [...keys.values()] as [ProgramKey, ...ProgramKey[]],
    root: subject.root,
    tree: subject.tree,
    base: subject.base,
    sides: subject.sides,
    workdir: checker.cwd,
    facts,
  };
  const json: unknown =
    files !== undefined
      ? yield* files.answer(road.value, {
          projectId: subject.projectId,
          root: subject.root,
          actor: subject.caller,
          input,
          checker,
          covers: (key, path) => inProgramReach(key.reach, path),
          lane: subject.lane,
        })
      : yield* Effect.gen(function* () {
          const started = performance.now();
          if (checker.launch === null) return yield* rejected(`the runner ${checker.id} names no argv`);
          const ending = yield* road.value.run({
            projectId: subject.projectId,
            actor: subject.caller!,
            argv: checker.launch,
            cwd: checker.cwd,
            env: { [PRELOAD_ROOT]: subject.root, [PRELOAD_TREE]: subject.tree },
            stdin: JSON.stringify(input),
            operation: `inspection/${input.request}`,
            subject: `checker ${checker.id}`,
          });
          yield* Effect.annotateCurrentSpan({
            'checker.identity': checker.id,
            'checker.processes': ending._tag === 'Unrun' ? 0 : 1,
            'checker.keys': keys.size,
            'checker.ms': Math.round(performance.now() - started),
          });
          if (ending._tag === 'Unrun') return yield* new InspectionFailed({ cause: 'host', reason: ending.said });
          if (ending._tag === 'Stopped')
            return yield* new InspectionFailed({
              cause: ending.late ? 'deadline' : 'program',
              reason: `${ending.said}; ${ending.stderr.slice(-2000)}`,
            });
          if (ending.exitCode !== 0 || ending.cut)
            return yield* rejected(
              `checker exited ${ending.exitCode}${ending.cut ? ' with truncated output' : ''}; ${ending.stderr.slice(-2000)}`,
            );
          return yield* Effect.try({
            try: () => JSON.parse(ending.stdout) as unknown,
            catch: () => rejected('checker output is not JSON'),
          });
        });
  const answer = readProgramAnswer(input, json);
  if (Result.isFailure(answer)) return yield* rejected(answer.failure);
  const unanswered = new Map((answer.success.unanswered ?? []).map((one) => [one.key, one]));
  const failures = new Map<string, InspectionFailed>();
  const unprepared = new Set<ProgramBinding>();
  for (const { binding, key } of routes) {
    const missed = unanswered.get(key.key);
    if (missed === undefined) continue;
    const preparing = missed.why === 'unprepared';
    failures.set(
      binding.rule,
      new InspectionFailed({
        cause: 'program',
        unprepared: preparing,
        reason: `${binding.check.key} ${preparing ? 'is unprepared' : 'threw'}: ${missed.reason}`,
      }),
    );
    if (preparing) unprepared.add(binding);
  }
  const readings = new Map(answer.success.readings.map((one) => [`${one.key}/${one.side}`, one]));
  const sides = new Map(subject.sides.map((one) => [one.side, one]));
  const measured = new Map<
    string,
    {
      tree: readonly RuleViolation[];
      base: readonly RuleViolation[];
      covered: ReadonlySet<string>;
      coverage: InspectionCoverage;
      remeasure: ProgramRemeasure | undefined;
    }
  >();
  for (const { binding, key, signature } of routes) {
    if (measured.has(signature) || unanswered.has(key.key)) continue;
    const prefix = binding.check.key;
    const values = new Map<string, readonly RuleViolation[]>();
    let covered: ReadonlySet<string> = new Set();
    for (const side of subject.sides) {
      const reading = readings.get(`${key.key}/${side.side}`)!;
      const found = scoped(key, side, reading);
      if (Result.isFailure(found)) {
        failures.set(binding.rule, rejected(found.failure));
        break;
      }
      values.set(
        side.side,
        found.success.map((one): RuleViolation => ({
          fingerprint: `${prefix} ${one.fingerprint}`,
          file: one.path,
          line: one.line,
          message: one.message.trim().split('\n')[0]!.slice(0, MESSAGE_CHARS),
          fix: one.fix === undefined || one.fix.trim() === '' ? undefined : one.fix.trim(),
          value: one.value,
          sites: one.sites,
        })),
      );
      if (side.side === 'base') {
        const explicit = Array.isArray(reading.covered) ? new Set(reading.covered) : undefined;
        covered = new Set(
          (explicit === undefined ? (sides.get('base')?.files ?? []).map((file) => file.path) : [...explicit]).filter((path) =>
            inProgramReach(key.reach, path),
          ),
        );
      }
    }
    if (failures.has(binding.rule)) continue;
    const coverage = readings.get(`${key.key}/tree`)!.covered;
    measured.set(signature, {
      tree: values.get('tree')!,
      remeasure: readings.get(`${key.key}/tree`)!.remeasure,
      base: values.get('base') ?? [],
      covered,
      coverage: {
        prefix: `${prefix} `,
        paths: Array.isArray(coverage)
          ? [...new Set([...coverage, ...(subject.paths ?? []).filter((path) => inProgramReach(key.reach, path))])]
          : null,
      },
    });
  }
  const answered = routes
    .filter(({ binding }) => !failures.has(binding.rule))
    .map(({ binding, signature }): BindingReading => {
      const reading = measured.get(signature)!;
      const counted =
        subject.mode === 'measure' || subject.base === null
          ? { violations: reading.tree, occurrences: [], standing: [] }
          : newViolations(reading.tree, reading.base, judgedDebt(binding.debt), { covers: (path) => reading.covered.has(path) });
      return {
        rule: binding.rule,
        remeasure: reading.remeasure,
        coverage: reading.coverage,
        verdict: {
          violations: counted.violations,
          unjudged: [],
          occurrences: counted.occurrences,
          baseOccurrences: counted.standing,
        },
        found: [...new Set(reading.tree.map((one) => one.fingerprint))],
      };
    });
  return { readings: answered, failures, unprepared: [...unprepared] } satisfies GroupReading;
});

const read = Effect.fnUntraced(function* (subject: GroupSubject, group: readonly [ProgramBinding, ...ProgramBinding[]], checker: Checker) {
  const first = yield* execute(subject, group, checker);
  const [head, ...tail] = first.unprepared;
  if (subject.mode === 'measure' || head === undefined) return first;
  const needing: [ProgramBinding, ...ProgramBinding[]] = [head, ...tail];
  const prepared = yield* Effect.result(execute(preparing(subject), needing, checker));
  const next = Result.isFailure(prepared) ? prepared : yield* Effect.result(execute(subject, needing, checker));
  const failures = new Map(first.failures);
  const retried = new Set(needing.map((binding) => binding.rule));
  for (const rule of retried) failures.delete(rule);
  if (Result.isFailure(next)) for (const rule of retried) failures.set(rule, next.failure);
  else for (const [rule, failure] of next.success.failures) failures.set(rule, failure);
  return {
    readings: [...first.readings, ...(Result.isSuccess(next) ? next.success.readings : [])],
    failures,
    unprepared: [],
  } satisfies GroupReading;
});

export const judgePrograms = Effect.fn('enforcement.programs.judge')(function* (
  subject: GroupSubject,
  bindings: readonly ProgramBinding[],
) {
  const groups = new Map<string, [ProgramBinding, ...ProgramBinding[]]>();
  for (const binding of bindings) {
    const group = groups.get(binding.checker.id);
    if (group === undefined) groups.set(binding.checker.id, [binding]);
    else group.push(binding);
  }
  const answers = new Map<string, GroupRun>();
  for (const [identity, group] of groups) {
    const started = yield* Clock.monotonicTimeNanos;
    const checker = group[0].checker;
    const diagnosed = (failure: InspectionFailed): InspectionFailed => {
      if ((failure.cause !== 'program' && failure.cause !== 'host') || failure.unprepared === true) return failure;
      return new InspectionFailed({
        cause: failure.cause,
        split: failure.split,
        worker: failure.worker,
        reason: `${failure.reason}; checker ${checker.descriptor.adapter} environment: ${JSON.stringify(checker.cwd)}${checker.launch === null ? '' : `; argv: ${JSON.stringify(checker.launch)}`}`,
        ways: [
          ...(failure.ways ?? []),
          `if a tool or dependency is missing, run the repository's documented setup command in ${JSON.stringify(checker.cwd)} now, then run the inspection again`,
          `if new worktrees need that setup, write_setting with project ${subject.projectId}, key "worktrees.setupRun", and value set to the same command; it runs before a new checkout's first turn, not for this existing checkout`,
        ],
      });
    };
    const result = yield* Effect.result(read(subject, group, checker));
    answers.set(identity, {
      answer: Result.isFailure(result) ? Result.fail(diagnosed(result.failure)) : Result.succeed(result.success.readings),
      failures: Result.isFailure(result)
        ? new Map()
        : new Map([...result.success.failures].map(([rule, failure]) => [rule, diagnosed(failure)])),
      ms: Math.round(Number((yield* Clock.monotonicTimeNanos) - started) / 1e6),
    });
  }
  return answers;
});
