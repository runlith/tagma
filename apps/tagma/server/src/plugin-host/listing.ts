import type { McpToolDescriptor } from '@runlith/mcp/McpSession';
import type { ToolEntries } from './contract/wire/audience.js';

const ordered = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(ordered);
  if (value === null || typeof value !== 'object') return value;
  const record = value as Readonly<Record<string, unknown>>;
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .flatMap((key) => (record[key] === undefined ? [] : [[key, ordered(record[key])]])),
  );
};

const same = (left: unknown, right: unknown): boolean => JSON.stringify(ordered(left)) === JSON.stringify(ordered(right));

export const listingDifference = (entries: ToolEntries, listed: readonly McpToolDescriptor[]): string | null => {
  const declared = new Map(entries.map((entry) => [entry.name, entry]));
  const served = new Map(listed.map((descriptor) => [descriptor.name, descriptor]));
  const missing = entries.filter((entry) => !served.has(entry.name)).map((entry) => entry.name);
  const extra = listed.filter((descriptor) => !declared.has(descriptor.name)).map((descriptor) => descriptor.name);
  const changed = entries.flatMap((entry) => {
    const descriptor = served.get(entry.name);
    if (descriptor === undefined) return [];
    const fields = [
      ...(entry.description === descriptor.description ? [] : ['description']),
      ...(same(entry.inputSchema, descriptor.inputSchema) ? [] : ['input schema']),
      ...(same(entry.annotations ?? {}, descriptor.annotations ?? {}) ? [] : ['annotations']),
    ];
    return fields.length === 0 ? [] : [`${entry.name} (${fields.join(', ')})`];
  });
  const told = [
    ...(missing.length === 0 ? [] : [`serves no ${missing.join(', ')}`]),
    ...(extra.length === 0 ? [] : [`serves ${extra.join(', ')}, which its manifest does not name`]),
    ...(changed.length === 0 ? [] : [`lists ${changed.join('; ')} otherwise than its manifest`]),
  ];
  return told.length === 0 ? null : `its process ${told.join('; ')}: build the plugin again`;
};
