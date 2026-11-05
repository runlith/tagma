import type { Tool } from './tool';

export type ToolCatalog = Record<string, Tool>;

export function mergeToolCatalogs(...catalogs: readonly ToolCatalog[]): ToolCatalog {
  const merged: ToolCatalog = {};
  for (const [name, value] of catalogs.flatMap((catalog) => Object.entries(catalog))) {
    if (merged[name]) throw new Error(`Duplicate agent tool: ${name}.`);
    merged[name] = value;
  }
  return merged;
}

export function visibleOutputToolNames(catalog: ToolCatalog): ReadonlySet<string> {
  return new Set(Object.entries(catalog).flatMap(([name, tool]) => (tool.userVisible || tool.mutates ? [name] : [])));
}

export const DISPATCH_TOOL = 'call_tool';

export function deferredToolNames(catalog: ToolCatalog): ReadonlySet<string> {
  return new Set(Object.entries(catalog).flatMap(([name, tool]) => (tool.exposure === 'deferred' ? [name] : [])));
}
