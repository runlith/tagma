import { Effect, FileSystem } from 'effect';
import type { ChildProcessSpawner } from 'effect/process';
import { ENGINE_ABSENCE_LAYOUT, ENGINE_LAYOUT, type InstallationRole } from '../installation/contract/wire/manifest.js';
import { SILERO_PART, WHISPER_ABSENCE_PART, WHISPER_ENGINE_PART } from '../installation/contract/wire/layout.js';
import { type CommandUnavailable, output } from './command.js';

const ABSENT_EXIT = 3;

export type EngineOutcome = { readonly _tag: 'carried'; readonly log: string } | { readonly _tag: 'absent'; readonly reason: string };

export const engineLayout = (outcome: EngineOutcome): ReadonlyArray<readonly [InstallationRole, string]> =>
  outcome._tag === 'carried' ? ENGINE_LAYOUT : ENGINE_ABSENCE_LAYOUT;

export const carriedEngine = (
  builder: string,
  packages: string,
  root: string,
  arch: string | null,
): Effect.Effect<EngineOutcome, string | CommandUnavailable, FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.scoped(
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const absent = (reason: string) =>
        Effect.as(
          Effect.mapError(
            Effect.andThen(
              files.makeDirectory(`${root}/tools`, { recursive: true }),
              files.writeFileString(`${root}/${WHISPER_ABSENCE_PART}`, reason),
            ),
            (failure) => `the absence of the Whisper engine could not be recorded: ${failure.message}`,
          ),
          { _tag: 'absent', reason } as const,
        );
      const source = `${packages}/speech-whisper`;
      const directory = `${source}/native/.build`;
      yield* files
        .makeDirectory(directory, { recursive: true })
        .pipe(Effect.mapError((failure) => `the Whisper build directory could not be opened: ${failure.message}`));
      const work = yield* files
        .makeTempDirectoryScoped({ directory, prefix: 'cut-' })
        .pipe(Effect.mapError((failure) => `a private Whisper build directory could not be opened: ${failure.message}`));
      const built = `${work}/out`;
      const ran = yield* output(builder, [`${source}/scripts/build.ts`, '--require', ...(arch === null ? [] : ['--arch', arch])], source, {
        WHISPER_BUILD_ROOT: work,
        WHISPER_OUTPUT_ROOT: built,
      });
      const tail = ran.text
        .trim()
        .split('\n')
        .filter((line) => line.trim() !== '');
      if (ran.status === ABSENT_EXIT)
        return yield* absent(tail.at(-1)?.replace(/^\[speech-whisper\]\s*/, '') ?? 'the Whisper engine could not be built here');
      if (ran.status !== 0) return yield* Effect.fail(`the Whisper engine did not build (exit ${ran.status}): ${tail.slice(-3).join(' ')}`);
      const copied = Effect.gen(function* () {
        yield* files.makeDirectory(`${root}/tools`, { recursive: true });
        yield* files.writeFile(`${root}/${WHISPER_ENGINE_PART}`, yield* files.readFile(`${built}/whisper-engine`), { mode: 0o755 });
        yield* files.writeFile(`${root}/${SILERO_PART}`, yield* files.readFile(`${built}/silero.bin`), { mode: 0o644 });
      });
      yield* Effect.mapError(copied, (failure) => `the built Whisper engine could not be carried: ${failure.message}`);
      return { _tag: 'carried', log: ran.text } as const;
    }),
  );
