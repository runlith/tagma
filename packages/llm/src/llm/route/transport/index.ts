import type { Effect, Scope, Stream } from 'effect';
import type { LLMError } from '../../schema/errors';
import type { LLMRequest } from '../../schema/messages';
import type { Auth } from '../auth';
import type { Endpoint } from '../endpoint';
import type { HttpExecutor, ReplyQuotaSink } from '../executor';
import type { WireReading } from '../wireReading';
import type { WebSocketTransport } from './websocket';

export interface TransportRuntime {
  readonly http: HttpExecutor['Service'];
  readonly webSocket?: WebSocketTransport['Service'];
}

export interface Transport<Body, Prepared, Frame> {
  readonly id: string;
  readonly prepare: (input: TransportPrepareInput<Body>) => Effect.Effect<Prepared, LLMError>;
  readonly frames: (
    prepared: Prepared,
    request: LLMRequest,
    runtime: TransportRuntime,
    lifetime: Scope.Scope,
    reading: WireReading,
    quota?: ReplyQuotaSink,
  ) => Stream.Stream<Frame, LLMError>;
}

export interface TransportPrepareInput<Body> {
  readonly body: Body;
  readonly request: LLMRequest;
  readonly endpoint: Endpoint<Body>;
  readonly auth: Auth;
  readonly encodeBody: (body: Body) => string;
  readonly headers?: (input: { readonly request: LLMRequest }) => Record<string, string>;
}
