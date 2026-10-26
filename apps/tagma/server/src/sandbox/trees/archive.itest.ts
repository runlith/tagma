import { createHash } from 'node:crypto';
import { afterEach, beforeEach, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect, Stream } from 'effect';
import { sealArchive, unpackArchive } from './archive.js';

let home: string;
let into: string;
let sentinel: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'tagma-archive-'));
  into = join(home, 'tree');
  sentinel = join(home, 'host-secret.txt');
  writeFileSync(sentinel, 'this machine\n');
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

const unpack = (members: readonly Uint8Array[], piece = 0) => {
  const bytes = archiveOf(members);
  const pieces =
    piece === 0
      ? [bytes]
      : Array.from({ length: Math.ceil(bytes.byteLength / piece) }, (_, at) => bytes.subarray(at * piece, (at + 1) * piece));
  return Effect.result(unpackArchive(Stream.fromIterable(pieces), into));
};

const refusal = (result: { _tag: string; failure?: unknown }): string =>
  result._tag === 'Success' ? 'it was materialized' : String((result.failure as Error).message);

it.live.each([0, 7])('a tree of files, directories and in-tree links materializes whole, read in pieces of %d bytes', (piece) =>
  Effect.gen(function* () {
    const long = `packages/${'deep/'.repeat(30)}index.js`;
    const result = yield* unpack(
      [
        directory('node_modules'),
        file('node_modules/answer.txt', 'forty two\n'),
        symlink('node_modules/.bin/answer', '../answer.txt'),
        paxName(long),
        file('ignored-by-the-pax-name', 'long\n'),
      ],
      piece,
    );

    expect(refusal(result)).toBe('it was materialized');
    expect(readFileSync(join(into, 'node_modules/answer.txt'), 'utf8')).toBe('forty two\n');
    expect(readlinkSync(join(into, 'node_modules/.bin/answer'))).toBe('../answer.txt');
    expect(readFileSync(join(into, long), 'utf8')).toBe('long\n');
  }),
);

it.live('a member that climbs out of the destination is refused and writes nothing', () =>
  Effect.gen(function* () {
    const result = yield* unpack([file('../host-secret.txt', 'overwritten\n')]);

    expect(refusal(result)).toContain('is not a member this tree can hold');
    expect(readFileSync(sentinel, 'utf8')).toBe('this machine\n');
  }),
);

it.live('an absolute member is refused', () =>
  Effect.gen(function* () {
    const result = yield* unpack([file(sentinel, 'overwritten\n')]);

    expect(refusal(result)).toContain('is not a member this tree can hold');
    expect(readFileSync(sentinel, 'utf8')).toBe('this machine\n');
  }),
);

it.live('a link whose target leaves the tree is refused, and the host file it aimed at is untouched', () =>
  Effect.gen(function* () {
    const result = yield* unpack([symlink('escape', '../host-secret.txt')]);

    expect(refusal(result)).toContain('outside the tree');
    expect(existsSync(join(into, 'escape'))).toBe(false);
    expect(readFileSync(sentinel, 'utf8')).toBe('this machine\n');
  }),
);

it.live('a chain of links that each stay inside cannot leave the tree together', () =>
  Effect.gen(function* () {
    const result = yield* unpack([symlink('a', '.'), directory('b'), symlink('b/x', '../a/..'), file('b/x/sentinel.txt', 'escaped\n')]);

    expect(refusal(result)).toContain('outside the tree');
    expect(readFileSync(sentinel, 'utf8')).toBe('this machine\n');
  }),
);

it.live('a chain the last member completes is refused, whichever way round it arrives', () =>
  Effect.gen(function* () {
    const result = yield* unpack([directory('b'), symlink('b/x', '../a/..'), symlink('a', '.')]);

    expect(refusal(result)).toContain('leaves the tree once it stands whole');
    expect(existsSync(join(into, 'b/x/sentinel.txt'))).toBe(false);
    expect(readFileSync(sentinel, 'utf8')).toBe('this machine\n');
  }),
);

it.live('a link whose target arrives later in the archive still lands', () =>
  Effect.gen(function* () {
    const result = yield* unpack([
      directory('node_modules'),
      directory('node_modules/.bin'),
      symlink('node_modules/.bin/tsc', '../typescript/bin/tsc'),
      directory('node_modules/typescript'),
      directory('node_modules/typescript/bin'),
      file('node_modules/typescript/bin/tsc', '#!/usr/bin/env node\n'),
    ]);

    expect(refusal(result)).toBe('it was materialized');
    expect(readlinkSync(join(into, 'node_modules/.bin/tsc'))).toBe('../typescript/bin/tsc');
    expect(readFileSync(join(into, 'node_modules/typescript/bin/tsc'), 'utf8')).toContain('env node');
  }),
);

