import { HelperAbsent, HelperChannel } from '@runlith/audio/helper/channel';
import { Context, Deferred, Duration, Effect, FileSystem, Layer, type Scope } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import type { Socket } from 'effect/socket/Socket';
import type { SocketServer, SocketServerError } from 'effect/socket/SocketServer';

export class LocalSockets extends Context.Service<
  LocalSockets,
  {
    readonly listen: (path: string) => Effect.Effect<SocketServer['Service'], SocketServerError, Scope.Scope>;
  }
>()('audio-darwin/LocalSockets') {}

const absent = (reason: string) =>
  new HelperAbsent({ reason, unblock: ['Build and install the host application, then open it in a macOS GUI session.'] });

export class DarwinChannel {
  static layer(
    hostApp: Effect.Effect<string>,
    helperName: string,
    dataDirectory: string,
    temporaryDirectory: string,
    options: { readonly timeout?: Duration.Input } = {},
  ) {
    return Layer.effect(
      HelperChannel,
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const sockets = yield* LocalSockets;
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
        const digest = yield* Effect.promise(() => crypto.subtle.digest('SHA-256', new TextEncoder().encode(dataDirectory)));
        const hash = Array.from(new Uint8Array(digest).subarray(0, 4), (byte) => byte.toString(16).padStart(2, '0')).join('');
        return HelperChannel.of({
          open: Effect.fn('DarwinChannel.open')(
            function* (token) {
              const app = `${yield* hostApp}/Contents/Helpers/${helperName}.app`;
              if (!(yield* fs.exists(app))) return yield* Effect.fail(absent(`Audio helper is absent at ${app}`));
              const base = new TextEncoder().encode(temporaryDirectory).length <= 75 ? temporaryDirectory : '/tmp';
              const directory = yield* fs.makeTempDirectoryScoped({ directory: base, prefix: `a${hash}-` });
              yield* fs.chmod(directory, 0o700);
              const path = `${directory}/s`;
              if (new TextEncoder().encode(path).length >= 104)
                return yield* Effect.fail(absent('Audio socket path exceeds the macOS Unix-socket limit'));
              const server = yield* sockets.listen(path);
              const accepted = yield* Deferred.make<Socket>();
              yield* server
                .run((socket) =>
                  Effect.gen(function* () {
                    if (yield* Deferred.succeed(accepted, socket)) yield* Effect.never;
                  }),
                )
                .pipe(Effect.forkScoped);
              const code = yield* spawner.exitCode(
                ChildProcess.make('/usr/bin/open', [
                  '-g',
                  '-n',
                  '-a',
                  app,
                  '--args',
                  '--socket',
                  path,
                  '--token',
                  token,
                  '--data',
                  dataDirectory,
                ]),
              );
              if (code !== 0) return yield* Effect.fail(absent(`LaunchServices could not open the audio helper (exit ${code})`));
              return yield* Deferred.await(accepted).pipe(
                Effect.timeoutOrElse({
                  duration: options.timeout ?? Duration.seconds(10),
                  orElse: () => Effect.fail(absent('Audio helper did not connect; a macOS GUI session is required')),
                }),
              );
            },
            Effect.mapError((error) => (error instanceof HelperAbsent ? error : absent(String(error)))),
          ),
        });
      }),
    );
  }
}
