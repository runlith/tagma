import { createHash } from 'node:crypto';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { Data, Effect, FileSystem, Layer, type PlatformError, Stream } from 'effect';
import type { ArchiveSeal, TreeArchive } from '../contract/service/backends.js';

const hostFiles = Layer.mergeAll(BunFileSystem.layer, BunPath.layer);

export class ArchiveFailed extends Data.TaggedError('ArchiveFailed')<{
  readonly reason: string;
}> {
  override get message(): string {
    return `archive-failed: ${this.reason}`;
  }
}

export const sealArchive = Effect.fn('sandbox.sealArchive')(
  function* (archive: TreeArchive, into: string) {
    const digest = createHash('sha256');
    let bytes = 0;
    const files = yield* FileSystem.FileSystem;
    yield* Stream.run(
      archive.pipe(
        Stream.tap((chunk) =>
          Effect.sync(() => {
            digest.update(chunk);
            bytes += chunk.byteLength;
          }),
        ),
      ),
      files.sink(into, { flag: 'w' }),
    );
    return { digest: digest.digest('hex'), bytes } satisfies ArchiveSeal;
  },
  Effect.provide(hostFiles),
  (work) => failing('the archive could not be sealed')(work),
);

export const archiveBytes = (path: string): TreeArchive =>
  Stream.unwrap(
    Effect.provide(
      Effect.map(FileSystem.FileSystem, (files) => files.stream(path)),
      hostFiles,
    ),
  );

export const unpackArchive = Effect.fn('sandbox.unpackArchive')(
  function* (archive: TreeArchive, into: string) {
    const materialization = yield* makeMaterialization({ root: into });
    yield* Stream.runForEach(archive, (chunk) => materialization.take(chunk));
    yield* materialization.close();
  },
  Effect.provide(hostFiles),
  (work) => failing('the archive could not be materialized')(work),
);

const failing =
  (doing: string) =>
  <A, R>(work: Effect.Effect<A, ArchiveFailed | PlatformError.PlatformError, R>): Effect.Effect<A, ArchiveFailed, R> =>
    Effect.catch(work, (cause) =>
      Effect.fail(cause._tag === 'ArchiveFailed' ? cause : new ArchiveFailed({ reason: `${doing}: ${cause.message}` })),
    );

const BLOCK = 512;
const METADATA_CEILING = 64 * 1024;

type Body =
  | { readonly kind: 'file'; readonly path: string; content: number; skip: number }
  | { readonly kind: 'metadata'; readonly use: PaxUse; content: number; skip: number; taken: Uint8Array };

type PaxUse = 'records' | 'name' | 'link' | 'drop';

