import type { ProgramAsk } from '@runlith/tagma/adapter/provider';
import { Effect, FileSystem, Layer } from 'effect';
import { AskPrograms, type ProgramRun } from '../../providers/contract/service/asks.js';
import { InstalledHarnesses } from '../../threads/contract/service/harness.js';
import { runProgram } from './run.js';
import { WORLD_COMMAND } from '../../installation/contract/wire/layout.js';
import { runnerArgs, runnerEnvironment } from '../sessions/programs.js';

export const runnerAsk = (ask: ProgramAsk): readonly string[] => [
  '--ask',
  '--model',
  ask.model,
  ...(ask.rung === null ? [] : ['--effort', ask.rung]),
  `--system=${ask.system}`,
];

export const makeAskPrograms = Effect.gen(function* () {
  const installs = yield* InstalledHarnesses;
  const files = yield* FileSystem.FileSystem;
  const launch = Effect.fnUntraced(function* ({ program, ask, entries }: ProgramRun) {
    if (!('runner' in program))
      return { command: program.command, args: program.argv(ask), entries, installed: yield* installs.program(program.command, 'binary') };
    const runner = program.runner;
    const environment = yield* runnerEnvironment(installs, runner, { inherit: true, entries });
    return { command: WORLD_COMMAND, args: runnerArgs(runner, runnerAsk(ask)), entries: environment?.entries ?? entries, installed: null };
  });
  return AskPrograms.of({
    run: Effect.fn('AskPrograms.run')(function* (run) {
      const launched = yield* launch(run);
      const scratch = yield* files.makeTempDirectoryScoped({ prefix: 'tagma-ask-' }).pipe(Effect.orDie);
      return yield* runProgram(
        {
          program: launched.command,
          args: launched.args,
          entries: launched.entries,
          cwd: scratch,
          timeoutMs: run.deadlineMs,
          input: run.input,
        },
        launched.installed,
      );
    }, Effect.scoped),
  });
});

export const askProgramsLayer = Layer.effect(AskPrograms, makeAskPrograms);
