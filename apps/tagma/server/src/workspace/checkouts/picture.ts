import { Effect, type FileSystem } from 'effect';
import { relative } from 'node:path';
import { blobBytesAt } from '@runlith/git/entries';
import type { GitAnswerInvalid, GitUnreadable } from '@runlith/git/repository';
import type { Git } from '@runlith/git/Git';
import { actingGit } from '../../platform/git/ownGit.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { RootId } from '../contract/wire/ids.js';
import type { RootResolutionFailure } from '../contract/wire/roots.js';
import type { FileRoots } from '../contract/service/roots.js';
import { PathUnreadable } from '../contract/service/checkouts.js';
import { confineToTree } from '../roots/proof.js';

export const PICTURE_CAPTURE = 32_000_000;

export type Picture = { readonly bytes: Uint8Array; readonly mediaType: string };

export type PictureReadRefusal = 'path-outside-tree' | 'not-found' | 'not-a-picture' | 'bad-revision' | 'path-oversized';

export type PictureFailure = RootResolutionFailure | GitUnreadable | GitAnswerInvalid | PathUnreadable | GateRefusal<PictureReadRefusal>;

const startsWith = (bytes: Uint8Array, at: number, ...expected: readonly number[]): boolean =>
  expected.every((byte, offset) => bytes[at + offset] === byte);

const ascii = (bytes: Uint8Array, at: number, word: string): boolean =>
  startsWith(bytes, at, ...[...word].map((char) => char.charCodeAt(0)));

const SVG_HEAD = /^(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!DOCTYPE[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>]/i;

const SVG_SNIFFED = 1024;

const isSvg = (bytes: Uint8Array): boolean => {
  const head = new TextDecoder('utf-8')
    .decode(bytes.subarray(0, SVG_SNIFFED))
    .replace(/^\uFEFF/, '')
    .trimStart();
  return SVG_HEAD.test(head);
};

export function pictureType(bytes: Uint8Array): string | null {
  if (startsWith(bytes, 0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (startsWith(bytes, 0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (ascii(bytes, 0, 'GIF87a') || ascii(bytes, 0, 'GIF89a')) return 'image/gif';
  if (ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WEBP')) return 'image/webp';
  if (ascii(bytes, 4, 'ftypavif') || ascii(bytes, 4, 'ftypavis')) return 'image/avif';
  if (ascii(bytes, 0, 'BM')) return 'image/bmp';
  if (startsWith(bytes, 0, 0x00, 0x00, 0x01, 0x00)) return 'image/x-icon';
  if (isSvg(bytes)) return 'image/svg+xml';
  return null;
}

const REVISION = /^[^\s:\\^~-][^\s:\\]*$/;

const workingBytes = Effect.fn('checkouts.workingBytes')(function* (
  files: FileSystem.FileSystem,
  dir: string,
  path: string,
): Effect.fn.Return<Uint8Array | null, PathUnreadable | GateRefusal<'path-oversized'>> {
  const at = `${dir}/${path}`;
  const stands = yield* Effect.result(files.stat(at));
  if (stands._tag === 'Failure') {
    if (stands.failure.reason._tag === 'NotFound') return null;
    return yield* new PathUnreadable({ path, cause: stands.failure, asking: 'probe' });
  }
  const size = Number(stands.success.size);
  if (size > PICTURE_CAPTURE) {
    return yield* new GateRefusal('path-oversized', `${path} holds ${size} bytes, past the ${PICTURE_CAPTURE} a picture is drawn from`, [
      'open it outside Tagma',
    ]);
  }
  const file = yield* Effect.result(files.readFile(at));
  if (file._tag === 'Success') return file.success;
  return yield* new PathUnreadable({ path, cause: file.failure, asking: 'read' });
});

export const readPicture = Effect.fn('checkouts.readPicture')(function* (
  roots: FileRoots['Service'],
  git: Git['Service'],
  files: FileSystem.FileSystem,
  rootId: RootId,
  path: string,
  revision: string,
): Effect.fn.Return<Picture, PictureFailure> {
  const root = yield* roots.read(rootId);
  const inside = confineToTree(root.path, path);
  if (inside === null) {
    return yield* new GateRefusal('path-outside-tree', `path escapes the checkout it was asked in: ${path}`, [
      'name a path inside the checkout, relative to its root',
    ]);
  }
  const named = relative(root.path, inside);
  if (revision !== 'working' && revision !== 'index' && !REVISION.test(revision)) {
    return yield* new GateRefusal('bad-revision', `${revision} names no side this reading answers`, [
      'name working, index, or a revision without a colon',
    ]);
  }
  const bytes =
    revision === 'working'
      ? yield* workingBytes(files, root.path, named)
      : yield* blobBytesAt(actingGit(git, 'thread-files-picture'), root.path, revision === 'index' ? '' : revision, named, {
          capture: PICTURE_CAPTURE,
        });
  if (bytes === null) {
    return yield* new GateRefusal('not-found', `${named} is no file at ${revision}`, ['name the side that holds the file']);
  }
  const mediaType = pictureType(bytes);
  if (mediaType === null) {
    return yield* new GateRefusal('not-a-picture', `${named} at ${revision} holds no picture a browser draws`, [
      'read it with read_authorship instead',
    ]);
  }
  return { bytes, mediaType };
});
