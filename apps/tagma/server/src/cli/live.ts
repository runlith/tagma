import { Cause, Effect, Exit, Layer } from 'effect';
import { type Rpc, RpcClient, type RpcClientError, type RpcGroup } from 'effect/rpc';
import { Socket } from 'effect/socket';
import { CurrentInvocation, type Invocation } from '../platform/cli/verb.js';
import { liveSerialization } from '../platform/contract/wire/live.js';

export type LiveWire<Rpcs extends Rpc.Any> = {
  readonly group: RpcGroup.RpcGroup<Rpcs>;
  readonly path: string;
  readonly baseUrl: (at: Invocation) => string;
  readonly headers: (at: Invocation) => Readonly<Record<string, string>>;
};

function wire<Rpcs extends Rpc.Any>(at: Invocation, live: LiveWire<Rpcs>): Layer.Layer<RpcClient.Protocol> {
  const url = new URL(live.path, live.baseUrl(at));
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return RpcClient.layerProtocolSocket().pipe(
    Layer.provide(Socket.layerWebSocket(url.toString())),
    Layer.provide([
      liveSerialization,
      Layer.succeed(
        Socket.WebSocketConstructor,
        (url, protocols) =>
          new WebSocket(url, {
            protocols: typeof protocols === 'string' || Array.isArray(protocols) ? protocols : undefined,
            headers: live.headers(at),
          }),
      ),
    ]),
  );
}

export const askLive = Effect.fnUntraced(function* <Rpcs extends Rpc.Any, A, R>(
  live: LiveWire<Rpcs>,
  work: (client: RpcClient.RpcClient<Rpcs, RpcClientError.RpcClientError>) => Effect.Effect<A, unknown, R>,
): Effect.fn.Return<A, never, R> {
  const at = yield* CurrentInvocation;
  const outcome = yield* Effect.exit(
    Effect.scoped(
      Effect.flatMap(Layer.build(wire(at, live)), (built) => Effect.provide(RpcClient.make(live.group), built)).pipe(Effect.flatMap(work)),
    ),
  );
  if (Exit.isFailure(outcome)) return yield* Effect.die(Cause.squash(outcome.cause));
  return outcome.value;
});
