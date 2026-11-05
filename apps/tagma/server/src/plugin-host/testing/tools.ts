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
];

export const fixtureEntries = (audiences: Readonly<Record<string, ToolAudience>>) =>
  FIXTURE_TOOLS.map((tool) => ({ ...tool, audience: audiences[tool.name] ?? 'tagma' }));
