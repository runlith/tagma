export type Revision = {
  readonly id: string;
  readonly bucket: string;
  readonly depth: number;
  readonly keys: ReadonlyMap<string, string | readonly string[]>;
};

export function revisionOf(document: Readonly<Record<string, unknown>>): Map<string, string | readonly string[]> {
  const keys = new Map<string, string | readonly string[]>();
  for (const [key, value] of Object.entries(document)) {
    keys.set(key, Array.isArray(value) ? value.map((item) => JSON.stringify(item) ?? 'null') : (JSON.stringify(value) ?? 'null'));
  }
  return keys;
}

export function encoded(keys: ReadonlyMap<string, string | readonly string[]>, base: Revision | undefined): string {
  if (base === undefined) return `{"full":{${[...keys].map(([key, held]) => `${JSON.stringify(key)}:${textOf(held)}`).join(',')}}}`;
  const set: string[] = [];
  const grow: string[] = [];
  for (const [key, held] of keys) {
    const before = base.keys.get(key);
    if (typeof held === 'string' || typeof before === 'string' || before === undefined) {
      if (before === undefined || textOf(before) !== textOf(held)) set.push(`${JSON.stringify(key)}:${textOf(held)}`);
      continue;
    }
    let keep = 0;
    while (keep < held.length && keep < before.length && held[keep] === before[keep]) keep += 1;
    if (keep === held.length && keep === before.length) continue;
    grow.push(`${JSON.stringify(key)}:{"keep":${keep},"items":[${held.slice(keep).join(',')}]}`);
  }
  const drop = [...base.keys.keys()].filter((key) => !keys.has(key)).map((key) => JSON.stringify(key));
  return `{"after":${JSON.stringify(base.id)},"set":{${set.join(',')}},"grow":{${grow.join(',')}},"drop":[${drop.join(',')}]}`;
}

export function assembled(texts: readonly string[]): string {
  const [first, ...links] = texts.map((text) => JSON.parse(text) as Record<string, unknown>);
  if (first === undefined || typeof first.full !== 'object' || first.full === null)
    throw new Error('The chain does not open with a whole document.');
  const document = first.full as Record<string, unknown>;
  for (const link of links) {
    for (const key of link.drop as readonly string[]) delete document[key];
    Object.assign(document, link.set as Record<string, unknown>);
    for (const [key, change] of Object.entries(
      link.grow as Record<string, { readonly keep: number; readonly items: readonly unknown[] }>,
    )) {
      document[key] = [...(document[key] as readonly unknown[]).slice(0, change.keep), ...change.items];
    }
  }
  return JSON.stringify(document);
}

function textOf(held: string | readonly string[]): string {
  return typeof held === 'string' ? held : `[${held.join(',')}]`;
}
