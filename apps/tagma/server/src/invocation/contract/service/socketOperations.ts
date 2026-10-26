import { Context, Effect, Stream } from 'effect';
import type { FeedBody, FeedHandler } from '../../../platform/contract/wire/live.js';
import type { OperationId } from '../../../platform/contract/wire/ids.js';
import type { FeedDeclaration } from '../../../platform/contract/wire/operation.js';
import type { RefusalBody } from '../../../platform/contract/wire/refusal.js';

export class SocketOperations extends Context.Service<
  SocketOperations,
  {
    perform(id: OperationId, projectId: number, input: unknown, declaration: FeedDeclaration): Effect.Effect<unknown, RefusalBody>;
    admitFeed(declaration: FeedDeclaration, projectId: number | undefined): Effect.Effect<void, RefusalBody>;
  }
>()('tagma/invocation/SocketOperations') {}

export const bindFeed =
  (declaration: FeedDeclaration, handler: FeedHandler): FeedBody =>
  (params, ...rest) => {
    const admission = Effect.flatMap(SocketOperations, (operations) => operations.admitFeed(declaration, params.projectId));
    const handle = typeof handler === 'function' ? handler : handler.handle;
    if (declaration.stream !== false) {
      return Stream.unwrap(Effect.map(admission, () => handle(params, ...rest) as Stream.Stream<unknown, RefusalBody>));
    }
    const work = Effect.flatMap(admission, () => handle(params, ...rest) as Effect.Effect<unknown, RefusalBody>);
    return typeof handler === 'function' ? work : handler.turn(params, work);
  };
