import { planCommand, readFindingsCommand, readSarifCommand } from '@tagma/inspection/node/runners/command';
import { Effect, Result } from 'effect';
import { type FileAdapter, filesAnswer, filesFailed, type FilesRunner } from './filesRunner.js';

const commandOf = (id: string, read: FileAdapter['read']): FilesRunner => {
  const adapter: FileAdapter = {
    id,
    argv: (checker) =>
      checker.launch === null
        ? Effect.fail(filesFailed(id, `${checker.id} names no argv: the command to run`))
        : Effect.succeed(checker.launch),
    plan: (input, sides) => {
      const plan = planCommand(input, sides);
      return Result.isFailure(plan) ? Effect.fail(filesFailed(id, plan.failure)) : Effect.succeed(plan.success);
    },
    read,
  };
  return { id, answer: (road, launch) => filesAnswer(road, launch, adapter) };
};

export const sarifCommandRunner = commandOf('command-sarif', readSarifCommand);

export const findingsCommandRunner = commandOf('command-findings', readFindingsCommand);
