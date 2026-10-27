import { Deferred, Effect, type Scope } from 'effect';
import { McpPlaces } from '../mcp/contract/service/places.js';
import type { Coverage } from '../workspace/contract/service/roots.js';

type Bound = {
  readonly coverage: Coverage['Service'];
  readonly bases: readonly string[];
};

export const mcpPlaces = (): {
  readonly port: McpPlaces['Service'];
  readonly bind: (bound: Bound) => Effect.Effect<void, never, Scope.Scope>;
} => {
  let current = Deferred.makeUnsafe<Bound>();
  const listeners = new Set<(projectId: number) => void>();
  return {
    port: McpPlaces.of({
      of: Effect.fn('McpPlaces.of')(function* (projectId) {
        const { coverage, bases } = yield* Deferred.await(current);
        const read = yield* Effect.result(
          coverage
            .covered(projectId)
            .pipe(
              Effect.catchTag('ProjectRootsUnavailable', (refusal) =>
                refusal.reason === 'unestablished' || refusal.reason === 'moved' ? coverage.cover(projectId) : Effect.fail(refusal),
              ),
            ),
        );
        if (read._tag === 'Failure') {
          yield* Effect.logWarning('the MCP roots of a project stand without its checkouts: its coverage could not be read', {
            projectId,
            failure: read.failure,
          });
          return bases;
        }
        return [...read.success.roots.map((root) => root.path), ...bases];
      }),
      onMoved: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    }),
    bind: (bound) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          Deferred.doneUnsafe(current, Effect.succeed(bound));
          return bound.coverage.onCovered((projectId) => {
            for (const listener of listeners) listener(projectId);
          });
        }),
        (release) =>
          Effect.sync(() => {
            release();
            current = Deferred.makeUnsafe<Bound>();
          }),
      ),
  };
};
