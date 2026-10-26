import { Context, type Effect, Schema } from 'effect';
import type { LLMError } from '../schema/errors';
import type { LLMEvent } from '../schema/events';
import type { LLMRequest } from '../schema/messages';
import type { ProtocolID } from '../schema/ids';
import type { RateLimitHeaders } from './executor';

export interface Protocol<Body, Frame, Event, State> {
  readonly id: ProtocolID;
  readonly body: ProtocolBody<Body>;
  readonly stream: ProtocolStream<Frame, Event, State>;
  readonly rateLimits?: RateLimitHeaders;
  readonly inlineCacheHints?: boolean;
}

export interface ProtocolBody<Body> {
  readonly schema: Schema.Codec<Body, unknown>;
  readonly from: (request: LLMRequest) => Effect.Effect<Body, LLMError>;
  readonly cachePrefix?: (body: Body) => unknown;
}

export const CurrentCachePrefix = Context.Reference<string>('@runlith/llm/CurrentCachePrefix', {
  defaultValue: () => '',
});

export const CurrentAttempt = Context.Reference<number>('@runlith/llm/CurrentAttempt', {
  defaultValue: () => 0,
});

export interface ProtocolStream<Frame, Event, State> {
  readonly event: Schema.Codec<Event, Frame>;
  readonly initial: (request: LLMRequest) => State;
  readonly step: (state: State, event: Event) => Effect.Effect<readonly [State, ReadonlyArray<LLMEvent>], LLMError>;
  readonly terminal?: (event: Event) => boolean;
  readonly onHalt?: (state: State) => ReadonlyArray<LLMEvent>;
}

export const make = <Body, Frame, Event, State>(input: Protocol<Body, Frame, Event, State>): Protocol<Body, Frame, Event, State> => input;

export const jsonEvent = <const S extends Schema.Top>(schema: S) => Schema.fromJsonString(schema);
