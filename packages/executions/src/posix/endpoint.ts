import { Effect, FileSystem, Layer } from 'effect';
import * as BunSocket from '@effect/platform-bun/BunSocket';
import { EndpointConnection } from '../EndpointConnection';
import { WireUnavailable } from '../Executions';

export const endpointConnection = Layer.effect(
  EndpointConnection,
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    return EndpointConnection.of({
      connect: Effect.fn('EndpointConnection.connect')(function* (registration) {
        const endpoint = registration.endpoint;
        const refused = (reason: string) => new WireUnavailable({ kind: 'invalid', reason, sent: false });
        if (endpoint.transport !== 'unix') {
          return yield* refused(`the POSIX connector cannot open ${endpoint.transport}`);
        }
        const cut = endpoint.path.lastIndexOf('/');
        const leaf = endpoint.path.slice(cut + 1);
        if (cut < 0 || leaf.length === 0 || leaf === '.' || leaf === '..') {
          return yield* refused(`the endpoint has no filename: ${endpoint.path}`);
        }
        const parent = yield* files
          .realPath(endpoint.path.slice(0, cut) || '/')
          .pipe(
            Effect.catchTag('PlatformError', (error) =>
              Effect.fail(refused(`the endpoint directory could not be resolved: ${error.reason._tag}`)),
            ),
          );
        const root = registration.state.endsWith('/') ? registration.state : `${registration.state}/`;
        if (parent !== registration.state && !parent.startsWith(root)) {
          return yield* refused(`the endpoint is named outside the state directory: ${endpoint.path}`);
        }
        return yield* BunSocket.makeNet({ path: endpoint.path });
      }),
    });
  }),
);
