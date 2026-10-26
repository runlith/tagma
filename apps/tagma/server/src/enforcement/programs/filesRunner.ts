import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FileEnding, FilePlan, FileSide, ProgramAnswer, ProgramInvocation, ProgramKey } from '@tagma/inspection/program';
import { Effect, Result, type Scope } from 'effect';
import type { ProgramRoad } from '../../executions/contract/service/programs.js';
import type { TerminalActor } from '../../executions/contract/wire/terminals.js';
import type { JudgeLane } from '../workers/asks.js';
import { InspectionFailed } from '../workers/inspectionLanes.js';
import type { Checker } from './checker.js';
import { reachFiles, scratchDir, treeFile, writeInto } from './layout.js';

export type FilesLaunch = {
  readonly projectId: number;
  readonly root: string;
  readonly actor: TerminalActor;
  readonly input: ProgramInvocation;
  readonly checker: Checker;
  readonly covers: (key: ProgramKey, path: string) => boolean;
  readonly lane?: JudgeLane;
};
export type FilesRunner = {
  readonly id: string;
  readonly answer: (road: ProgramRoad['Service'], launch: FilesLaunch) => Effect.Effect<ProgramAnswer, InspectionFailed>;
};
export type FileAdapter = {
  readonly id: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly coverageFile?: string;
  readonly version?: (stdout: string) => string | null;
  readonly argv: (checker: Checker) => Effect.Effect<readonly [string, ...string[]], InspectionFailed>;
  readonly plan: (
    input: ProgramInvocation,
    sides: readonly FileSide[],
    checker: Checker,
  ) => Effect.Effect<FilePlan, InspectionFailed, Scope.Scope>;
  readonly read: (
    input: ProgramInvocation,
    sides: readonly FileSide[],
    plan: FilePlan,
    ending: FileEnding | null,
    scratch: string,
  ) => Result.Result<ProgramAnswer, string>;
};
export const filesFailed = (id: string, reason: string) => new InspectionFailed({ cause: 'program', reason: `${id}: ${reason}` });

export const checkerConfig = Effect.fn('enforcement.program.filesRunner.config')(function* (input: ProgramInvocation, checker: Checker) {
  const failed = (reason: string) => filesFailed(checker.descriptor.adapter, `its config could not be read: ${reason}`);
  const path = checker.descriptor.config;
  if (path === undefined) return yield* failed('the descriptor names no config');
  const config = yield* treeFile(input.root, input.tree, path, failed);
  const dir = yield* scratchDir(`${checker.descriptor.adapter}-config`, failed);
  yield* writeInto(dir, [config], 'config', failed);
  return { path: config.path, absolute: join(dir, config.path), text: config.text, dir };
});

export const filesAnswer = Effect.fn('enforcement.program.filesRunner')(function* (
  road: ProgramRoad['Service'],
  launch: FilesLaunch,
  adapter: FileAdapter,
) {
  const failed = (reason: string) => filesFailed(adapter.id, reason);
  const { input, checker } = launch;
  const inReach = (path: string) => input.keys.some((key) => launch.covers(key, path));
  const sides: FileSide[] = [];
  for (const side of input.sides) {
    if (side.files !== null) sides.push({ side: side.side, whole: false, files: side.files.filter((file) => inReach(file.path)) });
    else {
      const tree = side.side === 'tree' ? input.tree : input.base;
      if (tree === null) return yield* failed('a base was requested without a base tree');
      const places = [...new Set(input.keys.flatMap((key) => key.reach.places))];
      sides.push({ side: side.side, whole: true, files: yield* reachFiles(launch.root, tree, places, inReach, failed) });
    }
  }
  const argv = yield* adapter.argv(checker);
  const plan = yield* adapter.plan(input, sides, checker);
  yield* Effect.annotateCurrentSpan({
    'checker.identity': checker.id,
    'checker.keys': input.keys.length,
    'checker.files': plan.targets.length,
  });
  if (plan.targets.length === 0) {
    yield* Effect.annotateCurrentSpan({ 'checker.processes': 0 });
    const answer = adapter.read(input, sides, plan, null, '');
    return Result.isFailure(answer) ? yield* failed(answer.failure) : answer.success;
  }
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const scratch = yield* scratchDir(`${adapter.id}-scratch`, failed);
      yield* writeInto(scratch, plan.files, 'scratch layout', failed);
      const started = performance.now();
      let processes = 0;
      const run = Effect.fnUntraced(function* (args: readonly string[]) {
        const ending = yield* road.run({
          projectId: launch.projectId,
          actor: launch.actor,
          cwd: scratch,
          stdin: '',
          argv: [...argv, ...args],
          env: adapter.env,
          operation: `inspection/${input.request}`,
          subject: `checker ${checker.id}`,
        });
        if (ending._tag !== 'Unrun') processes += 1;
        yield* Effect.annotateCurrentSpan({
          'checker.processes': processes,
          'checker.ms': Math.round(performance.now() - started),
        });
        if (ending._tag === 'Unrun') return yield* new InspectionFailed({ cause: 'host', reason: ending.said });
        if (ending._tag === 'Stopped')
          return yield* new InspectionFailed({ cause: ending.late ? 'deadline' : 'program', reason: ending.said });
        if (ending.cut) return yield* failed('its output was truncated');
        return ending;
      });
      const ending = yield* run(plan.args);
      const reading = Effect.gen(function* () {
        const coverage =
          adapter.coverageFile === undefined
            ? undefined
            : yield* Effect.try({
                try: () => readFileSync(join(scratch, adapter.coverageFile!), 'utf8'),
                catch: (error) =>
                  failed(
                    `its coverage output could not be read after exit ${ending.exitCode}: ${String(error)}; ${ending.stderr.slice(-2000)}`,
                  ),
              });
        const answer = adapter.read(input, sides, plan, coverage === undefined ? ending : { ...ending, coverage }, scratch);
        return Result.isFailure(answer) ? yield* failed(`${answer.failure}; ${ending.stderr.slice(-2000)}`) : answer.success;
      });
      return yield* reading.pipe(
        Effect.catchTag('InspectionFailed', (failure) =>
          Effect.gen(function* () {
            const versionOf = adapter.version;
            if (versionOf === undefined) return yield* failure;
            const version = yield* run(['--version']).pipe(
              Effect.mapError(
                (error) =>
                  new InspectionFailed({
                    cause: failure.cause,
                    reason: `${failure.reason}; its version command failed: ${error.reason}`,
                  }),
              ),
            );
            if (version.exitCode !== 0)
              return yield* new InspectionFailed({
                cause: failure.cause,
                reason: `${failure.reason}; its version command exited ${version.exitCode}: ${version.stderr.slice(-2000)}`,
              });
            const unsupported = versionOf(version.stdout);
            return yield* unsupported === null ? failure : failed(unsupported);
          }),
        ),
      );
    }),
  );
}, Effect.scoped);
