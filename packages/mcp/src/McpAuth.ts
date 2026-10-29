import { Data, type Effect } from 'effect';

export const MCP_NEEDS_SIGN_IN = 'needs-sign-in';

export class McpAuthUnavailable extends Data.TaggedError('McpAuthUnavailable')<{ readonly reason: string }> {
  override get message(): string {
    return this.reason;
  }
}

export type McpAuth = {
  readonly bearer: () => Effect.Effect<string | undefined, McpAuthUnavailable>;
  readonly rejected: (token: string) => Effect.Effect<string | typeof MCP_NEEDS_SIGN_IN, McpAuthUnavailable>;
};
