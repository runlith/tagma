const CHAIN_DEPTH = 5;

const MESSAGE_CAP = 2_000;

const capMessage = (message: string): string =>
  message.length <= MESSAGE_CAP ? message : `${message.slice(0, MESSAGE_CAP)}… (cut, ${message.length} characters)`;

export function describeError(value: unknown): string {
  if (value instanceof Error) {
    const parts: string[] = [];
    let cause: unknown = value;
    for (let depth = 0; cause instanceof Error && depth < CHAIN_DEPTH; depth += 1, cause = cause.cause) {
      const message = capMessage(cause.message);
      parts.push(cause.name && cause.name !== 'Error' ? `${cause.name}: ${message}` : message);
    }
    return parts.join('; cause: ');
  }
  try {
    return capMessage(JSON.stringify(value) ?? String(value));
  } catch {
    return capMessage(String(value));
  }
}

export function describeErrors(values: ReadonlyArray<unknown>): string {
  return values.map(describeError).join(' · ');
}

export interface ErrorLink {
  readonly tag: string;
  readonly message: string;
}

const linkTag = (value: unknown): string => {
  const tag = typeof value === 'object' && value !== null && '_tag' in value ? (value as { _tag?: unknown })._tag : undefined;
  if (typeof tag === 'string' && tag.length > 0) return tag;
  if (value instanceof Error && value.name.length > 0) return value.name;
  const named = (value as { constructor?: { name?: unknown } } | null)?.constructor?.name;
  return typeof named === 'string' && named.length > 0 ? named : 'unknown';
};

export function errorChain(value: unknown): ReadonlyArray<ErrorLink> {
  const links: ErrorLink[] = [];
  let current: unknown = value;
  for (let depth = 0; depth < CHAIN_DEPTH && current !== undefined && current !== null; depth += 1) {
    links.push({
      tag: linkTag(current),
      message: capMessage(current instanceof Error ? current.message : errorText(current)),
    });
    if (!(current instanceof Error)) break;
    current = current.cause;
  }
  return links;
}

export function errorText(value: unknown): string {
  return typeof value === 'string' ? value : describeError(value);
}
