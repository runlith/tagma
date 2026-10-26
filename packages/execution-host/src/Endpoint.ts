import { Data, Context, type Effect, type Scope } from 'effect';
import type * as SocketServer from 'effect/socket/SocketServer';
import type { Registration } from '@runlith/executions/protocol/registration';

export class EndpointUnavailable extends Data.TaggedError('EndpointUnavailable')<{ readonly path: string; readonly detail: string }> {
  override get message(): string {
    return this.detail;
  }
}

export class Endpoint extends Context.Service<
  Endpoint,
  {
    readonly connectionExpense: number;
    readonly listen: (
      registration: Registration,
    ) => Effect.Effect<SocketServer.SocketServer['Service'], SocketServer.SocketServerError | EndpointUnavailable, Scope.Scope>;
    readonly withdraw: (registration: Registration) => Effect.Effect<void, EndpointUnavailable>;
  }
>()('@runlith/execution-host/Endpoint') {}
