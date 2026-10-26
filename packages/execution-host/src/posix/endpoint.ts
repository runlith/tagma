import { Effect, FileSystem, Layer } from 'effect';
import * as BunSocketServer from '@effect/platform-bun/BunSocketServer';
import { Endpoint, EndpointUnavailable } from '../Endpoint';

export const endpointLayer = Layer.effect(
  Endpoint,
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    return Endpoint.of({
      connectionExpense: 1,
      listen: Effect.fn('Endpoint.listen')(function* (registration) {
        const path = registration.endpoint.path;
        if (registration.endpoint.transport !== 'unix') {
          return yield* new EndpointUnavailable({
            path,
            detail: `the POSIX adapter cannot listen on ${registration.endpoint.transport}`,
          });
        }
        const directory = yield* files
          .stat(registration.state)
          .pipe(Effect.mapError((error) => new EndpointUnavailable({ path, detail: `state directory unreadable: ${error.reason._tag}` })));
        if (directory.type !== 'Directory' || (directory.mode & 0o077) !== 0) {
          return yield* new EndpointUnavailable({ path, detail: 'the state directory is not user-private' });
        }
        yield* files.remove(path).pipe(
          Effect.catchReason('PlatformError', 'NotFound', () => Effect.void),
          Effect.mapError(
            (error) => new EndpointUnavailable({ path, detail: `a stale endpoint could not be removed: ${error.reason._tag}` }),
          ),
        );
        const server = yield* BunSocketServer.make({ path });
        yield* files
          .chmod(path, 0o600)
          .pipe(
            Effect.mapError(
              (error) => new EndpointUnavailable({ path, detail: `endpoint could not be made private: ${error.reason._tag}` }),
            ),
          );
        return server;
      }),
      withdraw: (registration) =>
        files.remove(registration.endpoint.path).pipe(
          Effect.catchReason('PlatformError', 'NotFound', () => Effect.void),
          Effect.mapError(
            (error) =>
              new EndpointUnavailable({
                path: registration.endpoint.path,
                detail: `the endpoint could not be withdrawn: ${error.reason._tag}`,
              }),
          ),
        ),
    });
  }),
);
