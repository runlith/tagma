import { SEMGREP_COVERAGE, SEMGREP_MIN_VERSION, planSemgrep, readSemgrep } from '@tagma/inspection/node/runners/semgrep';
import { versionProblem } from '@tagma/inspection/node/runners/version';
import { Effect, Result } from 'effect';
import { checkerConfig, filesAnswer, filesFailed, type FileAdapter, type FilesRunner } from './filesRunner.js';

const adapter: FileAdapter = {
  id: 'semgrep',
  coverageFile: SEMGREP_COVERAGE,
  version: (stdout) => versionProblem('Semgrep', stdout.trim(), SEMGREP_MIN_VERSION),
  env: { SEMGREP_ENABLE_VERSION_CHECK: '0', SEMGREP_SEND_METRICS: 'off' },
  argv: (checker) =>
    checker.launch === null
      ? Effect.fail(filesFailed('semgrep', `the runner ${checker.id} names no argv: the semgrep executable`))
      : Effect.succeed(checker.launch),
  plan: Effect.fnUntraced(function* (input, sides, checker) {
    const config = yield* checkerConfig(input, checker);
    const plan = planSemgrep(input, sides, config);
    return Result.isFailure(plan) ? yield* filesFailed('semgrep', plan.failure) : plan.success;
  }),
  read: readSemgrep,
};
export const semgrepRunner: FilesRunner = { id: 'semgrep', answer: (road, launch) => filesAnswer(road, launch, adapter) };
