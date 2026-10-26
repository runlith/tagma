import type { McpServerDeclaration } from '@runlith/mcp/declaration';
import type { McpServerState } from '@runlith/mcp/McpPool';
import { mcpDeclarationFingerprint } from '@runlith/mcp/mcpDeclarationFingerprint';
import type { McpServerReach, McpServerRow } from './contract/wire/servers.js';
import type { Resolved } from '../settings/contract/service/values.js';
import type { McpServerResolution } from './contract/service/servers.js';

export function mcpDeclared(resolved: Resolved<readonly McpServerDeclaration[]>): readonly McpServerResolution[] {
  const own = resolved.layers.project;
  const user = own?.declined === true ? [] : (resolved.layers.user?.value ?? []);
  const project = own?.value ?? [];
  const byName = new Map<string, McpServerResolution>();
  for (const [scope, declarations] of [
    ['user', user],
    ['project', project],
  ] as const) {
    for (const declaration of declarations) {
      byName.set(declaration.name, byName.has(declaration.name) ? { declaration, scope, shadows: 'user' } : { declaration, scope });
    }
  }
  return [...byName.values()];
}

export function mcpReachOf(declaration: McpServerDeclaration): McpServerReach {
  return declaration.transport === 'stdio'
    ? {
        transport: 'stdio',
        command: declaration.command,
        args: declaration.args,
        cwd: declaration.cwd,
        env: Object.keys(declaration.env ?? {}).sort(),
      }
    : { transport: 'http', url: declaration.url, headers: Object.keys(declaration.headers ?? {}).sort() };
}

export const rowOf = (
  resolved: McpServerResolution,
  state: McpServerState | undefined,
  at: number,
  environment: Readonly<Record<string, string | undefined>>,
): McpServerRow => {
  const { declaration } = resolved;
  const declared = {
    name: declaration.name,
    scope: resolved.scope,
    reach: mcpReachOf(declaration),
    capabilities: declaration.capabilities,
    enabled: declaration.enabled,
  };
  const identity = mcpDeclarationFingerprint(expandEnvReferences(declaration, environment));
  const own = state !== undefined && state.identity === identity ? state : undefined;
  return own === undefined
    ? {
        ...declared,
        identity,
        shadows: resolved.shadows,
        status: declaration.enabled ? 'pending' : 'disabled',
        tools: 0,
        measuredAt: at,
      }
    : {
        ...declared,
        identity,
        shadows: resolved.shadows,
        status: own.status,
        tools: own.tools,
        failure: own.failure === undefined ? undefined : own.failure.message,
        measuredAt: own.measuredAt,
      };
};

const REFERENCE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

function walkStrings<T>(value: T, visit: (text: string) => string): T {
  if (typeof value === 'string') return visit(value) as T;
  if (Array.isArray(value)) return value.map((entry) => walkStrings(entry, visit)) as T;
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, walkStrings(entry, visit)]),
    ) as T;
  }
  return value;
}

export function mcpMissingReferences(
  declaration: McpServerDeclaration,
  environment: Readonly<Record<string, string | undefined>>,
): readonly string[] {
  const named: string[] = [];
  walkStrings(declaration, (text) => {
    for (const match of text.matchAll(REFERENCE)) named.push(match[1] as string);
    return text;
  });
  return [...new Set(named.filter((name) => environment[name] === undefined))];
}

export function mcpResolvedValues(
  declaration: McpServerDeclaration,
  environment: Readonly<Record<string, string | undefined>>,
): readonly string[] {
  const values = new Set<string>();
  walkStrings(declaration, (text) => {
    for (const match of text.matchAll(REFERENCE)) {
      const held = environment[match[1] as string];
      if (held !== undefined && held.length > 0) values.add(held);
    }
    return text;
  });
  return [...values];
}

export function expandEnvReferences(
  declaration: McpServerDeclaration,
  environment: Readonly<Record<string, string | undefined>>,
): McpServerDeclaration {
  return walkStrings(declaration, (text) => text.replaceAll(REFERENCE, (whole, name: string) => environment[name] ?? whole));
}
