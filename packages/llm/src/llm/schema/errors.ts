import { Data, Effect, Schema } from 'effect';
import { ModelID, ProviderID, ProviderMetadata, RouteID } from './ids';

export const ProviderFailureClassification = Schema.Literal('context-overflow');
export type ProviderFailureClassification = typeof ProviderFailureClassification.Type;

export const TransportFailureKind = Schema.Literals(['dns', 'tls', 'reset', 'connect-timeout', 'unknown']);
export type TransportFailureKind = typeof TransportFailureKind.Type;

export const WireFailureFamily = Schema.Union([
  Schema.Literals([
    'invalid-request',
    'no-route',
    'auth',
    'rate-limit',
    'quota',
    'content-policy',
    'overloaded',
    'refused',
    'torn-stream',
    'non-json-answer',
    'socket-closed',
    'clean-eof-no-finish',
    'blank-error',
    'invalid-output',
    'stalled',
  ]),
  TransportFailureKind,
]);
export type WireFailureFamily = typeof WireFailureFamily.Type;

const RETRYING_FAMILIES: ReadonlySet<WireFailureFamily> = new Set<WireFailureFamily>([
  'rate-limit',
  'overloaded',
  'torn-stream',
  'socket-closed',
  'clean-eof-no-finish',
  'blank-error',
  'dns',
  'tls',
  'reset',
  'connect-timeout',
  'unknown',
]);

export const familyRetries = (family: WireFailureFamily) => RETRYING_FAMILIES.has(family);

export const WireCause = Schema.Struct({
  tag: Schema.String,
  message: Schema.String,
  code: Schema.optional(Schema.String),
});
export type WireCause = typeof WireCause.Type;

export const WireLastEvent = Schema.Struct({
  type: Schema.optional(Schema.String),
  count: Schema.Number,
});
export type WireLastEvent = typeof WireLastEvent.Type;

export const WireAttemptFields = {
  status: Schema.optional(Schema.Number),
  upstreamRequestId: Schema.optional(Schema.String),
  attempt: Schema.optional(Schema.Number),
  bytesRead: Schema.optional(Schema.Number),
  elapsedMs: Schema.optional(Schema.Number),
  lastEvent: Schema.optional(WireLastEvent),
} as const;
export type WireAttempt = {
  readonly status?: number | undefined;
  readonly upstreamRequestId?: string | undefined;
  readonly attempt?: number | undefined;
  readonly bytesRead?: number | undefined;
  readonly elapsedMs?: number | undefined;
  readonly lastEvent?: WireLastEvent | undefined;
};

export const WIRE_CAUSE_DEPTH = 5;

export const WIRE_EXCERPT_LIMIT = 2_048;

export class HttpRequestDetails extends Schema.Class<HttpRequestDetails>('LLM.HttpRequestDetails')({
  method: Schema.String,
  url: Schema.String,
  headers: Schema.Record(Schema.String, Schema.String),
}) {}

export class HttpResponseDetails extends Schema.Class<HttpResponseDetails>('LLM.HttpResponseDetails')({
  status: Schema.Number,
  headers: Schema.Record(Schema.String, Schema.String),
}) {}

export const HttpRateLimitDetails = Schema.Struct({
  retryAfterMs: Schema.optional(Schema.Number),
  limit: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  remaining: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  reset: Schema.optional(Schema.Record(Schema.String, Schema.String)),
});
export type HttpRateLimitDetails = typeof HttpRateLimitDetails.Type;

export class HttpContext extends Schema.Class<HttpContext>('LLM.HttpContext')({
  request: HttpRequestDetails,
  response: Schema.optional(HttpResponseDetails),
  body: Schema.optional(Schema.String),
  bodyTruncated: Schema.optional(Schema.Boolean),
  bodyUnreadable: Schema.optional(Schema.String),
  requestId: Schema.optional(Schema.String),
  rateLimit: Schema.optional(HttpRateLimitDetails),
}) {}

export class InvalidRequestReason extends Schema.Class<InvalidRequestReason>('LLM.Error.InvalidRequest')({
  _tag: Schema.tag('InvalidRequest'),
  message: Schema.String,
  parameter: Schema.optional(Schema.String),
  classification: Schema.optional(ProviderFailureClassification),
  providerMetadata: Schema.optional(ProviderMetadata),
  http: Schema.optional(HttpContext),
  ...WireAttemptFields,
}) {
  get family(): WireFailureFamily {
    return 'invalid-request';
  }
}

