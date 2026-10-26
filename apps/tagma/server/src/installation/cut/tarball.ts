import { createReadStream } from 'node:fs';
import { createGunzip } from 'node:zlib';
import type { ArchiveEntry } from '../contract/wire/archive.js';

export type TarEntry = ArchiveEntry & { readonly size: number; readonly attributes: readonly string[] };

export type EntrySink = { readonly chunk: (bytes: Buffer) => void; readonly end: () => void };

const BLOCK = 512;
const EMPTY = Buffer.alloc(0);
const ATTRIBUTE = /^(?:SCHILY|LIBARCHIVE)\.xattr\.(.+)$/u;

const KINDS: Readonly<Record<string, ArchiveEntry['kind']>> = {
  '0': 'file',
  '\0': 'file',
  '1': 'hard link',
  '2': 'link',
  '5': 'directory',
};

const text = (block: Buffer, from: number, length: number): string => {
  const field = block.subarray(from, from + length);
  const end = field.indexOf(0);
  return field.subarray(0, end < 0 ? field.length : end).toString('utf8');
};

const number = (block: Buffer, from: number, length: number): number => {
  const field = block.subarray(from, from + length);
  if ((field[0]! & 0x80) !== 0) {
    let value = field[0]! & 0x7f;
    for (const byte of field.subarray(1)) value = value * 256 + byte;
    return value;
  }
  const digits = text(block, from, length).trim();
  return digits === '' ? 0 : Number.parseInt(digits, 8);
};

const summed = (block: Buffer): boolean => {
  let sum = 0;
  for (let at = 0; at < BLOCK; at += 1) sum += at >= 148 && at < 156 ? 0x20 : block[at]!;
  return sum === number(block, 148, 8);
};

const records = (data: Buffer): ReadonlyMap<string, string> => {
  const found = new Map<string, string>();
  let at = 0;
  while (at < data.length) {
    const space = data.indexOf(0x20, at);
    if (space < 0) break;
    const length = Number.parseInt(data.subarray(at, space).toString('utf8'), 10);
    if (!Number.isInteger(length) || length <= 0) break;
    const record = data.subarray(space + 1, at + length - 1).toString('utf8');
    const equals = record.indexOf('=');
    if (equals > 0) found.set(record.slice(0, equals), record.slice(equals + 1));
    at += length;
  }
  return found;
};

type Pending = { readonly records: ReadonlyMap<string, string>; readonly name: string | null };

type Reading =
  | { readonly kind: 'header' }
  | {
      readonly kind: 'body';
      left: number;
      pad: number;
      readonly sink: EntrySink | null;
      readonly held: Buffer[] | null;
      readonly type: string;
    };

const padding = (size: number): number => (BLOCK - (size % BLOCK)) % BLOCK;

export const walkTarball = async (file: string, visit: (entry: TarEntry) => EntrySink | null): Promise<void> => {
  let pending: Pending = { records: new Map(), name: null };
  let reading: Reading = { kind: 'header' };
  let left = EMPTY;
  let zeros = 0;

  const header = (block: Buffer): Reading => {
    if (block.every((byte) => byte === 0)) {
      zeros += 1;
      return { kind: 'header' };
    }
    if (!summed(block)) throw new Error('a header of the archive fails its checksum');
    const type = String.fromCharCode(block[156]!);
    const size = number(block, 124, 12);
    if (type === 'x' || type === 'L' || type === 'g') return { kind: 'body', left: size, pad: padding(size), sink: null, held: [], type };
    const prefix = text(block, 345, 155);
    const named = text(block, 0, 100);
    const name = pending.records.get('path') ?? pending.name ?? (prefix === '' ? named : `${prefix}/${named}`);
    const kind = KINDS[type] ?? 'other';
    const entry: TarEntry = {
      name,
      kind,
      target: kind === 'link' || kind === 'hard link' ? (pending.records.get('linkpath') ?? text(block, 157, 100)) : null,
      size: Number(pending.records.get('size') ?? size),
      attributes: [...pending.records.keys()].flatMap((key) => ATTRIBUTE.exec(key)?.[1] ?? []),
    };
    pending = { records: new Map(), name: null };
    const sink = visit(entry);
    return { kind: 'body', left: entry.size, pad: padding(entry.size), sink, held: null, type };
  };

  const ended = (body: Extract<Reading, { kind: 'body' }>): void => {
    if (body.held === null) {
      body.sink?.end();
      return;
    }
    const data = Buffer.concat(body.held);
    if (body.type === 'x') pending = { ...pending, records: new Map([...pending.records, ...records(data)]) };
    else if (body.type === 'L') pending = { ...pending, name: text(data, 0, data.length) };
  };

  const stream = createReadStream(file).pipe(createGunzip({ chunkSize: 1 << 20 }));
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    const data = left.length === 0 ? chunk : Buffer.concat([left, chunk]);
    let at = 0;
    while (zeros < 2) {
      if (reading.kind === 'header') {
        if (data.length - at < BLOCK) break;
        reading = header(data.subarray(at, at + BLOCK));
        at += BLOCK;
        continue;
      }
      const take = Math.min(reading.left, data.length - at);
      if (take > 0) {
        const bytes = data.subarray(at, at + take);
        if (reading.held !== null) reading.held.push(Buffer.from(bytes));
        else reading.sink?.chunk(bytes);
        reading.left -= take;
        at += take;
      }
      if (reading.left > 0) break;
      const skip = Math.min(reading.pad, data.length - at);
      reading.pad -= skip;
      at += skip;
      if (reading.pad > 0) break;
      ended(reading);
      reading = { kind: 'header' };
    }
    if (zeros >= 2) {
      stream.destroy();
      return;
    }
    left = at >= data.length ? EMPTY : Buffer.from(data.subarray(at));
  }
  if (reading.kind === 'body') throw new Error('the archive ends inside an entry');
};
