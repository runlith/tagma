import type { RefusalWords } from '../../../platform/contract/wire/manifest.js';

export const REFUSAL_WORDS = {
  'mcp-call-failed': 'MCP call failed',
  'mcp-reconcile-stalled': 'MCP servers did not settle',
  'mcp-resource-failed': 'MCP resource failed',
  'mcp-server-exists': 'MCP server already declared',
  'mcp-server-replaced': 'MCP server changed meanwhile',
  'mcp-server-unavailable': 'MCP server unavailable',
  'mcp-server-unknown': 'Unknown MCP server',
  'mcp-sign-in-failed': 'MCP sign-in failed',
  'mcp-sign-in-unserved': 'No sign-in callback on this door',
  'mcp-sign-in-unsupported': 'MCP server cannot sign in',
  'mcp-tool-unoffered': 'Tool not offered to views',
} as const satisfies RefusalWords;
