import type { ProgramMode, ProgramRemeasure, ProgramSide } from '@tagma/inspection/program';
import type { Footprint } from '@tagma/inspection/node/reading';
import type { Unjudged } from '@tagma/inspection/verdict';
import { Git } from '@runlith/git/Git';
import { Clock, Effect, Result } from 'effect';
import type { TerminalActor } from '../../executions/contract/wire/terminals.js';
import { generatedAmong } from '../../platform/git/generated.js';
import { actingGit } from '../../platform/git/ownGit.js';
import { InspectionFailed } from '../workers/inspectionLanes.js';
import type { CountedDebt, Programmed } from '../contract/wire/document.js';
import type { InspectionCoverage, RuleViolation } from '../contract/wire/enforcement.js';
import type { JudgeLane } from '../workers/asks.js';
import { checkerFor } from './checker.js';
import { judgePrograms, type ProgramBinding, type ProgramRun, reachOf } from './group.js';
import { inProgramReach } from './reach.js';
import { sideAt } from './files.js';

export type BoundRule = {
  readonly rule: string;
  readonly inspection: Programmed;
  readonly places: readonly string[];
  readonly debt: readonly CountedDebt[];
};

export type BindingSubject = {
  readonly mode?: ProgramMode;
  readonly projectId: number;
  readonly root: string;
  readonly built: string;
  readonly base: string | null;
  readonly paths: readonly string[] | null;
  readonly caller: TerminalActor | null;
  readonly lane: JudgeLane;
  readonly priority?: 'foreground' | 'background';
  readonly workdir?: string;
};

export type BoundReading = {
  readonly remeasure?: ProgramRemeasure;
  readonly footprint: Footprint;
  readonly coverage: readonly InspectionCoverage[];
  readonly verdict: {
    readonly violations: readonly RuleViolation[];
    readonly unjudged: readonly Unjudged[];
    readonly occurrences: readonly RuleViolation[];
    readonly baseOccurrences: readonly RuleViolation[];
  };
  readonly found: readonly string[];
};

const subjectsAt = Effect.fnUntraced(function* (root: string, tree: string, paths: readonly string[]) {
  const generated = yield* generatedAmong(actingGit(yield* Git, 'inspection-files'), root, paths, tree).pipe(
    Effect.mapError(
      (failure) =>
        new InspectionFailed({ cause: 'git', reason: `which files at ${tree} are generated could not be read: ${failure.message}` }),
    ),
  );
  return paths.filter((path) => !generated.has(path));
});

export const judgeBindings = Effect.fn('enforcement.bindings.judge')(function* (subject: BindingSubject, rules: readonly BoundRule[]) {
  const answers = new Map<string, ProgramRun<BoundReading>>();
  if (rules.length === 0) return answers;
  const started = yield* Clock.monotonicTimeNanos;
  const at = subject.workdir ?? subject.root;
  const programs: ProgramBinding[] = rules.map((rule) => ({
    rule: rule.rule,
    check: rule.inspection,
    places: rule.places,
    debt: rule.debt,
    checker: checkerFor(at, rule.inspection),
  }));
  const reaches = programs.map((program) => reachOf(program));
  const reached = subject.paths?.filter((path) => reaches.some((reach) => inProgramReach(reach, path))) ?? null;
  const sides = yield* Effect.result(
    Effect.gen(function* () {
      const paths = reached === null || subject.mode !== 'measure' ? reached : yield* subjectsAt(subject.root, subject.built, reached);
      const tree: ProgramSide =
        paths === null ? { side: 'tree', paths: null, files: null } : yield* sideAt(subject.root, subject.built, paths, 'tree');
      if (subject.base === null) return [tree] as const;
      const base: ProgramSide =
        paths === null ? { side: 'base', paths: null, files: null } : yield* sideAt(subject.root, subject.base, paths, 'base');
      return [tree, base] as const;
    }),
  );
  const readyMs = Math.round(Number((yield* Clock.monotonicTimeNanos) - started) / 1e6);
  if (Result.isFailure(sides)) {
    for (const program of programs) answers.set(program.rule, { answer: Result.fail(sides.failure), ms: readyMs });
    return answers;
  }
  const groups = yield* judgePrograms({ ...subject, root: at, tree: subject.built, sides: sides.success }, programs);
  for (const program of programs) {
    const run = groups.get(program.checker.id)!;
    const ms = readyMs + run.ms;
    if (Result.isFailure(run.answer)) {
      answers.set(program.rule, { answer: Result.fail(run.answer.failure), ms });
      continue;
    }
    const failure = run.failures.get(program.rule);
    if (failure !== undefined) {
      answers.set(program.rule, { answer: Result.fail(failure), ms });
      continue;
    }
    const readings = run.answer.success.filter((reading) => reading.rule === program.rule);
    answers.set(program.rule, {
      answer: Result.succeed({
        remeasure: readings.every((reading) => reading.remeasure === 'delta') ? 'delta' : undefined,
        verdict: {
          violations: readings.flatMap((reading) => reading.verdict.violations),
          unjudged: [],
          occurrences: readings.flatMap((reading) => reading.verdict.occurrences),
          baseOccurrences: readings.flatMap((reading) => reading.verdict.baseOccurrences),
        },
        found: readings.flatMap((reading) => reading.found),
        coverage: readings.map((reading) => reading.coverage),
        footprint: { region: false, files: [] },
      }),
      ms,
    });
  }
  return answers;
});
