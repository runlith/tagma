export function redactValue<T>(value: T, redact?: (text: string) => string): T {
  if (redact === undefined) return value;
  if (typeof value === 'string') return redact(value) as T;
  if (Array.isArray(value)) return value.map((entry) => redactValue(entry, redact)) as T;
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [redact(key), redactValue(entry, redact)])) as T;
  }
  return value;
}

export function mcpRedactor(values: readonly string[]): (text: string) => string {
  const secrets = [...new Set(values.filter((value) => value.length > 0))].sort((left, right) => right.length - left.length);
  if (secrets.length === 0) return (text) => text;
  return (text) => secrets.reduce((carried, secret) => carried.split(secret).join('[redacted]'), text);
}
