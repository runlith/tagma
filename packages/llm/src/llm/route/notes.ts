import { body, note } from '@runlith/activity/Activity';
import { Effect } from 'effect';
import type { HttpClientRequest } from 'effect/http';

export type TransportNote =
  | {
      readonly type: 'http-started';
      readonly transportAttempt: number;
      readonly body: number | null;
      readonly method: string;
      readonly url: string;
      readonly cachePrefix?: string;
    }
  | {
      readonly type: 'http-responded';
      readonly request: number | null;
      readonly status: number;
      readonly afterMs: number;
      readonly upstreamRequestId?: string;
    }
  | {
      readonly type: 'http-failed';
      readonly request: number | null;
      readonly reason: string;
      readonly family: string;
      readonly retryable: boolean;
      readonly message: string;
      readonly afterMs: number;
      readonly status?: number;
      readonly upstreamRequestId?: string;
      readonly retryAfterMs?: number;
    }
  | {
      readonly type: 'stream-failed';
      readonly transportAttempt: number;
      readonly reason: string;
      readonly family: string;
      readonly retryable: boolean;
      readonly message: string;
      readonly afterMs: number;
      readonly status?: number;
      readonly upstreamRequestId?: string;
    }
  | { readonly type: 'retry-scheduled'; readonly transportAttempt: number; readonly delayMs: number }
  | {
      readonly type: 'client-configuration-failed';
      readonly call: string;
      readonly family: string;
      readonly message: string;
      readonly elapsedMs: number;
    };

export const noted = (fact: TransportNote): Effect.Effect<number | null> => note(fact);

export const sent = (request: HttpClientRequest.HttpClientRequest): Effect.Effect<number | null> =>
  request.body._tag === 'Uint8Array'
    ? body({ kind: 'request', encoded: request.body.body, contentType: request.body.contentType, series: true })
    : Effect.succeed(null);
