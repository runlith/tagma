import type { ToolDefinition, VendorWire } from '../../schema/messages';

export const wireKey = (name: string, namespace: string | undefined): string => `${namespace ?? ''}\u0000${name}`;

export const vendorWires = (tools: readonly ToolDefinition[]): ReadonlyMap<string, VendorWire> =>
  new Map(tools.flatMap((tool) => (tool.vendorWire === undefined ? [] : [[tool.name, tool.vendorWire] as const])));

export const catalogNames = (tools: readonly ToolDefinition[]): ReadonlyMap<string, string> =>
  new Map(
    tools.flatMap((tool) =>
      tool.vendorWire === undefined ? [] : [[wireKey(tool.vendorWire.name, tool.vendorWire.namespace?.name), tool.name] as const],
    ),
  );