it.live('a member written through a link is refused, whatever that link points at', () =>
  Effect.gen(function* () {
    const result = yield* unpack([directory('real'), symlink('near', 'real'), file('near/planted.txt', 'through a link\n')]);

    expect(refusal(result)).toContain('written through the link near');
    expect(existsSync(join(into, 'real/planted.txt'))).toBe(false);
  }),
);

it.live('a member that would overwrite what already stands at its name is refused', () =>
  Effect.gen(function* () {
    mkdirSync(into, { recursive: true });
    writeFileSync(join(into, 'answer.txt'), 'somebody else\n');

    const result = yield* unpack([file('answer.txt', 'mine\n')]);

    expect(refusal(result)).toContain('could not be written');
    expect(readFileSync(join(into, 'answer.txt'), 'utf8')).toBe('somebody else\n');
  }),
);

it.live('an absolute link is refused even when its target does not exist here', () =>
  Effect.gen(function* () {
    const result = yield* unpack([symlink('escape', '/etc/passwd')]);

    expect(refusal(result)).toContain('outside the tree');
    expect(existsSync(join(into, 'escape'))).toBe(false);
  }),
);

it.live('a device, a socket and a FIFO never leave a guest', () =>
  Effect.gen(function* () {
    for (const [flag, named] of [
      ['3', 'character device'],
      ['4', 'block device'],
      ['6', 'FIFO'],
    ] as const) {
      const result = yield* unpack([header({ name: 'special', flag })]);
      expect(refusal(result)).toContain(named);
    }
  }),
);

it.live('an archive cut off inside a member is refused rather than published as a tree', () =>
  Effect.gen(function* () {
    const cut = header({ name: 'half.txt', size: 1024 });
    const result = yield* Effect.result(unpackArchive(Stream.make(cut), into));

    expect(refusal(result)).toContain('ends inside a member');
  }),
);

it.live('sealing answers the digest and the size of exactly what landed', () =>
  Effect.gen(function* () {
    const bytes = archiveOf([file('answer.txt', 'forty two\n')]);
    const at = join(home, 'tree.tar');

    const seal = yield* sealArchive(Stream.make(bytes), at);

    expect(seal.bytes).toBe(bytes.byteLength);
    expect(readFileSync(at).byteLength).toBe(bytes.byteLength);
    expect(seal.digest).toBe(createHash('sha256').update(bytes).digest('hex'));
  }),
);

const BLOCK = 512;

function archiveOf(members: readonly Uint8Array[]): Uint8Array {
  const end = new Uint8Array(BLOCK * 2);
  const parts = [...members, end];
  const size = parts.reduce((total, part) => total + part.byteLength, 0);
  const joined = new Uint8Array(size);
  let at = 0;
  for (const part of parts) {
    joined.set(part, at);
    at += part.byteLength;
  }
  return joined;
}

function header(member: { name: string; flag?: string; size?: number; link?: string; mode?: number }): Uint8Array {
  const block = new Uint8Array(BLOCK);
  const put = (text: string, at: number, length: number) => {
    block.set(new TextEncoder().encode(text.slice(0, length - 1)), at);
  };
  put(member.name, 0, 100);
  put((member.mode ?? 0o644).toString(8).padStart(7, '0'), 100, 8);
  put('0000000', 108, 8);
  put('0000000', 116, 8);
  put((member.size ?? 0).toString(8).padStart(11, '0'), 124, 12);
  put('00000000000', 136, 12);
  block.set(new TextEncoder().encode('        '), 148);
  block[156] = (member.flag ?? '0').charCodeAt(0);
  put(member.link ?? '', 157, 100);
  put('ustar', 257, 6);
  put('00', 263, 3);
  let sum = 0;
  for (const byte of block) sum += byte;
  put(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8);
  return block;
}

function body(content: string): Uint8Array {
  const bytes = new TextEncoder().encode(content);
  const padded = new Uint8Array(Math.ceil(bytes.byteLength / BLOCK) * BLOCK);
  padded.set(bytes, 0);
  return padded;
}

function file(name: string, content: string): Uint8Array {
  const bytes = new TextEncoder().encode(content);
  return concat(header({ name, size: bytes.byteLength }), body(content));
}

function directory(name: string): Uint8Array {
  return header({ name, flag: '5', mode: 0o755 });
}

function symlink(name: string, target: string): Uint8Array {
  return header({ name, flag: '2', link: target });
}

function paxName(path: string): Uint8Array {
  const record = `path=${path}\n`;
  const length = `${record.length + 4} `.length + record.length;
  const said = `${length} ${record}`;
  return concat(header({ name: 'PaxHeader', flag: 'x', size: said.length }), body(said));
}

function concat(left: Uint8Array, right: Uint8Array): Uint8Array {
  const joined = new Uint8Array(left.byteLength + right.byteLength);
  joined.set(left, 0);
  joined.set(right, left.byteLength);
  return joined;
}
