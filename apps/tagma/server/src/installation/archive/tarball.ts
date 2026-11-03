import { createReadStream } from 'node:fs';
import { createGunzip } from 'node:zlib';
import type { ArchiveEntry } from '../contract/wire/archive.js';

export type TarEntry = ArchiveEntry & { readonly size: number; readonly mode: number; readonly attributes: readonly string[] };

export type EntrySink = { readonly chunk: (bytes: Buffer) => void; readonly end: () => void };

const BLOCK = 512;
const EMPTY = Buffer.alloc(0);
const METADATA_LIMIT = 1 << 20;
const ATTRIBUTE = /^(?:SCHILY|LIBARCHIVE)\.xattr\.(.+)$/u;
const UTF8 = new TextDecoder('utf-8', { fatal: true });

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
  return UTF8.decode(field.subarray(0, end < 0 ? field.length : end));
};

const sized = (value: number): number => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('an archive size is not a nonnegative safe integer');
  return value;
};

const number = (block: Buffer, from: number, length: number): number => {
  const field = block.subarray(from, from + length);
  if ((field[0]! & 0x80) !== 0) {
    if ((field[0]! & 0x40) !== 0) throw new Error('an archive size is negative');
    let value = field[0]! & 0x7f;
    for (const byte of field.subarray(1)) value = sized(value * 256 + byte);
    return sized(value);
  }
  const digits = text(block, from, length).trim();
  if (!/^[0-7]*$/u.test(digits)) throw new Error('an archive size is not an octal integer');
  return sized(digits === '' ? 0 : Number.parseInt(digits, 8));
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
    const digits = data.subarray(at, space < 0 ? at : space).toString('ascii');
    if (!/^[1-9]\d*$/u.test(digits)) throw new Error('a PAX record has no valid length');
    const length = sized(Number(digits));
    if (length <= space - at + 1 || length > data.length - at || data[at + length - 1] !== 0x0a) {
      throw new Error('a PAX record does not fit its declared length');
    }
    const record = data.subarray(space + 1, at + length - 1);
    const equals = record.indexOf(0x3d);
    if (equals <= 0) throw new Error('a PAX record has no key');
    const key = UTF8.decode(record.subarray(0, equals));
    const raw = record.subarray(equals + 1);
    const value = ATTRIBUTE.test(key) ? raw.toString('utf8') : UTF8.decode(raw);
    if (key.startsWith('GNU.sparse.') || key === 'SCHILY.realsize' || key === 'SCHILY.holesdata' || key === 'SUN.holesdata') {
      throw new Error('a sparse archive entry has no ordinary extraction footprint');
    }
    if (key === 'SCHILY.filetype' && value !== 'file') throw new Error('a PAX record changes the archive entry kind');
    if (key === 'hdrcharset' && value !== 'UTF-8') throw new Error('a PAX name uses an unsupported character set');
    found.set(key, value);
    at += length;
  }
  return found;
};

type Pending = { readonly records: ReadonlyMap<string, string>; readonly name: string | null; readonly target: string | null };

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

const merged = (previous: ReadonlyMap<string, string>, next: ReadonlyMap<string, string>): ReadonlyMap<string, string> => {
  const all = new Map(previous);
  for (const [key, value] of next) {
    if (value === '') all.delete(key);
    else all.set(key, value);
  }
  let bytes = 0;
  for (const [key, value] of all) bytes += Buffer.byteLength(key) + Buffer.byteLength(value);
  if (bytes > METADATA_LIMIT) throw new Error('the archive metadata exceeds its inspection buffer');
  return all;
};

export const walkTarball = async (file: string, visit: (entry: TarEntry) => EntrySink | null): Promise<void> => {
  let globals: ReadonlyMap<string, string> = new Map();
  let pending: Pending = { records: new Map(), name: null, target: null };
  let metadata = 0;
  let reading: Reading = { kind: 'header' };
  let left = EMPTY;
  let zeros = 0;

  const header = (block: Buffer): Reading => {
    if (block.every((byte) => byte === 0)) {
      zeros += 1;
      return { kind: 'header' };
    }
    if (zeros > 0) throw new Error('the archive has an entry after its end marker');
    if (!summed(block)) throw new Error('a header of the archive fails its checksum');
    const type = String.fromCharCode(block[156]!);
    const size = number(block, 124, 12);
    if (type === 'x' || type === 'L' || type === 'K' || type === 'g') {
      metadata += size;
      if (metadata > METADATA_LIMIT) throw new Error('the archive metadata exceeds its inspection buffer');
      return { kind: 'body', left: size, pad: padding(size), sink: null, held: [], type };
    }
    const prefix = block.subarray(257, 263).equals(Buffer.from('ustar\0')) ? text(block, 345, 155) : '';
    const named = text(block, 0, 100);
    const attributes = merged(globals, pending.records);
    if ((attributes.has('path') && pending.name !== null) || (attributes.has('linkpath') && pending.target !== null)) {
      throw new Error('an archive entry mixes PAX and GNU naming overrides');
    }
    const name = attributes.get('path') ?? pending.name ?? (prefix === '' ? named : `${prefix}/${named}`);
    const kind = KINDS[type] ?? 'other';
    const declared = attributes.get('size');
    if (declared !== undefined && !/^\d+$/u.test(declared)) throw new Error('a PAX size is not a decimal integer');
    const entry: TarEntry = {
      name,
      kind,
      target: kind === 'link' || kind === 'hard link' ? (attributes.get('linkpath') ?? pending.target ?? text(block, 157, 100)) : null,
      size: sized(declared === undefined ? size : Number(declared)),
      mode: number(block, 100, 8),
      attributes: [...attributes.keys()].flatMap((key) => ATTRIBUTE.exec(key)?.[1] ?? []),
    };
    pending = { records: new Map(), name: null, target: null };
    metadata = 0;
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
    else if (body.type === 'g') globals = merged(globals, records(data));
    else if (body.type === 'L') pending = { ...pending, name: text(data, 0, data.length) };
    else if (body.type === 'K') pending = { ...pending, target: text(data, 0, data.length) };
  };

  const source = createReadStream(file);
  const stream = source.pipe(createGunzip({ chunkSize: 1 << 20 }));
  source.on('error', (error) => stream.destroy(error));
  try {
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
        if (data.subarray(at).some((byte) => byte !== 0)) throw new Error('the archive carries data after its end marker');
        left = EMPTY;
      } else left = at >= data.length ? EMPTY : Buffer.from(data.subarray(at));
    }
    if (reading.kind === 'body' || left.length > 0 || zeros < 2 || metadata > 0)
      throw new Error('the archive ends inside an entry or header');
  } finally {
    source.destroy();
    stream.destroy();
  }
};
