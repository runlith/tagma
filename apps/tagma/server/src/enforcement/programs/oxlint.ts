import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import type { ProgramInvocation } from '@tagma/inspection/program';
import { type LaidSide, lintable, OXLINT_MIN_VERSION, planOxlint, readOxlint } from '@tagma/inspection/node/runners/oxlint';
import { Effect, Result } from 'effect';
import type { ProgramRoad } from '../../executions/contract/service/programs.js';
import type { TerminalActor } from '../../executions/contract/wire/terminals.js';
import type { JudgeLane } from '../workers/asks.js';
import { InspectionFailed } from '../workers/inspectionLanes.js';
import type { Checker } from './checker.js';
import { reachFiles, scratchDir, treeFile, writeInto } from './layout.js';
import { requireVersion } from './version.js';

export type OxlintLaunch = {
  readonly projectId: number;
  readonly root: string;
  readonly actor: TerminalActor;
  readonly input: ProgramInvocation;
  readonly checker: Checker;
  readonly inReach: (path: string) => boolean;
  readonly lane?: JudgeLane | 'reach';
};

const failed = (reason: string) => new InspectionFailed({ cause: 'program', reason: `oxlint: ${reason}` });

const wholeSide = (launch: OxlintLaunch, tree: string) =>
  reachFiles(
    launch.root,
    tree,
    [...new Set(launch.input.keys.flatMap((key) => key.reach.places))],
    (path) => lintable(path) && launch.inReach(path),
    failed,
  );

const laidSides = Effect.fn('enforcement.program.oxlint.sides')(function* (launch: OxlintLaunch) {
  const sides: LaidSide[] = [];
  for (const side of launch.input.sides) {
    if (side.files !== null) {
      sides.push({ side: side.side, whole: false, files: side.files.filter((file) => launch.inReach(file.path)) });
      continue;
    }
    const tree = side.side === 'tree' ? launch.input.tree : launch.input.base;
    if (tree === null) return yield* failed('a base side was asked of a judgement without a base');
    sides.push({ side: side.side, whole: true, files: yield* wholeSide(launch, tree) });
  }
  return sides;
});

const configOf = Effect.fnUntraced(function* (launch: OxlintLaunch) {
  const config = launch.checker.descriptor.config;
  if (config === undefined) return null;
  const file = yield* treeFile(launch.root, launch.input.tree, config, (reason) => failed(`its config could not be read: ${reason}`));
  return { path: config, absolute: join(launch.checker.cwd, config), text: file.text };
});

const THREADS = Math.min(3, availableParallelism());

const runOxlint = Effect.fn('enforcement.program.oxlint.run')(function* (
  road: ProgramRoad['Service'],
  launch: OxlintLaunch,
  cwd: string,
  args: readonly string[],
) {
  const { input, checker } = launch;
  yield* requireVersion(join(checker.cwd, 'node_modules/oxlint/package.json'), 'oxlint', OXLINT_MIN_VERSION);
  const started = performance.now();
  const ending = yield* road.run({
    projectId: launch.projectId,
    actor: launch.actor,
    cwd,
    stdin: '',
    argv: [...(checker.launch ?? [process.execPath, '--no-install']), join(checker.cwd, 'node_modules/oxlint/bin/oxlint'), ...args],
    operation: `inspection/${input.request}`,
    subject: `checker ${checker.id}`,
  });
  yield* Effect.annotateCurrentSpan({
    'checker.identity': checker.id,
    'checker.processes': ending._tag === 'Unrun' ? 0 : 1,
    'checker.keys': input.keys.length,
    'checker.ms': Math.round(performance.now() - started),
  });
  if (ending._tag === 'Unrun') return yield* new InspectionFailed({ cause: 'host', reason: ending.said });
  if (ending._tag === 'Stopped')
    return yield* new InspectionFailed({
      cause: ending.late ? 'deadline' : 'program',
      reason: `${ending.said}; ${ending.stderr.slice(-2000)}`,
    });
  if (ending.cut) return yield* failed('its output was truncated');
  return ending;
});

export const oxlintAnswer = Effect.fn('enforcement.program.oxlint')(function* (road: ProgramRoad['Service'], launch: OxlintLaunch) {
  const { input, checker } = launch;
  const config = yield* configOf(launch);
  const sides = yield* laidSides(launch);
  const plan = planOxlint(input, sides, config, THREADS);
  if (Result.isFailure(plan)) return yield* failed(plan.failure);
  yield* Effect.annotateCurrentSpan({ 'checker.files': plan.success.targets.length });
  if (plan.success.targets.length === 0) {
    yield* Effect.annotateCurrentSpan({ 'checker.identity': checker.id, 'checker.processes': 0, 'checker.keys': input.keys.length });
    const answer = readOxlint(input, sides, plan.success, null);
    return Result.isFailure(answer) ? yield* failed(answer.failure) : answer.success;
  }
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const scratch = yield* scratchDir('oxlint-scratch', failed);
      yield* writeInto(scratch, [...plan.success.sources, plan.success.config], 'scratch layout', failed);
      const ending = yield* runOxlint(road, launch, scratch, plan.success.args);
      const answer = readOxlint(input, sides, plan.success, ending);
      return Result.isFailure(answer) ? yield* failed(`${answer.failure}; ${ending.stderr.slice(-2000)}`) : answer.success;
    }),
  );
});
