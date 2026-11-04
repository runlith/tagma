import { lstatSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { openArchive } from './archive.js';
import { paxRecord as record, tarEntry as entry, writeArchive } from './testing/tarball.js';

const scratch = Effect.acquireRelease(
  Effect.sync(() => mkdtempSync(join(tmpdir(), 'release-archive-'))),
  (root) => Effect.sync(() => rmSync(root, { recursive: true, force: true })),
);

const archive = (root: string, name: string, entries: readonly Buffer[]): string => writeArchive(root, name, entries).file;

it.live(
  'a release archive measures and materializes ordinary, PAX and GNU names, executable files and internal links without restoring metadata',
  () =>
    Effect.gen(function* () {
      const root = yield* scratch;
      const bytes = Buffer.alloc(1 << 20);
      const named = `./${'long-'.repeat(30)}`;
      const file = archive(root, 'ordinary', [
        entry('./', undefined, '5', '', undefined, 0o755),
        entry('./payload', bytes),
        entry(
          'PaxHeader',
          Buffer.from(
            record('path', './pax') +
              record('size', '3') +
              record('SCHILY.xattr.user.release', 'ignored') +
              record('SCHILY.fflags', 'uchg') +
              record('SCHILY.acl.access', 'ignored'),
          ),
          'x',
        ),
        entry('./ignored', Buffer.from('abc'), '0', '', undefined, 0o755),
        entry('./LongName', Buffer.from(`${named}\0`), 'L'),
        entry('./ignored', Buffer.from('de')),
        entry('./internal', undefined, '2', 'payload'),
      ]);
      const opened = yield* openArchive(file);
      expect(opened.footprint).toEqual({ bytes: bytes.length + 5, entries: 5 });
      const into = join(root, 'unpacked');
      yield* opened.unpack(into);
      expect(readFileSync(join(into, 'payload'))).toEqual(bytes);
      expect(readFileSync(join(into, 'pax'), 'utf8')).toBe('abc');
      expect(readFileSync(join(into, named), 'utf8')).toBe('de');
      expect(readlinkSync(join(into, 'internal'))).toBe('payload');
      expect(lstatSync(join(into, 'pax')).mode & 0o777).toBe(0o755);
      expect(lstatSync(join(into, 'pax')).uid).toBe(lstatSync(root).uid);
      writeFileSync(join(into, 'pax'), 'writable after extracting immutable metadata');
      expect(readFileSync(join(into, 'pax'), 'utf8')).toBe('writable after extracting immutable metadata');
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
      expect((yield* Effect.result(Effect.scoped(openArchive(file))))._tag).toBe('Failure');
    }
    const truncated = join(root, 'truncated.tar.gz');
    writeFileSync(truncated, gzipSync(entry('./file', Buffer.from('a')).subarray(0, 513)));
    expect((yield* Effect.result(Effect.scoped(openArchive(truncated))))._tag).toBe('Failure');
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
    expect((yield* Effect.result(Effect.scoped(openArchive(file))))._tag).toBe('Failure');
  }),
);
