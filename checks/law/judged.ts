import { existsSync, mkdirSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { entriesAt, git } from './git';

export const judgedFile = (root: string, commit: string, disk: string): string => {
  const path = relative(realpathSync(root), disk);
  if (path.startsWith('..')) return disk;
  const entry = entriesAt(root, commit, [path], false).get(path);
  if (entry === undefined || entry.kind !== 'blob') return disk;
  if (existsSync(disk) && git(root, ['hash-object', '--no-filters', '--', disk]).toString().trim() === entry.object) return disk;
  const directory = join(
    git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']).toString().trim(),
    'runlith-law',
    'judged',
    entry.object,
  );
  const target = join(directory, basename(path));
  if (existsSync(target)) return target;
  mkdirSync(directory, { recursive: true });
  const staged = `${target}.${process.pid}`;
  writeFileSync(staged, git(root, ['cat-file', 'blob', entry.object]));
  renameSync(staged, target);
  return target;
};
