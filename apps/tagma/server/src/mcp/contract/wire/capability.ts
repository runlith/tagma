import type { CapabilityDeclaration } from '../../../platform/contract/wire/capability.js';

export const mcpCapability = {
  id: 'mcp',
  description: "the project's MCP servers: their tools, and declaring, switching or removing one",
  sections: ['mcp-servers'],
} as const satisfies CapabilityDeclaration;