export class NoRouteReason extends Schema.Class<NoRouteReason>('LLM.Error.NoRoute')({
  _tag: Schema.tag('NoRoute'),
  route: RouteID,
  provider: ProviderID,
  model: ModelID,
}) {
  get family(): WireFailureFamily {
    return 'no-route';
  }

  get message() {
    return `No LLM route for ${this.provider}/${this.model} using ${this.route}`;
  }
}

export class NotInstalledReason extends Schema.Class<NotInstalledReason>('LLM.Error.NotInstalled')({
  _tag: Schema.tag('NotInstalled'),
  provider: ProviderID,
}) {
  get family(): WireFailureFamily {
    return 'no-route';
  }

  get message() {
    return `No installed adapter provides ${this.provider}; install it to call its models.`;
  }
}

export class AdapterFailedReason extends Schema.Class<AdapterFailedReason>('LLM.Error.AdapterFailed')({
  _tag: Schema.tag('AdapterFailed'),
  provider: ProviderID,
  detail: Schema.String,
}) {
  get family(): WireFailureFamily {
    return 'refused';
  }

  get message() {
    return `The adapter providing ${this.provider} failed to load: ${this.detail}`;
  }
}

export class AuthenticationReason extends Schema.Class<AuthenticationReason>('LLM.Error.Authentication')({
  _tag: Schema.tag('Authentication'),
  message: Schema.String,
  kind: Schema.Literals(['missing', 'invalid', 'expired', 'insufficient-permissions', 'unknown']),
  providerMetadata: Schema.optional(ProviderMetadata),
  http: Schema.optional(HttpContext),
}) {
  get family(): WireFailureFamily {
    return 'auth';
  }
}

export class RateLimitReason extends Schema.Class<RateLimitReason>('LLM.Error.RateLimit')({
  _tag: Schema.tag('RateLimit'),
  message: Schema.String,
  retryAfterMs: Schema.optional(Schema.Number),
  rateLimit: Schema.optional(HttpRateLimitDetails),
  providerMetadata: Schema.optional(ProviderMetadata),
  http: Schema.optional(HttpContext),
}) {
  get family(): WireFailureFamily {
    return 'rate-limit';
  }
}

export class QuotaExceededReason extends Schema.Class<QuotaExceededReason>('LLM.Error.QuotaExceeded')({
  _tag: Schema.tag('QuotaExceeded'),
  message: Schema.String,
  resetsAt: Schema.optional(Schema.Number),
  providerMetadata: Schema.optional(ProviderMetadata),
  http: Schema.optional(HttpContext),
}) {
  get family(): WireFailureFamily {
    return 'quota';
  }
}

export class ContentPolicyReason extends Schema.Class<ContentPolicyReason>('LLM.Error.ContentPolicy')({
  _tag: Schema.tag('ContentPolicy'),
  message: Schema.String,
  providerMetadata: Schema.optional(ProviderMetadata),
  http: Schema.optional(HttpContext),
}) {
  get family(): WireFailureFamily {
    return 'content-policy';
  }
}

export class ProviderInternalReason extends Schema.Class<ProviderInternalReason>('LLM.Error.ProviderInternal')({
  _tag: Schema.tag('ProviderInternal'),
  message: Schema.String,
  retryAfterMs: Schema.optional(Schema.Number),
  modelStarted: Schema.optional(Schema.Boolean),
  providerMetadata: Schema.optional(ProviderMetadata),
  http: Schema.optional(HttpContext),
  ...WireAttemptFields,
}) {
  get family(): WireFailureFamily {
    return 'overloaded';
  }
}

export class TransportReason extends Schema.Class<TransportReason>('LLM.Error.Transport')({
  _tag: Schema.tag('Transport'),
  message: Schema.String,
  kind: TransportFailureKind.pipe(Schema.withConstructorDefault(Effect.succeed('unknown' as const))),
  host: Schema.optional(Schema.String),
  attempt: Schema.optional(Schema.Number),
  elapsedMs: Schema.optional(Schema.Number),
  cause: Schema.optional(Schema.Array(WireCause)),
  http: Schema.optional(HttpContext),
}) {
  get family(): WireFailureFamily {
    return this.kind;
  }
}

