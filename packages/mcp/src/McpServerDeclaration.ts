import { Schema } from 'effect';
import { McpCapabilities } from './McpCapabilities';

export const MCP_SERVER_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]|_(?!_))*[a-z0-9-]$|^[a-z0-9]$/u;

const shared = {
  version: Schema.optional(Schema.Literal(1)),
  name: Schema.String.check(Schema.isPattern(MCP_SERVER_NAME_PATTERN)),
  capabilities: McpCapabilities,
  enabled: Schema.Boolean,
  timeoutMs: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0))),
  maxCatalogBytes: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0))),
};

export const McpStdioServerDeclaration = Schema.Struct({
  ...shared,
  transport: Schema.Literal('stdio'),
  command: Schema.String,
  args: Schema.optional(Schema.Array(Schema.String)),
  cwd: Schema.optional(Schema.String),
  env: Schema.optional(Schema.Record(Schema.String, Schema.String)),
});
export type McpStdioServerDeclaration = typeof McpStdioServerDeclaration.Type;

export const McpHttpServerDeclaration = Schema.Struct({
  ...shared,
  transport: Schema.Literal('http'),
  url: Schema.String,
  headers: Schema.optional(Schema.Record(Schema.String, Schema.String)),
});
export type McpHttpServerDeclaration = typeof McpHttpServerDeclaration.Type;

export const McpServerDeclaration = Schema.Union([McpStdioServerDeclaration, McpHttpServerDeclaration]);
export type McpServerDeclaration = typeof McpServerDeclaration.Type;

export const MCP_RESOLVING_ENV_KEYS = [
  'PATH',
  'LD_PRELOAD',
  'LD_LIBRARY_PATH',
  'LD_AUDIT',
  'DYLD_INSERT_LIBRARIES',
  'DYLD_LIBRARY_PATH',
  'DYLD_FRAMEWORK_PATH',
  'BASH_ENV',
  'ENV',
  'NODE_OPTIONS',
  'PYTHONPATH',
  'PYTHONHOME',
  'PYTHONSTARTUP',
  'PERL5OPT',
  'PERL5LIB',
  'RUBYOPT',
  'RUBYLIB',
  'CLASSPATH',
  'JAVA_TOOL_OPTIONS',
  '_JAVA_OPTIONS',
  'JDK_JAVA_OPTIONS',
  'LUA_PATH',
  'LUA_CPATH',
] as const;

export function mcpResolvingEnvKeys(env: Readonly<Record<string, string>> | undefined): readonly string[] {
  if (env === undefined) return [];
  return Object.keys(env).filter((key) => (MCP_RESOLVING_ENV_KEYS as readonly string[]).includes(key));
}

const sameStrings = (a: readonly string[] | undefined, b: readonly string[] | undefined): boolean =>
  a === undefined || b === undefined ? a === b : a.length === b.length && a.every((value, at) => value === b[at]);

const sameRecord = (a: Readonly<Record<string, string>> | undefined, b: Readonly<Record<string, string>> | undefined): boolean => {
  if (a === undefined || b === undefined) return a === b;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
};

const sameKinds = (a: readonly string[], b: readonly string[]): boolean => {
  const own = new Set(a);
  const other = new Set(b);
  return own.size === other.size && [...own].every((kind) => other.has(kind));
};

const sameCapabilities = (a: McpCapabilities, b: McpCapabilities): boolean => {
  if (a.mutates !== b.mutates || !sameKinds(a.kinds, b.kinds)) return false;
  if (a.tools === undefined || b.tools === undefined) return a.tools === b.tools;
  const tools = Object.keys(a.tools);
  if (tools.length !== Object.keys(b.tools).length) return false;
  return tools.every((tool) => {
    const own = a.tools?.[tool];
    const other = b.tools?.[tool];
    return own !== undefined && other !== undefined && own.mutates === other.mutates && sameKinds(own.kinds, other.kinds);
  });
};

export function mcpDeclarationsEqual(a: McpServerDeclaration, b: McpServerDeclaration): boolean {
  if (a.name !== b.name || a.enabled !== b.enabled || a.timeoutMs !== b.timeoutMs) return false;
  if (a.maxCatalogBytes !== b.maxCatalogBytes) return false;
  if (!sameCapabilities(a.capabilities, b.capabilities)) return false;
  if (a.transport === 'stdio') {
    return b.transport === 'stdio' && a.command === b.command && sameStrings(a.args, b.args) && a.cwd === b.cwd && sameRecord(a.env, b.env);
  }
  return b.transport === 'http' && a.url === b.url && sameRecord(a.headers, b.headers);
}
