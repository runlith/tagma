import type { InfiniteData } from '@tanstack/query-core';

export function isInfiniteData(value: unknown): value is InfiniteData<unknown, unknown> {
  if (typeof value !== 'object' || value === null) return false;

  const data = value as Record<string, unknown>;
  return Array.isArray(data['pages']) && Array.isArray(data['pageParams']);
}
