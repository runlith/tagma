import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import type { Packed } from './release.js';

export const paxRecord = (key: string, value: string): string => {
  const body = ` ${key}=${value}\n`;
  let size = Buffer.byteLength(body) + 1;
  while (size !== Buffer.byteLength(body) + String(size).length) size = Buffer.byteLength(body) + String(size).length;
  return `${size}${body}`;
};

export const tarEntry = (name: string, body = Buffer.alloc(0), type = '0', target = '', declared?: string, mode = 0o644): Buffer => {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100);
  header.write(`${mode.toString(8).padStart(7, '0')}\0`, 100, 8);
  header.write('0001750\0', 108, 8);
  header.write('0001750\0', 116, 8);
  header.write(declared ?? `${body.length.toString(8).padStart(11, '0')}\0`, 124, 12);
  header.fill(0x20, 148, 156);
  header.write(type, 156, 1);
  header.write(target, 157, 100);
  header.write('ustar\0', 257, 6);
  header.write('00', 263, 2);
  const sum = header.reduce((total, byte) => total + byte, 0);
  header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8);
  return Buffer.concat([header, body, Buffer.alloc((512 - (body.length % 512)) % 512)]);
};

export const writeArchive = (root: string, name: string, entries: readonly Buffer[]): Packed => {
  const file = join(root, `${name}.tar.gz`);
  const bytes = gzipSync(Buffer.concat([...entries, Buffer.alloc(1024)]));
  writeFileSync(file, bytes);
  return { file, sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length };
};
