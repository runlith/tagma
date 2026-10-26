import { Effect, FileSystem } from 'effect';
import { type Installation, type InstallationPart, InstallationUnreadable } from '../contract/wire/manifest.js';
import { partPath } from './read.js';

const CHECKED_AT_ONCE = 16;

const NAMED_MISSING = 5;

const standing = Effect.fnUntraced(function* (files: FileSystem.FileSystem, root: string, part: InstallationPart) {
  const at = partPath(root, part.path);
  const found = yield* Effect.result(files.exists(at));
  if (found._tag === 'Success') return found.success;
  if (found.failure.reason._tag === 'NotFound') return false;
  return yield* new InstallationUnreadable({ root, role: part.role, path: part.path, detail: found.failure.reason._tag });
});

export const serverPartsStand = Effect.fn('installation.serverPartsStand')(function* (installation: Installation) {
  const files = yield* FileSystem.FileSystem;
  const parts = installation.manifest.parts.filter((part) => part.role === 'server');
  const present = yield* Effect.forEach(parts, (part) => standing(files, installation.root, part), { concurrency: CHECKED_AT_ONCE });
  const [first, ...others] = parts.filter((_, at) => !present[at]);
  if (first === undefined) return;
  const also =
    others.length === 0
      ? ''
      : `, and ${others.length} more: ${others
          .slice(0, NAMED_MISSING)
          .map((part) => part.path)
          .join(', ')}${others.length > NAMED_MISSING ? ', …' : ''}`;
  return yield* new InstallationUnreadable({
    root: installation.root,
    role: 'server',
    path: first.path,
    detail: `the file is not in the installation${also}`,
  });
});
