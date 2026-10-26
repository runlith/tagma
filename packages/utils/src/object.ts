export type StructuredValue = string | number | boolean | null | readonly StructuredValue[] | { readonly [key: string]: StructuredValue };

export function pick<T extends object>(value: T, predicate: <K extends keyof T>(field: T[K], key: K) => boolean): Partial<T> {
  const result = {} as Partial<T>;

  for (const key of Object.keys(value) as Array<keyof T>) {
    const field = value[key];
    if (predicate(field, key)) {
      result[key] = field;
    }
  }

  return result;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function textValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

export function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function nonNegativeInteger(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

export function positiveInteger(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export function booleanValue(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

const unrepresentable = (value: unknown): boolean => value === undefined || typeof value === 'function' || typeof value === 'symbol';

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${Array.from(value, (entry) => (unrepresentable(entry) ? 'null' : canonicalJson(entry))).join(',')}]`;
  return `{${Object.entries(value)
    .filter(([, entry]) => !unrepresentable(entry))
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(',')}}`;
}