export class StreamStalledReason extends Schema.Class<StreamStalledReason>('LLM.Error.StreamStalled')({
  _tag: Schema.tag('StreamStalled'),
  message: Schema.String,
  idleMs: Schema.Number,
  url: Schema.optional(Schema.String),
  ...WireAttemptFields,
}) {
  get family(): WireFailureFamily {
    return 'stalled';
  }
}

export class InvalidProviderOutputReason extends Schema.Class<InvalidProviderOutputReason>('LLM.Error.InvalidProviderOutput')({
  _tag: Schema.tag('InvalidProviderOutput'),
  message: Schema.String,
  family: WireFailureFamily.pipe(Schema.withConstructorDefault(Effect.succeed('invalid-output' as const))),
  route: Schema.optional(Schema.String),
  excerpt: Schema.optional(Schema.String),
  ...WireAttemptFields,
  cause: Schema.optional(Schema.Array(WireCause)),
  providerMetadata: Schema.optional(ProviderMetadata),
}) {}

export class UnknownProviderReason extends Schema.Class<UnknownProviderReason>('LLM.Error.UnknownProvider')({
  _tag: Schema.tag('UnknownProvider'),
  message: Schema.String,
  modelStarted: Schema.optional(Schema.Boolean),
  providerMetadata: Schema.optional(ProviderMetadata),
  http: Schema.optional(HttpContext),
  ...WireAttemptFields,
}) {
  get family(): WireFailureFamily {
    return 'refused';
  }
}

export const LLMErrorReason = Schema.Union([
  InvalidRequestReason,
  NoRouteReason,
  NotInstalledReason,
  AdapterFailedReason,
  AuthenticationReason,
  RateLimitReason,
  QuotaExceededReason,
  ContentPolicyReason,
  ProviderInternalReason,
  TransportReason,
  StreamStalledReason,
  InvalidProviderOutputReason,
  UnknownProviderReason,
]).pipe(Schema.toTaggedUnion('_tag'));
export type LLMErrorReason = Schema.Schema.Type<typeof LLMErrorReason>;

export type ProviderSaid = { readonly message?: string; readonly code?: string };

const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined);

export const providerSaid = (body: string | undefined): ProviderSaid => {
  if (body === undefined || !body.trimStart().startsWith('{')) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (failure) {
    if (failure instanceof SyntaxError) return {};
    throw failure;
  }
  if (typeof parsed !== 'object' || parsed === null) return {};
  const answer = parsed as Record<string, unknown>;
  const error = typeof answer.error === 'object' && answer.error !== null ? (answer.error as Record<string, unknown>) : undefined;
  return {
    message: text(error?.message) ?? text(answer.message) ?? text(answer.error) ?? text(answer.error_description),
    code: text(error?.code) ?? text(answer.code),
  };
};

export const statusReason = (input: {
  readonly status: number;
  readonly message: string;
  readonly retryAfterMs?: number | undefined;
  readonly rateLimit?: HttpRateLimitDetails | undefined;
  readonly http?: HttpContext | undefined;
  readonly classification?: ProviderFailureClassification | undefined;
}): LLMErrorReason => {
  const body = input.http?.body ?? '';
  if (/content[-_\s]?policy|content_filter|safety/i.test(body)) {
    return new ContentPolicyReason({ message: input.message, http: input.http });
  }
  if (input.status === 401) {
    const said = providerSaid(input.http?.body);
    const expired = /expired/i.test(said.code ?? '');
    return new AuthenticationReason({ message: input.message, kind: expired ? 'expired' : 'invalid', http: input.http });
  }
  if (input.status === 403) {
    return new AuthenticationReason({ message: input.message, kind: 'insufficient-permissions', http: input.http });
  }
  if (input.status === 429) {
    if (/insufficient[-_\s]?quota|quota[-_\s]?exceeded|usage[-_\s]?limit[-_\s]?reached/i.test(body)) {
      return new QuotaExceededReason({ message: input.message, http: input.http });
    }
    return new RateLimitReason({
      message: input.message,
      retryAfterMs: input.retryAfterMs,
      rateLimit: input.rateLimit,
      http: input.http,
    });
  }
  if (input.status === 400 || input.status === 404 || input.status === 409 || input.status === 413 || input.status === 422) {
    return new InvalidRequestReason({ message: input.message, classification: input.classification, http: input.http });
  }
  if (input.status >= 500) {
    return new ProviderInternalReason({
      message: input.message,
      status: input.status,
      retryAfterMs: input.retryAfterMs,
      http: input.http,
    });
  }
  return new UnknownProviderReason({ message: input.message, status: input.status, http: input.http });
};

