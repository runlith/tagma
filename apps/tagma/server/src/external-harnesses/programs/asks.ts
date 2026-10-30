import { Effect, FileSystem, Layer } from 'effect';
import { AskPrograms, AskRefused } from '../../providers/contract/service/asks.js';
import { InstalledHarnesses } from '../../threads/contract/service/harness.js';
import { runProgram } from './run.js';
import { WORLD_COMMAND } from '../../installation/contract/wire/layout.js';
import { HARNESS_PROGRAM } from '../contract/wire/program.js';
import { programEnvironment } from '../sessions/programs.js';

export const makeAskPrograms = Effect.gen(function* () {
  const installs = yield* InstalledHarnesses;
  const files = yield* FileSystem.FileSystem;
  return AskPrograms.of({
    run: Effect.fn('AskPrograms.run')(
      function* (run) {
        const runner = typeof run.command === 'string' ? null : run.command.runner;
        const command = typeof run.command === 'string' ? run.command : WORLD_COMMAND;
        const program = yield* installs.program(runner ?? command, runner === null ? 'binary' : 'harness');
        const entries =
          runner !== null && program !== null
            ? programEnvironment(program, { inherit: true, entries: run.entries }, [
                { _tag: 'Set', name: HARNESS_PROGRAM, value: program.path },
              ]).entries
            : run.entries;
        const scratch = yield* files.makeTempDirectoryScoped({ prefix: 'tagma-ask-' });
        return yield* runProgram(
          {
            program: command,
            args: runner === null ? run.argv : ['harness-run', runner, ...run.argv],
            entries,
            cwd: scratch,
            timeoutMs: run.deadlineMs,
            input: run.input,
          },
          runner === null ? program : null,
        );
      },
      Effect.scoped,
      Effect.mapError((failure) =>
        failure._tag === 'ProgramFailed'
          ? new AskRefused({ refusal: 'ask-provider-failed', message: failure.message, failure })
          : new AskRefused({ refusal: 'ask-provider-failed', message: 'the ask program had no working directory', failure }),
      ),
    ),
  });
});

export const askProgramsLayer = Layer.effect(AskPrograms, makeAskPrograms);
