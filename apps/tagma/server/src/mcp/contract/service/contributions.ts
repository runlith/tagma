import type { McpServerDeclaration } from '@runlith/mcp/declaration';
import { Context, Data, type Effect, type Stream } from 'effect';

export type McpContribution = {
  readonly declaration: McpServerDeclaration;
  readonly contributor: string;
  readonly local: string;
  readonly redact: readonly string[];
};

export class McpContributionsUnreadable extends Data.TaggedError('McpContributionsUnreadable')<{ readonly reason: string }> {
  override get message(): string {
    return this.reason;
  }
}

export class McpContributions extends Context.Service<
  McpContributions,
  {
    of(projectId: number): Effect.Effect<readonly McpContribution[], McpContributionsUnreadable>;
    readonly changes: Stream.Stream<number | null>;
  }
>()('tagma/mcp/McpContributions') {}
