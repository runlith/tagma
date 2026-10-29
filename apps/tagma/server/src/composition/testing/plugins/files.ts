import { join } from 'node:path';
import { Effect, FileSystem } from 'effect';
import { spawnedEffect } from '../../../platform/testing/spawn.js';

export type Files = Readonly<Record<string, string>>;

export const skill = (description: string) => `---\ndescription: ${description}\n---\n\nDo it well.\n`;

export const written = Effect.fnUntraced(function* (root: string, files: Files) {
  const fs = yield* FileSystem.FileSystem;
  for (const [path, text] of Object.entries(files)) {
    yield* fs.makeDirectory(join(root, path, '..'), { recursive: true });
    yield* fs.writeFileString(join(root, path), text);
  }
  return root;
});

const git = Effect.fnUntraced(function* (root: string, args: readonly string[]) {
  const ran = yield* spawnedEffect(['git', '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: root });
  if (!ran.success) return yield* Effect.die(new Error(`git ${args.join(' ')} in ${root}: ${ran.stderr.toString()}`));
  return ran.stdout.toString().trim();
});

export const committed = Effect.fnUntraced(function* (root: string, files: Files) {
  yield* written(root, files);
  yield* git(root, ['add', '-A']);
  yield* git(root, ['commit', '-q', '--allow-empty', '-m', 'files']);
  return yield* git(root, ['rev-parse', 'HEAD']);
});

export const repository = Effect.fnUntraced(function* (root: string, files: Files) {
  yield* git(root, ['init', '-q', '-b', 'main']);
  return yield* committed(root, files);
});
