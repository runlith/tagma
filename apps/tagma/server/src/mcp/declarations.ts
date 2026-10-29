import type { McpServerDeclaration } from '@runlith/mcp/declaration';
import type { McpServerState } from '@runlith/mcp/McpPool';
import { mcpDeclarationFingerprint } from '@runlith/mcp/mcpDeclarationFingerprint';
import { mcpRedactor } from '@runlith/mcp/mcpRedactor';
import type { McpServerReach, McpServerRow, McpSignInRow } from './contract/wire/servers.js';
import type { Resolved } from '../settings/contract/service/values.js';
import type { McpServerResolution } from './contract/service/servers.js';
import type { McpContribution } from './contract/service/contributions.js';

export type McpContributed = { readonly entries: readonly McpContribution[]; readonly off: readonly string[] };

const NOTHING_CONTRIBUTED: McpContributed = { entries: [], off: [] };

export function mcpDeclared(
  resolved: Resolved<readonly McpServerDeclaration[]>,
  contributed: McpContributed = NOTHING_CONTRIBUTED,
): readonly McpServerResolution[] {
  const own = resolved.layers.project;
  const user = own?.declined === true ? [] : (resolved.layers.user?.value ?? []);
  const project = own?.value ?? [];
  const off = new Set(contributed.off);
  const byName = new Map<string, McpServerResolution>();
  for (const { declaration, contributor, redact } of contributed.entries) {
    const enabled = declaration.enabled && !off.has(declaration.name);
    byName.set(declaration.name, { declaration: { ...declaration, enabled }, scope: 'contributed', contributor, redact });
  }
  for (const [scope, members] of [
    ['user', user],
    ['project', project],
  ] as const) {
    for (const declaration of members) {
      byName.set(declaration.name, { declaration, scope, shadows: byName.get(declaration.name)?.scope });
    }
  }
  return [...byName.values()];
}

export type Readied = {
  readonly declaration: McpServerDeclaration;
  readonly shown: McpServerDeclaration;
  readonly needs: readonly string[];
  readonly values: readonly string[];
};

export const readied = (resolved: McpServerResolution, resolve: Resolve): Readied =>
  resolved.scope === 'contributed'
    ? {
        declaration: resolved.declaration,
        shown: walkStrings(resolved.declaration, mcpRedactor(resolved.redact ?? [])),
        needs: [],
        values: resolved.redact ?? [],
      }
    : {
        declaration: expandEnvReferences(resolved.declaration, resolve),
        shown: resolved.declaration,
        needs: mcpMissingReferences(resolved.declaration, resolve),
        values: mcpResolvedValues(resolved.declaration, resolve),
      };

export function mcpDeclinedHere(resolved: Resolved<readonly McpServerDeclaration[]>): readonly McpServerResolution[] {
  const own = resolved.layers.project;
  if (own?.declined !== true) return [];
  const named = new Set((own.value ?? []).map((member) => member.name));
  return (resolved.layers.user?.value ?? []).flatMap((declaration) =>
    named.has(declaration.name) ? [] : [{ declaration, scope: 'user' as const }],
  );
}

export const declinedRowOf = (resolved: McpServerResolution, at: number): McpServerRow => ({
  name: resolved.declaration.name,
  scope: resolved.scope,
  reach: mcpReachOf(resolved.declaration),
  capabilities: resolved.declaration.capabilities,
  enabled: resolved.declaration.enabled,
  identity: mcpDeclarationFingerprint(resolved.declaration),
  status: 'declined',
  tools: 0,
  measuredAt: at,
});

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

export type Resolve = (name: string) => string | undefined;

export const rowOf = (
  resolved: McpServerResolution,
  state: McpServerState | undefined,
  at: number,
  ready: Readied,
  signIn?: McpSignInRow,
): McpServerRow => {
  const { declaration } = resolved;
  const declared = {
    name: declaration.name,
    scope: resolved.scope,
    reach: mcpReachOf(ready.shown),
    capabilities: declaration.capabilities,
    enabled: declaration.enabled,
    signIn,
    shadows: resolved.shadows,
    contributor: resolved.contributor,
  };
  const identity = mcpDeclarationFingerprint(ready.declaration);
  const needs = declaration.enabled ? ready.needs : [];
  if (needs.length > 0) return { ...declared, identity, status: 'needs-value', needs, tools: 0, measuredAt: at };
  const own = state !== undefined && state.identity === identity ? state : undefined;
  return own === undefined
    ? { ...declared, identity, status: declaration.enabled ? 'pending' : 'disabled', tools: 0, measuredAt: at }
    : {
        ...declared,
        identity,
        status: own.status,
        tools: own.tools,
        failure: own.failure === undefined ? undefined : own.failure.message,
        measuredAt: own.measuredAt,
      };
};

const REFERENCE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

const placesOf = (declaration: McpServerDeclaration): ReadonlyArray<readonly [string, string]> =>
  declaration.transport === 'stdio'
    ? [
        [declaration.command, 'the command'],
        ...(declaration.args ?? []).map((arg) => [arg, 'an argument'] as const),
        ...(declaration.cwd === undefined ? [] : [[declaration.cwd, 'the working directory'] as const]),
        ...Object.entries(declaration.env ?? {}).map(([key, value]) => [value, `the variable ${key}`] as const),
      ]
    : [
        [declaration.url, 'the URL'],
        ...Object.entries(declaration.headers ?? {}).map(([key, value]) => [value, `the header ${key}`] as const),
      ];

export function mcpReferences(declaration: McpServerDeclaration): ReadonlyMap<string, readonly string[]> {
  const named = new Map<string, string[]>();
  for (const [text, place] of placesOf(declaration)) {
    for (const match of text.matchAll(REFERENCE)) {
      const name = match[1] as string;
      const places = named.get(name) ?? [];
      if (!places.includes(place)) places.push(place);
      named.set(name, places);
    }
  }
  return named;
}

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

export function mcpMissingReferences(declaration: McpServerDeclaration, resolve: Resolve): readonly string[] {
  const named: string[] = [];
  walkStrings(declaration, (text) => {
    for (const match of text.matchAll(REFERENCE)) named.push(match[1] as string);
    return text;
  });
  return [...new Set(named.filter((name) => resolve(name) === undefined))];
}

export function mcpResolvedValues(declaration: McpServerDeclaration, resolve: Resolve): readonly string[] {
  const values = new Set<string>();
  walkStrings(declaration, (text) => {
    for (const match of text.matchAll(REFERENCE)) {
      const held = resolve(match[1] as string);
      if (held !== undefined && held.length > 0) values.add(held);
    }
    return text;
  });
  return [...values];
}

export function expandEnvReferences(declaration: McpServerDeclaration, resolve: Resolve): McpServerDeclaration {
  return walkStrings(declaration, (text) => text.replaceAll(REFERENCE, (whole, name: string) => resolve(name) ?? whole));
}
