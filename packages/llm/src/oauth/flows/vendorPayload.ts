import { Data, Effect, Schema } from 'effect';
import { isSensitiveName, redactSecrets, secretsOf } from '../../redact';
import { VENDOR_CALL_TIMEOUT_MS } from '../../vendorCall';

export class OAuthFlowFailed extends Data.TaggedError('OAuthFlowFailed')<{
  readonly reason: string;
  readonly cause?: unknown;
  readonly status?: number;
}> {
  override get message(): string {
    return this.reason;
  }
}

export function withOAuthVendorCallTimeout<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  label: string,
): Effect.Effect<A, E | OAuthFlowFailed, R> {
  return effect.pipe(
    Effect.timeoutOrElse({
      duration: VENDOR_CALL_TIMEOUT_MS,
      orElse: () =>
        Effect.fail(
          new OAuthFlowFailed({
            reason: `${label} timed out after ${VENDOR_CALL_TIMEOUT_MS}ms`,
          }),
        ),
    }),
  );
}

const OAUTH_SECRET_FIELD = /^(code|code_verifier|device_code|client_secret|assertion)$/i;

export function readableVendorAnswer(text: string, sent: Record<string, string> = {}): string {
  return redactSecrets(
    text,
    secretsOf(Object.entries(sent), (name) => isSensitiveName(name) || OAUTH_SECRET_FIELD.test(name)),
  );
}

export function oauthFailure(error: unknown): OAuthFlowFailed {
  if (error instanceof OAuthFlowFailed) return error;
  return new OAuthFlowFailed({ reason: error instanceof Error ? error.message : String(error), cause: error });
}

export const oauthErrorSchema = Schema.Struct({
  error: Schema.optional(Schema.String),
  error_description: Schema.optional(Schema.String),
});

export type OAuthErrorPayload = typeof oauthErrorSchema.Type;

const decodeOAuthError = Schema.decodeUnknownResult(oauthErrorSchema);

export const vendorSeconds = Schema.optional(Schema.Union([Schema.Finite, Schema.FiniteFromString]));

const ERROR_BODY_EXCERPT = 200;

export function parseVendorPayload<S extends Schema.Codec<any, unknown, never, never>>(
  schema: S,
  text: string,
  what: string,
  sent: Record<string, string> = {},
): S['Type'] {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    const excerpt = readableVendorAnswer(text.trim(), sent).slice(0, ERROR_BODY_EXCERPT);
    throw new Error(`${what} is not JSON: ${excerpt || '(empty body)'}`);
  }
  const parsed = Schema.decodeUnknownResult(schema)(json);
  if (parsed._tag !== 'Success') {
    throw new Error(`${what} does not match the shape the endpoint documents — ${readableVendorAnswer(parsed.failure.message, sent)}`);
  }
  return parsed.success;
}

export function readOAuthError(text: string, sent: Record<string, string> = {}): OAuthErrorPayload {
  try {
    const parsed = decodeOAuthError(JSON.parse(text));
    if (parsed._tag !== 'Success')
      return {
        error_description: `The OAuth error answer has an invalid shape: ${readableVendorAnswer(parsed.failure.message, sent).slice(0, ERROR_BODY_EXCERPT)}`,
      };
    const description = parsed.success.error_description;
    return {
      ...parsed.success,
      error_description: description === undefined ? undefined : readableVendorAnswer(description, sent),
    };
  } catch {
    return {
      error_description: `The OAuth error answer is not JSON: ${readableVendorAnswer(text.trim(), sent).slice(0, ERROR_BODY_EXCERPT) || '(empty body)'}`,
    };
  }
}
