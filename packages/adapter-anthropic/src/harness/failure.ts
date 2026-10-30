import type { SDKAssistantMessageError } from '@anthropic-ai/claude-agent-sdk';
import { familyRetries, statusReason, type WireFailureFamily } from '@runlith/llm/schema/errors';
import type { TransportFailure } from '@runlith/agent/transcript/entries';

type Class = { readonly type: string; readonly family: WireFailureFamily };

const RATE_LIMIT: Class = { type: 'RateLimit', family: 'rate-limit' };
const OVERLOADED: Class = { type: 'ProviderInternal', family: 'overloaded' };
const AUTH: Class = { type: 'Authentication', family: 'auth' };
const QUOTA: Class = { type: 'QuotaExceeded', family: 'quota' };
const INVALID: Class = { type: 'InvalidRequest', family: 'invalid-request' };
const NO_ROUTE: Class = { type: 'NoRoute', family: 'no-route' };
const UNKNOWN: Class = { type: 'Transport', family: 'unknown' };

const ERRORS: Partial<Record<SDKAssistantMessageError, Class>> = {
  rate_limit: RATE_LIMIT,
  overloaded: OVERLOADED,
  authentication_failed: AUTH,
  oauth_org_not_allowed: AUTH,
  cloud_credential_error: AUTH,
  billing_error: QUOTA,
  account_on_hold: QUOTA,
  invalid_request: INVALID,
  model_not_found: NO_ROUTE,
};

const STATUSES: Readonly<Record<number, Class>> = {
  429: RATE_LIMIT,
  529: OVERLOADED,
  401: AUTH,
  403: AUTH,
  400: INVALID,
  404: NO_ROUTE,
};

const classOf = (error: SDKAssistantMessageError | null, status: number | null): Class | null => {
  const named = error === null ? undefined : ERRORS[error];
  if (named !== undefined) return named;
  const answered = status ?? (error === 'server_error' ? 500 : null);
  if (answered !== null) {
    const listed = STATUSES[answered];
    if (listed !== undefined) return listed;
    const reason = statusReason({ status: answered, message: '' });
    return { type: reason._tag, family: reason.family };
  }
  return error === null ? null : UNKNOWN;
};

export const retryFamilyOf = (error: SDKAssistantMessageError, status: number | null): WireFailureFamily =>
  status === null && ERRORS[error] === undefined ? 'connect-timeout' : (classOf(error, status)?.family ?? 'unknown');

export type Failing = {
  readonly error: SDKAssistantMessageError | null;
  readonly status: number | null;
  readonly modelStarted: boolean;
  readonly rejectedUntil: number | null;
  readonly at: number;
};

export const stopFailureOf = (event: Record<string, unknown>): TransportFailure | null => {
  const known = typeof event.error === 'string' ? classOf(event.error as SDKAssistantMessageError, null) : null;
  if (known === null) return null;
  return {
    stage: 'claude-code.stop',
    type: known.type,
    retryable: familyRetries(known.family),
    modelStarted: null,
    reason: { family: known.family },
  };
};

export const failureOf = (failing: Failing): TransportFailure | null => {
  const known = classOf(failing.error, failing.status);
  if (known === null) return null;
  const status = failing.status ?? undefined;
  return {
    stage: 'claude-code.turn',
    type: known.type,
    httpStatus: status,
    retryable: familyRetries(known.family),
    modelStarted: failing.modelStarted,
    rateLimit: failing.rejectedUntil === null ? undefined : { retryAfterMs: Math.max(0, failing.rejectedUntil - failing.at) },
    reason: { family: known.family, status },
  };
};
