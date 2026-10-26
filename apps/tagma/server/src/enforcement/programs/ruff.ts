import { planRuff, readRuff } from '@tagma/inspection/node/runners/ruff';
import { Effect, Result } from 'effect';
import { checkerConfig, filesAnswer, filesFailed, type FileAdapter, type FilesRunner } from './filesRunner.js';

const adapter: FileAdapter = {
  id: 'ruff',
  env: { RAYON_NUM_THREADS: '1' },
  argv: (checker) =>
    checker.launch === null
      ? Effect.fail(filesFailed('ruff', `the runner ${checker.id} names no argv: the ruff executable`))
      : Effect.succeed(checker.launch),
  plan: Effect.fnUntraced(function* (input, sides, checker) {
    const config = yield* checkerConfig(input, checker);
    const plan = planRuff(input, sides, config);
    return Result.isFailure(plan) ? yield* filesFailed('ruff', plan.failure) : plan.success;
  }),
  read: readRuff,
};
export const ruffRunner: FilesRunner = { id: 'ruff', answer: (road, launch) => filesAnswer(road, launch, adapter) };
