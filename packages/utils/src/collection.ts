import { seededRandom } from './random.js';

export function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

export function uniqueBy<T>(values: readonly T[], key: (value: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const value of values) {
    const id = key(value);
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(value);
  }
  return result;
}

export function arrayView<T>(length: number, value: (at: number) => T): readonly T[] {
  const index = (key: string | symbol): number => {
    const at = typeof key === 'string' ? Number(key) : -1;
    return Number.isInteger(at) && at >= 0 && at < length && String(at) === key ? at : -1;
  };
  return new Proxy<T[]>([], {
    get: (target, key, receiver) => (key === 'length' ? length : index(key) >= 0 ? value(index(key)) : Reflect.get(target, key, receiver)),
    has: (target, key) => index(key) >= 0 || Reflect.has(target, key),
  });
}

export function sharedPrefix<T>(held: readonly T[], next: readonly T[]): number {
  const shared = Math.min(held.length, next.length);
  let at = 0;
  while (at < shared && held[at] === next[at]) at += 1;
  return at;
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  const chunkSize = Math.max(1, size);
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}

export function seededShuffle<T>(input: readonly T[], seed: string): T[] {
  if (input.length <= 1) return [...input];
  const random = seededRandom(fnv1a(seed));
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const result = [...input];
    for (let index = result.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(random() * (index + 1));
      const held = result[index] as T;
      result[index] = result[swap] as T;
      result[swap] = held;
    }
    if (result.some((value, position) => value !== input[position])) return result;
  }
  return [...input];
}

export function seededPick<T>(items: readonly T[], seed: string): T | undefined {
  if (items.length === 0) return undefined;
  return items[Math.floor(seededRandom(fnv1a(seed))() * items.length)];
}

function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}
