import { join } from 'node:path';
import { type EslintEnv, lintable, planEslint, readEslint } from '@tagma/inspection/node/runners/eslint';
import { DRIVER } from '@tagma/inspection/node/runners/eslint/driver';
import { Effect, Result } from 'effect';
import type { ProgramRoad } from '../../executions/contract/service/programs.js';
import { InspectionFailed } from '../workers/inspectionLanes.js';
import { type Checker, PRELOAD } from './checker.js';
import type { FilesLaunch, FilesRunner } from './filesRunner.js';
import { type LaidFile, reachSubjects, scratchDir, treeFile, writeInto } from './layout.js';
import { PRELOAD_ROOT, PRELOAD_TREE } from './loading.js';

const failed = (reason: string) => new InspectionFailed({ cause: 'program', reason: `eslint: ${reason}` });

const DRIVER_FILE = 'tagma-eslint-driver.mjs';

const inReach = (launch: FilesLaunch) => (path: string) => launch.input.keys.some((key) => launch.covers(key, path));

const laidSides = Effect.fn('enforcement.program.eslint.sides')(function* (launch: FilesLaunch) {
  const sides: { side: 'tree' | 'base'; whole: boolean; files: readonly LaidFile[] }[] = [];
  const reached = inReach(launch);
  for (const side of launch.input.sides) {
    if (side.files !== null) {
      sides.push({ side: side.side, whole: false, files: side.files.filter((file) => reached(file.path)) });
      continue;
    }
    const tree = side.side === 'tree' ? launch.input.tree : launch.input.base;
    if (tree === null) return yield* failed('a base side was asked of a judgement without a base');
    const places = [...new Set(launch.input.keys.flatMap((key) => key.reach.places))];
    sides.push({
      side: side.side,
      whole: true,
      files: yield* reachSubjects(launch.root, tree, places, (path) => lintable(path) && reached(path), failed),
    });
  }
  return sides;
});

const envOf = (checker: Checker): EslintEnv => ({
  env: checker.cwd,
  config: checker.descriptor.config === undefined ? null : join(checker.cwd, checker.descriptor.config),
});

const runDriver = Effect.fn('enforcement.program.eslint.run')(function* (
  road: ProgramRoad['Service'],
  launch: FilesLaunch,
  home: string,
  cwd: string,
  stdin: string,
) {
  const { input, checker } = launch;
  yield* writeInto(home, [{ path: DRIVER_FILE, text: DRIVER }], 'driver', failed);
  const started = performance.now();
  const ending = yield* road.run({
    projectId: launch.projectId,
    actor: launch.actor,
    cwd,
    stdin,
    argv: [...(checker.launch ?? [process.execPath, '--no-install']), '--preload', PRELOAD, join(home, DRIVER_FILE)],
    env: { [PRELOAD_ROOT]: launch.root, [PRELOAD_TREE]: input.tree },
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

export const eslintAnswer = Effect.fn('enforcement.program.eslint')(function* (road: ProgramRoad['Service'], launch: FilesLaunch) {
  const { input, checker } = launch;
  const config = checker.descriptor.config;
  if (config !== undefined) yield* treeFile(launch.root, input.tree, config, (reason) => failed(`its config could not be read: ${reason}`));
  const sides = yield* laidSides(launch);
  const plan = planEslint(input, sides, envOf(checker));
  if (Result.isFailure(plan)) return yield* failed(plan.failure);
  yield* Effect.annotateCurrentSpan({ 'checker.files': plan.success.targets.length });
  if (plan.success.targets.length === 0) {
    yield* Effect.annotateCurrentSpan({ 'checker.identity': checker.id, 'checker.processes': 0, 'checker.keys': input.keys.length });
    const answer = readEslint(input, sides, plan.success, null);
    return Result.isFailure(answer) ? yield* failed(answer.failure) : answer.success;
  }
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const scratch = yield* scratchDir('eslint-scratch', failed);
      yield* writeInto(scratch, plan.success.files, 'scratch layout', failed);
      const ending = yield* runDriver(road, launch, scratch, scratch, plan.success.stdin);
      const answer = readEslint(input, sides, plan.success, ending);
      return Result.isFailure(answer) ? yield* failed(`${answer.failure}; ${ending.stderr.slice(-2000)}`) : answer.success;
    }),
  );
});

export const eslintRunner: FilesRunner = { id: 'eslint', answer: eslintAnswer };
