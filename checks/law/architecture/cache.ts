import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { listedAt } from '../directories';

const versions = new Map<string, string>();
export const versionAt = (root: string, revision: string): string => {
  const key = `${root}\0${revision}`;
  const held = versions.get(key);
  if (held !== undefined) return held;
  const hash = createHash('sha256')
    .update(readFileSync(Bun.resolveSync('typescript/package.json', import.meta.dir)))
    .update(readFileSync(Bun.resolveSync('oxc-parser/package.json', Bun.resolveSync('@runlith/code-facts/adapters', import.meta.dir))));
  const entries = listedAt(
    root,
    revision,
    [
      'checks/law/architecture',
      'checks/law/declarations',
      'checks/law/directories.ts',
      'checks/law/git.ts',
      'checks/law/maps.ts',
      'checks/law/store.ts',
      'checks/law/trees.ts',
      'packages/code-facts/src',
    ],
    false,
  );
  if (entries.size === 0)
    for (const path of [
      'cache.ts',
      'snapshot.ts',
      'strings.ts',
      'literals.ts',
      'vendors.ts',
      '../directories.ts',
      '../git.ts',
      '../maps.ts',
      '../store.ts',
      '../trees.ts',
    ])
      hash.update(readFileSync(join(import.meta.dir, path)));
  else for (const [path, entry] of entries) hash.update(path).update(entry.object);
  const version = hash.digest('hex');
  versions.set(key, version);
  return version;
};
