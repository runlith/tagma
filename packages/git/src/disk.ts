import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const readText = async (path: string): Promise<string | null> => {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
};

const COMMIT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

export const headOnDisk = async (gitDir: string, commonDir: string): Promise<string | undefined> => {
  const head = (await readText(join(gitDir, 'HEAD')))?.trim();
  if (head === undefined) return undefined;
  if (COMMIT.test(head)) return head;
  if (!head.startsWith('ref: refs/')) return undefined;
  const ref = head.slice('ref: '.length);
  const loose = (await readText(join(commonDir, ref)))?.trim();
  if (loose !== undefined) return COMMIT.test(loose) ? loose : undefined;
  const packed = await readText(join(commonDir, 'packed-refs'));
  if (packed === null) return undefined;
  for (const line of packed.split('\n')) {
    if (line.endsWith(` ${ref}`)) {
      const commit = line.slice(0, line.indexOf(' '));
      return COMMIT.test(commit) ? commit : undefined;
    }
  }
  return undefined;
};

export type IndexEntries = ReadonlyMap<string, string>;

const SIGNATURE = 0x44495243;
const EXTENDED = 0x4000;
const NAME_LENGTH = 0x0fff;

export const indexOnDisk = async (gitDir: string, hashBytes: number): Promise<IndexEntries | null> => {
  let bytes: Buffer;
  try {
    bytes = await readFile(join(gitDir, 'index'));
  } catch (cause) {
    return (cause as { readonly code?: string }).code === 'ENOENT' ? new Map() : null;
  }
  if (bytes.length < 12 || bytes.readUInt32BE(0) !== SIGNATURE) return null;
  const version = bytes.readUInt32BE(4);
  if (version !== 2 && version !== 3) return null;
  const count = bytes.readUInt32BE(8);
  const entries = new Map<string, string>();
  const fixed = 40 + hashBytes + 2;
  let at = 12;
  for (let entry = 0; entry < count; entry += 1) {
    if (at + fixed > bytes.length) return null;
    const mode = bytes.readUInt32BE(at + 24);
    const hash = bytes.toString('hex', at + 40, at + 40 + hashBytes);
    const flags = bytes.readUInt16BE(at + 40 + hashBytes);
    const extended = (flags & EXTENDED) !== 0 ? bytes.readUInt16BE(at + fixed) : 0;
    const nameAt = at + fixed + ((flags & EXTENDED) !== 0 ? 2 : 0);
    const named = flags & NAME_LENGTH;
    const end = named < NAME_LENGTH ? nameAt + named : bytes.indexOf(0, nameAt + NAME_LENGTH);
    if (end < 0 || end >= bytes.length || bytes[end] !== 0) return null;
    entries.set(bytes.toString('utf8', nameAt, end), `${mode.toString(8)} ${hash} ${flags & 0xf000} ${extended}`);
    at += (end - at + 8) & ~7;
  }
  for (let ext = at; ext + 8 <= bytes.length - hashBytes;) {
    const signature = bytes.toString('latin1', ext, ext + 4);
    if (signature === 'link' || signature === 'sdir') return null;
    ext += 8 + bytes.readUInt32BE(ext + 4);
  }
  return entries;
};

export const indexMoved = (before: IndexEntries, after: IndexEntries): readonly string[] => {
  const moved: string[] = [];
  for (const [path, entry] of after) if (before.get(path) !== entry) moved.push(path);
  for (const path of before.keys()) if (!after.has(path)) moved.push(path);
  return moved;
};
