import { utf8Order } from '@runlith/utils/utf8';
import { Buffer } from 'node:buffer';

export const METADATA_BYTES = Math.floor((50 * 1024) / 3);

class MetadataFull {}

export function metadata(value: unknown): { readonly text: string; readonly bytes: number } | undefined {
  let left = METADATA_BYTES;
  let root = true;
  let visits = 0;
  const children = new WeakMap<object, number>();
  const spend = (bytes: number) => {
    left -= bytes;
    if (left < 0) throw new MetadataFull();
  };
  const quoted = (text: string) => {
    if (text.length > left) throw new MetadataFull();
    spend(Buffer.byteLength(JSON.stringify(text)));
  };
  try {
    const text = JSON.stringify(value, function (key, held: unknown) {
      if (++visits > METADATA_BYTES) throw new MetadataFull();
      const omitted = held === undefined || typeof held === 'function' || typeof held === 'symbol';
      if (omitted && !Array.isArray(this)) return undefined;
      if (!root) {
        const count = children.get(this) ?? 0;
        children.set(this, count + 1);
        if (count > 0) spend(1);
        if (!Array.isArray(this)) {
          quoted(key);
          spend(1);
        }
      }
      root = false;
      if (held !== null && typeof held === 'object') {
        spend(2);
        if (Array.isArray(held) && held.length * 2 > left + 1) throw new MetadataFull();
      } else if (typeof held === 'string') quoted(held);
      else spend((JSON.stringify(omitted ? null : held) ?? 'null').length);
      return held;
    });
    return text === undefined ? undefined : { text, bytes: METADATA_BYTES - left };
  } catch (cause) {
    if (cause instanceof MetadataFull) return undefined;
    throw cause;
  }
}

export function canonical(value: unknown): string {
  return serialized(JSON.parse(JSON.stringify(value ?? null)) as unknown);
}

export function folded(roots: Readonly<Record<string, unknown>>): string | null {
  const held: Record<string, unknown> = {};
  for (const [root, value] of Object.entries(roots)) {
    if (value === undefined || value === null) continue;
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    if (!/[^\x00-\x7f]/.test(text)) continue;
    held[root] = typeof value === 'string' ? value : JSON.parse(text);
  }
  return Object.keys(held).length === 0 ? null : serialized(held, true);
}

function serialized(value: unknown, lower = false): string {
  const pending: ({ readonly value: unknown } | { readonly text: string })[] = [{ value }];
  const parts: string[] = [];
  while (pending.length > 0) {
    const next = pending.pop()!;
    if ('text' in next) {
      parts.push(next.text);
      continue;
    }
    const held = next.value;
    if (held === null || typeof held !== 'object') {
      parts.push(JSON.stringify(lower && typeof held === 'string' ? held.toLowerCase() : held));
      continue;
    }
    if (Array.isArray(held)) {
      parts.push('[');
      pending.push({ text: ']' });
      for (let at = held.length - 1; at >= 0; at -= 1) {
        pending.push({ value: held[at] });
        if (at > 0) pending.push({ text: ',' });
      }
      continue;
    }
    const entries = Object.entries(held as Record<string, unknown>).sort(([left], [right]) => utf8Order(left, right));
    parts.push('{');
    pending.push({ text: '}' });
    for (let at = entries.length - 1; at >= 0; at -= 1) {
      const [key, entry] = entries[at]!;
      pending.push({ value: entry }, { text: `${JSON.stringify(key)}:` });
      if (at > 0) pending.push({ text: ',' });
    }
  }
  return parts.join('');
}
