import { Buffer } from 'node:buffer';

export type TextSlice = {
  readonly bytes: Uint8Array<SharedArrayBuffer>;
  readonly offsets: Uint32Array<SharedArrayBuffer>;
};

export function shareText(text: string, offsets: readonly number[]): TextSlice {
  const bytes = new Uint8Array(new SharedArrayBuffer(text.length * 2));
  Buffer.from(bytes.buffer).write(text, 'utf16le');
  const positions = new Uint32Array(new SharedArrayBuffer(offsets.length * 4));
  positions.set(offsets);
  return { bytes, offsets: positions };
}

export const sliceText = (text: TextSlice, start: number, end: number): TextSlice => ({
  bytes: text.bytes,
  offsets: text.offsets.subarray(start, end + 1),
});

export function sliceLines(slice: TextSlice): readonly string[] {
  const buffer = Buffer.from(slice.bytes.buffer, slice.bytes.byteOffset, slice.bytes.byteLength);
  const lines: string[] = [];
  for (let at = 0; at + 1 < slice.offsets.length; at += 1)
    lines.push(buffer.toString('utf16le', (slice.offsets[at] as number) * 2, (slice.offsets[at + 1] as number) * 2));
  return lines;
}

export function lineView(text: string, offsets: Uint32Array): readonly string[] {
  const index = (key: string | symbol): number => {
    const at = typeof key === 'string' ? Number(key) : -1;
    return Number.isInteger(at) && at >= 0 && at + 1 < offsets.length && String(at) === key ? at : -1;
  };
  return new Proxy<string[]>([], {
    get: (target, key, receiver) =>
      key === 'length'
        ? offsets.length - 1
        : index(key) >= 0
          ? text.slice(offsets[index(key)], offsets[index(key) + 1])
          : Reflect.get(target, key, receiver),
    has: (target, key) => (index(key) >= 0 && index(key) < offsets.length - 1) || Reflect.has(target, key),
  });
}

export function lineIn(slice: TextSlice, at: number): string {
  return Buffer.from(slice.bytes.buffer, slice.bytes.byteOffset, slice.bytes.byteLength).toString(
    'utf16le',
    (slice.offsets[at] as number) * 2,
    (slice.offsets[at + 1] as number) * 2,
  );
}