export class LLMError extends Data.TaggedError('LLM.Error')<{
  readonly module: string;
  readonly method: string;
  readonly reason: LLMErrorReason;
}> {
  override readonly cause = this.reason;

  get family(): WireFailureFamily {
    return this.reason.family;
  }

  get retryable() {
    return familyRetries(this.family);
  }

  get retryAfterMs() {
    return 'retryAfterMs' in this.reason ? this.reason.retryAfterMs : undefined;
  }

  get modelStarted() {
    return 'modelStarted' in this.reason ? this.reason.modelStarted : undefined;
  }

  get status() {
    if ('status' in this.reason && typeof this.reason.status === 'number') return this.reason.status;
    return 'http' in this.reason ? this.reason.http?.response?.status : undefined;
  }

  get detail(): string | undefined {
    const excerpt = 'excerpt' in this.reason ? this.reason.excerpt : undefined;
    const chain = ('cause' in this.reason ? (this.reason.cause ?? []) : []).map(
      (link) => `${link.tag}${link.code === undefined ? '' : ` [${link.code}]`}: ${link.message}`,
    );
    if (excerpt !== undefined || chain.length > 0)
      return [excerpt, ...chain].filter((part): part is string => part !== undefined && part !== '').join(' · ');
    if (!('http' in this.reason) || this.reason.http === undefined) return undefined;
    const http = this.reason.http;
    const status = http.response?.status;
    return [status === undefined ? undefined : `HTTP ${status}`, http.requestId, http.body]
      .filter((part): part is string => part !== undefined && part !== '')
      .join(' · ');
  }

  override get message() {
    return `${this.module}.${this.method}: ${this.reason.message}`;
  }
}

export const WireFailureRecord = Schema.Struct({
  family: WireFailureFamily,
  status: Schema.optional(Schema.Number),
  upstreamRequestId: Schema.optional(Schema.String),
  attempt: Schema.optional(Schema.Number),
  elapsedMs: Schema.optional(Schema.Number),
  bytesRead: Schema.optional(Schema.Number),
  lastEvent: Schema.optional(WireLastEvent),
  excerpt: Schema.optional(Schema.String),
  idleMs: Schema.optional(Schema.Number),
  host: Schema.optional(Schema.String),
  cause: Schema.optional(Schema.Array(WireCause)),
  kind: Schema.optional(Schema.String),
  said: Schema.optional(Schema.String),
});
export type WireFailureRecord = typeof WireFailureRecord.Type;

export const wireFailureRecord = (error: LLMError): WireFailureRecord => {
  const reason = error.reason;
  const http = 'http' in reason ? reason.http : undefined;
  const upstreamRequestId = ('upstreamRequestId' in reason ? reason.upstreamRequestId : undefined) ?? http?.requestId;
  const cause = 'cause' in reason ? reason.cause : undefined;
  return {
    family: error.family,
    status: error.status,
    upstreamRequestId,
    attempt: 'attempt' in reason ? reason.attempt : undefined,
    elapsedMs: 'elapsedMs' in reason ? reason.elapsedMs : undefined,
    bytesRead: 'bytesRead' in reason ? reason.bytesRead : undefined,
    lastEvent: 'lastEvent' in reason ? reason.lastEvent : undefined,
    excerpt: 'excerpt' in reason ? reason.excerpt : undefined,
    idleMs: 'idleMs' in reason ? reason.idleMs : undefined,
    host: 'host' in reason ? reason.host : undefined,
    cause: cause === undefined || cause.length === 0 ? undefined : cause,
    kind: 'kind' in reason ? reason.kind : undefined,
    said: providerSaid(http?.body).message,
  };
};

export class ToolFailure extends Data.TaggedError('LLM.ToolFailure')<{
  readonly message: string;
  readonly error?: unknown;
  readonly metadata?: Readonly<Record<string, unknown>>;
}> {}
