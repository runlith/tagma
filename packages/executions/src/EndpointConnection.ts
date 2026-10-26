import { Context, type Effect, type Scope } from 'effect';
import type * as Socket from 'effect/socket/Socket';
import type { WireUnavailable } from './Executions';
import type { Registration } from './protocol/registration';

export class EndpointConnection extends Context.Service<
  EndpointConnection,
  {
    readonly connect: (registration: Registration) => Effect.Effect<Socket.Socket, WireUnavailable | Socket.SocketError, Scope.Scope>;
  }
>()('@runlith/executions/EndpointConnection') {}
