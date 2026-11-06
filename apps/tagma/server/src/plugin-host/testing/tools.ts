import type { McpServedTool } from '@runlith/mcp/server';
import type { ToolAudience } from '../contract/wire/audience.js';

const object = { type: 'object' as const, properties: {} };

export const FIXTURE_TOOLS: readonly McpServedTool[] = [
  { name: 'look', description: 'Answers what the caller sees.', inputSchema: object, annotations: { readOnlyHint: true } },
  { name: 'act', description: 'Acts.', inputSchema: object },
  { name: 'deal', description: 'Deals.', inputSchema: object },
  { name: 'pid', description: 'Answers this process id.', inputSchema: object, annotations: { readOnlyHint: true } },
  { name: 'environment', description: 'Answers the variables Tagma handed this process.', inputSchema: object },
  { name: 'crash', description: 'Ends this process at once.', inputSchema: object },
  { name: 'slow', description: 'Answers after a while.', inputSchema: object },
  { name: 'hold', description: 'Answers once the release file stands in the data directory.', inputSchema: object },
  { name: 'ended', description: 'Takes the end of a turn of a thread bound to this plugin.', inputSchema: object },
  { name: 'asked', description: 'Takes a question of a thread bound to this plugin.', inputSchema: object },
  { name: 'hook', description: 'Denies the tool call it is asked about.', inputSchema: object },
];

export const KEYED_TOOLS: readonly McpServedTool[] = [
  { name: 'length', description: 'Answers how long the API_TOKEN given to this process is.', inputSchema: object },
  { name: 'reveal', description: 'Answers the API_TOKEN given to this process.', inputSchema: object },
  { name: 'keyed', description: 'Answers a structure keyed by the API_TOKEN.', inputSchema: object },
];

export const fixtureEntries = (audiences: Readonly<Record<string, ToolAudience>>, tools: readonly McpServedTool[] = FIXTURE_TOOLS) =>
  tools.map((tool) => ({ ...tool, audience: audiences[tool.name] ?? 'tagma' }));
