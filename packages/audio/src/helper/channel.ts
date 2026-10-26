import { Context, Data, Effect, type Scope } from 'effect';
import * as Socket from 'effect/socket/Socket';

export class HelperAbsent extends Data.TaggedError('HelperAbsent')<{
  readonly reason: string;
  readonly unblock: ReadonlyArray<string>;
}> {}

export class HelperChannel extends Context.Service<
  HelperChannel,
  {
    readonly open: (token: string) => Effect.Effect<Socket.Socket, HelperAbsent, Scope.Scope>;
  }
>()('audio/HelperChannel') {}

export const receiving = <E>(
  socket: Socket.Socket,
  handle: (bytes: Uint8Array) => Effect.Effect<void, E> | void,
): Effect.Effect<never, E | Socket.SocketError> =>
  Effect.scoped(
    Effect.flatMap(Socket.readerBytes(socket), (pull) =>
      Effect.forever(Effect.flatMap(pull, (batch) => Effect.forEach(batch, (bytes) => handle(bytes) ?? Effect.void, { discard: true }))),
    ),
  );
