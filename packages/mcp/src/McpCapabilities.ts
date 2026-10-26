import { PERMISSION_KINDS, type PermissionSubject } from '@runlith/agent/permissions';
import { Schema } from 'effect';

const kinds = Schema.Array(Schema.Literals(PERMISSION_KINDS)).check(Schema.isUnique());

export const McpToolCapabilities = Schema.Struct({
  kinds,
  mutates: Schema.Boolean,
});
export type McpToolCapabilities = typeof McpToolCapabilities.Type;

export const McpCapabilities = Schema.Struct({
  kinds,
  mutates: Schema.Boolean,
  tools: Schema.optional(Schema.Record(Schema.String, McpToolCapabilities)),
});
export type McpCapabilities = typeof McpCapabilities.Type;

export function mcpToolCapabilities(tool: string, capabilities: McpCapabilities): McpToolCapabilities {
  const declared = capabilities.tools;
  const own = declared !== undefined && Object.hasOwn(declared, tool) ? declared[tool] : undefined;
  return own ?? { kinds: capabilities.kinds, mutates: capabilities.mutates };
}
