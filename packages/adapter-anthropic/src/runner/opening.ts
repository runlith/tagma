import type { ContentBlock } from '@runlith/acp/content';
import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk';

export type Origin =
  | { readonly _tag: 'New' }
  | { readonly _tag: 'Resume'; readonly sessionId: string }
  | { readonly _tag: 'Fork'; readonly sessionId: string; readonly at: string | null };

export type Opening = {
  readonly id: string;
  readonly cwd: string;
  readonly directories: readonly string[];
  readonly servers: Readonly<Record<string, McpServerConfig>>;
  readonly origin: Origin;
  readonly recap: readonly ContentBlock[];
};
