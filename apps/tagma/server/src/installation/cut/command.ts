import { Data, Effect, Fiber, type PlatformError, Stream } from 'effect';
import { ChildProcess, type ChildProcessSpawner } from 'effect/process';

export class CommandUnavailable extends Data.TaggedError('CommandUnavailable')<{
  readonly command: string;
  readonly detail: string;
  readonly unblock: readonly string[];
}> {}

export type CommandAnswer = { readonly status: number; readonly text: string };

const CHILD_KILL_AFTER_MS = 4_000;

export const output = (
  command: string,
  args: readonly string[],
  cwd: string,
  environment: Record<string, string>,
): Effect.Effect<CommandAnswer, CommandUnavailable, ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* ChildProcess.make(command, [...args], {
        cwd,
        env: environment,
        extendEnv: true,
        stdin: 'ignore',
        forceKillAfter: CHILD_KILL_AFTER_MS,
      });
      const decoder = new TextDecoder();
      let text = '';
      const collector = yield* Effect.forkScoped(
        handle.all.pipe(
          Stream.runForEach((bytes) =>
            Effect.sync(() => {
              text += decoder.decode(bytes, { stream: true });
            }),
          ),
        ),
      );
      const status = yield* handle.exitCode;
      yield* Fiber.join(collector);
      return { status, text: text + decoder.decode() };
    }),
  ).pipe(
    Effect.catchTag('PlatformError', (error: PlatformError.PlatformError) =>
      Effect.fail(
        new CommandUnavailable({
          command,
          detail: `${command} could not be run in ${cwd}: ${error.reason._tag}`,
          unblock: [`make ${command} an executable file and ${cwd} a directory this user can enter, then build again`],
        }),
      ),
    ),
  );
