import { Result, Schema } from 'effect';
import type { SessionUpdate } from '@runlith/acp/updates';
import { MEASURED, type Measured } from '@runlith/hosted-runner/wire/extensions';
import type { Settings } from './settings.js';
import type { Spend } from './spend.js';

const Count = Schema.optionalKey(Schema.NullOr(Schema.Number));

const Written = Schema.Struct({ ephemeral_5m_input_tokens: Schema.Number, ephemeral_1h_input_tokens: Schema.Number });

const Started = Schema.Struct({
  message: Schema.Struct({
    id: Schema.String,
    usage: Schema.Struct({
      input_tokens: Schema.Number,
      output_tokens: Schema.Number,
      cache_read_input_tokens: Count,
      cache_creation_input_tokens: Count,
      cache_creation: Schema.optionalKey(Schema.NullOr(Written)),
    }),
  }),
});

const Delta = Schema.Struct({
  usage: Schema.Struct({
    output_tokens: Schema.Number,
    output_tokens_details: Schema.optionalKey(Schema.NullOr(Schema.Struct({ thinking_tokens: Count }))),
  }),
});

const decodeStarted = Schema.decodeUnknownResult(Started);
const decodeDelta = Schema.decodeUnknownResult(Delta);

const FIVE_MINUTES = 300;
const HOUR = 3_600;

type Open = {
  readonly message: string;
  readonly sentAt: string;
  readonly input: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  output: number;
  reasoning: number | null;
};

const typeOf = (event: unknown): unknown =>
  typeof event === 'object' && event !== null && 'type' in event ? (event as { readonly type: unknown }).type : null;

const lifetimeOf = (written: typeof Written.Type | null | undefined): number | null => {
  if (written == null) return null;
  if (written.ephemeral_5m_input_tokens > 0) return FIVE_MINUTES;
  return written.ephemeral_1h_input_tokens > 0 ? HOUR : null;
};

export class Meter {
  private handed: number | null = null;
  private lifetime: number | null = null;
  private open: Open | null = null;
  private attempt = 0;

  constructor(
    private readonly settings: Settings,
    private readonly spend: Spend,
  ) {}

  heard(at: number): void {
    this.handed = at;
  }

  retried(attempt: number): void {
    this.attempt = attempt;
  }

  streamed(event: unknown, at: number): SessionUpdate | null {
    switch (typeOf(event)) {
      case 'message_start':
        this.started(event, at);
        return null;
      case 'message_delta':
        this.delta(event);
        return null;
      case 'message_stop':
        return this.stopped(at);
      default:
        return null;
    }
  }

  private started(event: unknown, at: number): void {
    const decoded = decodeStarted(event);
    if (Result.isFailure(decoded)) {
      this.open = null;
      return;
    }
    const usage = decoded.success.message.usage;
    const cacheRead = usage.cache_read_input_tokens ?? 0;
    const cacheWrite = usage.cache_creation_input_tokens ?? 0;
    this.lifetime = lifetimeOf(usage.cache_creation) ?? this.lifetime;
    this.open = {
      message: decoded.success.message.id,
      sentAt: new Date(this.handed ?? at).toISOString(),
      input: usage.input_tokens + cacheRead + cacheWrite,
      cacheRead,
      cacheWrite,
      output: usage.output_tokens,
      reasoning: null,
    };
  }

  private delta(event: unknown): void {
    const open = this.open;
    const decoded = decodeDelta(event);
    if (open === null || Result.isFailure(decoded)) return;
    open.output = decoded.success.usage.output_tokens;
    open.reasoning = decoded.success.usage.output_tokens_details?.thinking_tokens ?? open.reasoning;
  }

  private stopped(at: number): SessionUpdate | null {
    const open = this.open;
    const window = this.settings.window;
    this.open = null;
    this.heard(at);
    if (open === null) return null;
    const measured: Measured = { ...open, ttlSeconds: this.lifetime, ...(this.attempt > 0 ? { attempt: this.attempt } : {}) };
    this.attempt = 0;
    this.spend.requested(measured);
    return { sessionUpdate: 'usage_update', used: open.input + open.output, size: window ?? 0, _meta: { [MEASURED]: measured } };
  }
}