const makeMaterialization = Effect.fnUntraced(function* (input: { readonly root: string }) {
  const { root } = input;
  const files = yield* FileSystem.FileSystem;
  let held: Uint8Array = new Uint8Array(0);
  let pendingBody: Body | null = null;
  let overrides: { path?: string; link?: string; size?: number } = {};
  const made = new Set<string>();
  const links = new Map<string, string>();
  let ended = false;

  const take = Effect.fnUntraced(function* (chunk: Uint8Array): Effect.fn.Return<void, ArchiveFailed> {
    const bytes = join(chunk);
    let at = 0;
    while (at < bytes.byteLength) {
      const body = pendingBody;
      if (body !== null) {
        at += yield* fill(body, bytes, at);
        continue;
      }
      if (bytes.byteLength - at < BLOCK) break;
      const header = bytes.subarray(at, at + BLOCK);
      at += BLOCK;
      if (blank(header)) {
        ended = true;
        continue;
      }
      yield* open(header);
    }
    held = bytes.slice(at);
  });

  const close = Effect.fnUntraced(function* (): Effect.fn.Return<void, ArchiveFailed> {
    if (pendingBody !== null) return yield* new ArchiveFailed({ reason: 'the archive ends inside a member' });
    if (!ended) return yield* new ArchiveFailed({ reason: 'the archive ends without its end marker' });
    for (const [path, target] of links) {
      if (reaches(parentOf(path), target) === null) {
        return yield* new ArchiveFailed({ reason: `${path} points at ${target}, which leaves the tree once it stands whole` });
      }
    }
  });

  const fill = Effect.fnUntraced(function* (body: Body, bytes: Uint8Array, at: number): Effect.fn.Return<number, ArchiveFailed> {
    const available = bytes.byteLength - at;
    if (body.content > 0) {
      const take = Math.min(body.content, available);
      const taken = bytes.subarray(at, at + take);
      if (body.kind === 'file') yield* append(body.path, taken);
      else body.taken = concat(body.taken, taken);
      body.content -= take;
      if (body.content === 0 && body.skip === 0) finish(body);
      return take;
    }
    const skipped = Math.min(body.skip, available);
    body.skip -= skipped;
    if (body.skip === 0) finish(body);
    return skipped;
  });

  const finish = (body: Body): void => {
    pendingBody = null;
    if (body.kind === 'metadata') applyMetadata(body.use, body.taken);
  };

  const open = Effect.fnUntraced(function* (header: Uint8Array): Effect.fn.Return<void, ArchiveFailed> {
    const flag = String.fromCharCode(header[156] ?? 0);
    const declared = yield* sizeOf(header);
    const skip = declared % BLOCK === 0 ? 0 : BLOCK - (declared % BLOCK);
    const use = metadataUse(flag);
    if (use !== null) {
      if (declared > METADATA_CEILING) {
        return yield* new ArchiveFailed({ reason: `a ${declared}-byte header is not a name` });
      }
      pendingBody = { kind: 'metadata', use, content: declared, skip, taken: new Uint8Array(0) };
      return;
    }
    const kind = memberKind(flag);
    const named = overrides.path ?? nameOf(header);
    const link = overrides.link ?? text(header, 157, 100);
    const mode = Number.parseInt(text(header, 100, 8).trim() || '0', 8) & 0o777;
    overrides = {};
    if (kind === null) {
      return yield* new ArchiveFailed({
        reason: `${named || 'a member'} is a ${special(flag)}, which never leaves a guest`,
      });
    }
    const path = safePath(named);
    if (path === null) {
      if (kind === 'directory' && isRoot(named)) return;
      return yield* new ArchiveFailed({ reason: `${named} is not a member this tree can hold` });
    }
    const walked = throughLink(path);
    if (walked !== null) {
      return yield* new ArchiveFailed({ reason: `${path} would be written through the link ${walked}` });
    }
    yield* create({ path, kind, link, mode });
    if (kind === 'file' && declared + skip > 0) {
      pendingBody = { kind: 'file', path: `${root}/${path}`, content: declared, skip };
    }
  });

  const create = Effect.fn('archive.create')(function* (member: {
    readonly path: string;
    readonly kind: 'file' | 'directory' | 'symlink' | 'hardlink';
    readonly link: string;
    readonly mode: number;
  }): Effect.fn.Return<void, ArchiveFailed> {
    const at = `${root}/${member.path}`;

    if (member.kind === 'directory') return yield* directory(at, member.mode || 0o755);
    yield* directory(parentOf(at), 0o755);
    if (member.kind === 'file') {
      return yield* said(
        files.writeFile(at, new Uint8Array(0), { flag: 'wx', mode: member.mode || 0o644 }),
        `${member.path} could not be written`,
      );
    }
    if (member.kind === 'symlink') {
      if (member.link.startsWith('/') || reaches(parentOf(member.path), member.link) === null) {
        return yield* new ArchiveFailed({
          reason: `${member.path} points at ${member.link}, which is outside the tree`,
        });
      }
      yield* said(files.symlink(member.link, at), `${member.path} could not be linked`);
      links.set(member.path, member.link);
      return;
    }
    const target = safePath(member.link);
    if (target === null || throughLink(target) !== null) {
      return yield* new ArchiveFailed({
        reason: `${member.path} is a hard link to ${member.link}, which is outside the tree`,
      });
    }
    yield* said(files.link(`${root}/${target}`, at), `${member.path} could not be linked`);
  });

  const directory = (at: string, mode: number) => {
    if (made.has(at)) return Effect.void;
    made.add(at);
    return said(files.makeDirectory(at, { recursive: true, mode }), `${at} could not be made`);
  };

  const append = (at: string, bytes: Uint8Array) => said(files.writeFile(at, bytes, { flag: 'a' }), `${at} could not be written`);

  const applyMetadata = (use: PaxUse, taken: Uint8Array): void => {
    if (use === 'drop') return;
    const said = new TextDecoder().decode(taken).replace(/\0+$/, '');
    if (use === 'name') overrides.path = said;
    else if (use === 'link') overrides.link = said;
    else {
      for (const record of said.split('\n')) {
        const equals = record.indexOf('=');
        const space = record.indexOf(' ');
        if (equals < 0 || space < 0) continue;
        const key = record.slice(space + 1, equals);
        const value = record.slice(equals + 1);
        if (key === 'path') overrides.path = value;
        if (key === 'linkpath') overrides.link = value;
        if (key === 'size') overrides.size = Number(value);
      }
    }
  };

  const sizeOf = Effect.fnUntraced(function* (header: Uint8Array) {
    const override = overrides.size;
    overrides.size = undefined;
    if (override === undefined && ((header[124] ?? 0) & 0x80) !== 0) {
      let size = 0;
      for (let at = 125; at < 136; at += 1) size = size * 256 + (header[at] ?? 0);
      if (!Number.isSafeInteger(size)) return yield* new ArchiveFailed({ reason: 'a member declares a size this machine cannot read' });
      return size;
    }
    const octal = text(header, 124, 12).trim();
    const size = override ?? (octal === '' ? 0 : Number.parseInt(octal, 8));
    if (!Number.isSafeInteger(size) || size < 0) return yield* new ArchiveFailed({ reason: 'a member declares a size that is not a size' });
    return size;
  });

  const throughLink = (path: string): string | null => {
    const segments = path.split('/');
    for (let depth = 1; depth < segments.length; depth += 1) {
      const prefix = segments.slice(0, depth).join('/');
      if (links.has(prefix)) return prefix;
    }
    return null;
  };

  const reaches = (from: string, target: string): readonly string[] | null => {
    const queue = [...from.split('/'), ...target.split('/')];
    const out: string[] = [];
    let steps = 0;
    while (queue.length > 0) {
      if ((steps += 1) > RESOLUTION_CEILING) return null;
      const segment = queue.shift() as string;
      if (segment === '' || segment === '.') continue;
      if (segment === '..') {
        if (out.length === 0) return null;
        out.pop();
        continue;
      }
      const link = links.get([...out, segment].join('/'));
      if (link === undefined) {
        out.push(segment);
        continue;
      }
      if (link.startsWith('/')) return null;
      queue.unshift(...link.split('/'));
    }
    return out;
  };

  const said = <A>(work: Effect.Effect<A, PlatformError.PlatformError>, reason: string) =>
    work.pipe(Effect.mapError((cause) => new ArchiveFailed({ reason: `${reason}: ${cause.message}` })));

  const join = (chunk: Uint8Array): Uint8Array => {
    if (held.byteLength === 0) return chunk;
    const joined = concat(held, chunk);
    held = new Uint8Array(0);
    return joined;
  };

  return { take, close };
});

