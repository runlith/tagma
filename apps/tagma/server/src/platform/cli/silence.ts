import { Schedule } from 'effect';
import * as HttpClientError from 'effect/http/HttpClientError';

const SERVER_ABORTED = 503;

export const AGAIN_AFTER_SILENCE = Schedule.spaced('1 second');

export const transportOf = (cause: unknown): HttpClientError.TransportError | null =>
  HttpClientError.isHttpClientError(cause) && cause.reason._tag === 'TransportError' ? cause.reason : null;

const abortedByServer = (cause: unknown): boolean =>
  HttpClientError.isHttpClientError(cause) && cause.reason._tag !== 'TransportError' && cause.response?.status === SERVER_ABORTED;

export const unanswered = (cause: unknown): boolean => transportOf(cause) !== null || abortedByServer(cause);
