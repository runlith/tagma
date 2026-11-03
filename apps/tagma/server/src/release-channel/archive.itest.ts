import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { inspectArchive } from './archive.js';

const scratch = Effect.acquireRelease(
  Effect.sync(() => mkdtempSync(join(tmpdir(), 'release-archive-'))),
  (root) => Effect.sync(() => rmSync(root, { recursive: true, force: true })),
);

const record = (key: string, value: string): string => {
  const body = ` ${key}=${value}\n`;
  let size = Buffer.byteLength(body) + 1;
  while (size !== Buffer.byteLength(body) + String(size).length) size = Buffer.byteLength(body) + String(size).length;
  return `${size}${body}`;
};

const entry = (name: string, body = Buffer.alloc(0), type = '0', target = '', declared?: string): Buffer => {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100);
  header.write('0000644\0', 100, 8);
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

const archive = (root: string, name: string, entries: readonly Buffer[]): string => {
  const file = join(root, `${name}.tar.gz`);
  writeFileSync(file, gzipSync(Buffer.concat([...entries, Buffer.alloc(1024)])));
  return file;
};

it.live('a release archive exposes its real file footprint while admitting ordinary, PAX and GNU names and internal links', () =>
  Effect.gen(function* () {
    const root = yield* scratch;
    const bytes = Buffer.alloc(1 << 20);
    const named = `./${'long-'.repeat(30)}`;
    const file = archive(root, 'ordinary', [
      entry('./', undefined, '5'),
      entry('./payload', bytes),
      entry('PaxHeader', Buffer.from(record('path', './pax') + record('size', '3')), 'x'),
      entry('./ignored', Buffer.from('abc')),
      entry('./LongName', Buffer.from(`${named}\0`), 'L'),
      entry('./ignored', Buffer.from('de')),
      entry('./internal', undefined, '2', 'payload'),
    ]);
    expect(yield* inspectArchive(file)).toEqual({ bytes: bytes.length + 5, entries: 5 });
  }),
);

it.live('release archive inspection rejects unsafe entries, malformed sizes and truncated input before extraction', () =>
  Effect.gen(function* () {
    const root = yield* scratch;
    const bad = [
      entry('/outside'),
      entry('./../outside'),
      entry('./._metadata'),
      entry('./hard', undefined, '1', './file'),
      entry('./device', undefined, '3'),
      entry('./link', undefined, '2', '/outside'),
      entry('./nested/link', undefined, '2', '../../outside'),
      entry('./line\nbreak'),
      entry('./directory', Buffer.from('x'), '5'),
      entry('./invalid', undefined, '0', '', '0000000009\0'),
      entry('PaxHeader', Buffer.from(record('size', '-1')), 'x'),
      entry('PaxHeader', Buffer.from(record('size', '9007199254740992')), 'x'),
      entry('PaxHeader', Buffer.alloc(0), 'x', '', '00004000001\0'),
      Buffer.concat([
        entry('PaxHeader', Buffer.from(record('path', './safe')), 'x'),
        entry('./LongName', Buffer.from('../outside\0'), 'L'),
      ]),
    ];
    for (const [at, malformed] of bad.entries()) {
      const file = archive(root, `bad-${at}`, [malformed, entry('./file')]);
      expect((yield* Effect.result(inspectArchive(file)))._tag).toBe('Failure');
    }
    const truncated = join(root, 'truncated.tar.gz');
    writeFileSync(truncated, gzipSync(entry('./file', Buffer.from('a')).subarray(0, 513)));
    expect((yield* Effect.result(inspectArchive(truncated)))._tag).toBe('Failure');
  }),
);

it.live('a sparse release archive is refused before its unreported expanded file size can be extracted', () =>
  Effect.gen(function* () {
    const root = yield* scratch;
    const metadata = Buffer.from(
      [
        record('GNU.sparse.major', '1'),
        record('GNU.sparse.minor', '0'),
        record('GNU.sparse.name', './large'),
        record('GNU.sparse.realsize', '1099511627776'),
      ].join(''),
    );
    const map = Buffer.alloc(512);
    map.write('1\n0\n1\n');
    const file = archive(root, 'sparse', [entry('PaxHeader', metadata, 'x'), entry('./large', Buffer.concat([map, Buffer.from('x')]))]);
    expect((yield* Effect.result(inspectArchive(file)))._tag).toBe('Failure');
  }),
);