function metadataUse(flag: string): PaxUse | null {
  if (flag === 'x' || flag === 'X') return 'records';
  if (flag === 'g') return 'drop';
  if (flag === 'L') return 'name';
  if (flag === 'K') return 'link';
  return null;
}

function memberKind(flag: string): 'file' | 'directory' | 'symlink' | 'hardlink' | null {
  if (flag === '5') return 'directory';
  if (flag === '2') return 'symlink';
  if (flag === '1') return 'hardlink';
  if (flag === '0' || flag === '\0' || flag === '7') return 'file';
  return null;
}

function nameOf(header: Uint8Array): string {
  const name = text(header, 0, 100);
  const prefix = text(header, 345, 155);
  return prefix === '' ? name : `${prefix}/${name}`;
}

function concat(left: Uint8Array, right: Uint8Array): Uint8Array {
  const joined = new Uint8Array(left.byteLength + right.byteLength);
  joined.set(left, 0);
  joined.set(right, left.byteLength);
  return joined;
}

function text(header: Uint8Array, at: number, length: number): string {
  const raw = header.subarray(at, at + length);
  const end = raw.indexOf(0);
  return new TextDecoder().decode(end < 0 ? raw : raw.subarray(0, end));
}

function blank(header: Uint8Array): boolean {
  for (const byte of header) if (byte !== 0) return false;
  return true;
}

function special(flag: string): string {
  if (flag === '3') return 'character device';
  if (flag === '4') return 'block device';
  if (flag === '6') return 'FIFO';
  return `member of type ${flag === '\0' ? 'nul' : flag}`;
}

function parentOf(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut < 0 ? '' : path.slice(0, cut);
}

function isRoot(raw: string): boolean {
  const trimmed = raw.replace(/\/+$/, '');
  return trimmed === '' || trimmed === '.';
}

function safePath(raw: string): string | null {
  const trimmed = raw.replace(/\/+$/, '');
  if (trimmed === '' || trimmed.startsWith('/') || trimmed.includes('\0')) return null;
  const segments: string[] = [];
  for (const segment of trimmed.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') return null;
    segments.push(segment);
  }
  return segments.length === 0 ? null : segments.join('/');
}

const RESOLUTION_CEILING = 256;
