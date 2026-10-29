import { McpOAuthClient, McpOAuthServer, McpOAuthTokens } from '@runlith/mcp/grant';
import { Data, Effect, Schema } from 'effect';

export const SignInRecord = Schema.Struct({
  client: Schema.optional(McpOAuthClient),
  server: Schema.optional(McpOAuthServer),
  tokens: Schema.optional(McpOAuthTokens),
});
export type SignInRecord = typeof SignInRecord.Type;

export class SignInUnreadable extends Data.TaggedError('SignInUnreadable')<{ readonly key: string }> {
  override get message(): string {
    return `The sign-in kept for ${this.key} is not one this server reads.`;
  }
}

const decode = Schema.decodeUnknownEffect(SignInRecord);

export const recordOf = (key: string, stored: unknown): Effect.Effect<SignInRecord, SignInUnreadable> =>
  stored === undefined ? Effect.succeed({}) : Effect.mapError(decode(stored), () => new SignInUnreadable({ key }));

export const kept = (record: SignInRecord): SignInRecord | undefined =>
  record.client === undefined && record.server === undefined && record.tokens === undefined ? undefined : record;
