import { Effect, Layer } from 'effect';
import { ThreadToolRegistry, type ThreadToolSource, type ThreadToolSourceRequest } from '../thread/ThreadPorts';
import { ThreadCallBroke, isThreadBorderFailure, type ThreadBorderFailed } from '../thread/ThreadBorder';
import { COLLABORATION_SOURCE, DeclaredCollaboration } from './CollaborationConfig';
import { COLLABORATION_TOOL_NAMES, collaborationTools } from './CollaborationTools';
import { collaborationHint } from './CollaborationVoice';
import { ThreadPlanes } from './ThreadPlanes';
import { Threads } from './threads';

const crossed = <A>(work: Effect.Effect<A, unknown>): Effect.Effect<A, ThreadBorderFailed> =>
  Effect.mapError(work, (failure) => (isThreadBorderFailure(failure) ? failure : new ThreadCallBroke({ cause: failure })));

export const collaborationSource = (
  tree: (typeof ThreadPlanes)['Service'],
  threads: (typeof Threads)['Service'],
  request: ThreadToolSourceRequest,
): Effect.Effect<ThreadToolSource | null, ThreadBorderFailed> =>
  crossed(
    Effect.gen(function* () {
      const thread = yield* threads.find(request.thread.id, request.thread.ownerId);
      if (thread === null) return null;
      const access = yield* tree.access(thread, request.run?.id);
      return access === null ? null : { id: COLLABORATION_SOURCE, tools: collaborationTools(access), prompt: collaborationHint(access) };
    }),
  );

const OWNER = '@runlith/agent/collaboration';

export const collaborationToolSourcesLayer: Layer.Layer<never, never, DeclaredCollaboration | ThreadToolRegistry | ThreadPlanes | Threads> =
  Layer.effectDiscard(
    Effect.gen(function* () {
      if ((yield* DeclaredCollaboration) === null) return;
      const registry = yield* ThreadToolRegistry;
      const tree = yield* ThreadPlanes;
      const threads = yield* Threads;
      yield* registry.hold({
        id: COLLABORATION_SOURCE,
        owner: OWNER,
        names: COLLABORATION_TOOL_NAMES,
        offer: (request) => collaborationSource(tree, threads, request),
      });
    }).pipe(Effect.orDie),
  );
