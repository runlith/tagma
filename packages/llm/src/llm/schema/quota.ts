import { Data, Schema } from 'effect';

export const QuotaWindowKind = Schema.Literals(['session', 'weekly', 'monthly', 'model', 'bucket']);
export type QuotaWindowKind = typeof QuotaWindowKind.Type;

export class QuotaWindow extends Schema.Class<QuotaWindow>('LLM.QuotaWindow')({
  kind: QuotaWindowKind,
  label: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  usedPercent: Schema.Number,
  windowMinutes: Schema.optional(Schema.Number),
  resetsAt: Schema.optional(Schema.Number),
}) {}

export const QuotaObservationSource = Schema.Literals(['reply', 'usage']);
export type QuotaObservationSource = typeof QuotaObservationSource.Type;

export class QuotaObservation extends Schema.Class<QuotaObservation>('LLM.QuotaObservation')({
  observedAt: Schema.Date,
  source: QuotaObservationSource,
  windows: Schema.Array(QuotaWindow),
  resetCredits: Schema.optional(Schema.Number),
  plan: Schema.optional(Schema.String),
}) {}

export class QuotaRateLimited extends Data.TaggedError('rate-limited')<{
  readonly retryAfterMs?: number;
}> {
  override get message() {
    return 'The provider rate-limited quota reading.';
  }
}

export class QuotaStaleToken extends Data.TaggedError('stale-token') {
  override get message() {
    return 'The provider refused the quota credential.';
  }
}

export class QuotaMissingScope extends Data.TaggedError('missing-scope')<{
  readonly scope: string;
}> {
  override get message() {
    return `The quota credential lacks ${this.scope}.`;
  }
}

export class QuotaServerFailure extends Data.TaggedError('server')<{
  readonly status: number;
}> {
  override get message() {
    return `The quota endpoint answered ${this.status}.`;
  }
}

export class QuotaTransportFailure extends Data.TaggedError('transport')<{
  readonly message: string;
}> {}

export class QuotaInvalidResponse extends Data.TaggedError('invalid-response')<{
  readonly message: string;
}> {}

export class QuotaUnavailable extends Data.TaggedError('unavailable')<{
  readonly reason: string;
}> {
  override get message() {
    return this.reason;
  }
}

export class QuotaUnsupported extends Data.TaggedError('unsupported') {
  override get message() {
    return 'The provider does not expose quota readings.';
  }
}

export const QuotaFailure = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal('rate-limited'), retryAfterMs: Schema.optional(Schema.Number) }),
  Schema.Struct({ _tag: Schema.Literal('stale-token') }),
  Schema.Struct({ _tag: Schema.Literal('missing-scope'), scope: Schema.String }),
  Schema.Struct({ _tag: Schema.Literal('server'), status: Schema.Number }),
  Schema.Struct({ _tag: Schema.Literal('transport'), message: Schema.String }),
  Schema.Struct({ _tag: Schema.Literal('invalid-response'), message: Schema.String }),
  Schema.Struct({ _tag: Schema.Literal('unsupported') }),
  Schema.Struct({ _tag: Schema.Literal('unavailable'), reason: Schema.String }),
]).pipe(Schema.toTaggedUnion('_tag'));
export type QuotaFailure = typeof QuotaFailure.Type;
