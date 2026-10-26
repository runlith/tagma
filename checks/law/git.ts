import { spawnSync } from 'node:child_process';

export const git = (root: string, args: readonly string[], input?: string): Buffer => {
  const result = spawnSync('git', ['-C', root, ...args], { input, timeout: 60_000, maxBuffer: 128 * 1024 * 1024 });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) throw new Error(`git ${args[0]}: ${result.stderr.toString()}`);
  return result.stdout;
};

export const mentioning = (root: string, snapshot: string, pattern: string, paths: readonly string[]): string[] => {
  const result = spawnSync(
    'git',
    ['-C', root, 'grep', '-l', '-z', '-E', pattern, snapshot, '--', ...paths.map((one) => `:(literal)${one}`)],
    { timeout: 60_000, maxBuffer: 128 * 1024 * 1024 },
  );
  if (result.error !== undefined) throw result.error;
  if (result.status === 1 && result.stderr.length === 0) return [];
  if (result.status !== 0) throw new Error(`git grep: ${result.stderr.toString()}`);
  const prefix = `${snapshot}:`;
  return result.stdout
    .toString()
    .split('\0')
    .filter((one) => one !== '')
    .map((one) => {
      if (!one.startsWith(prefix)) throw new Error(`unread grep entry: ${one}`);
      return one.slice(prefix.length);
    });
};

export const changedBetween = (root: string, from: string, to: string): string[] =>
  git(root, ['diff-tree', '-r', '-z', '--name-only', '--no-renames', from, to])
    .toString()
    .split('\0')
    .filter((one) => one !== '');

export const present = (root: string, objects: readonly string[]): Set<string> => {
  if (objects.length === 0) return new Set();
  const rows = git(root, ['cat-file', '--batch-check=%(objectname)'], `${objects.join('\n')}\n`)
    .toString()
    .split('\n');
  return new Set(objects.filter((object, at) => rows[at] === object));
};

export type Entry = { readonly object: string; readonly mode: string; readonly kind: string };

export const entriesAt = (root: string, snapshot: string, paths: readonly string[], recursive: boolean): Map<string, Entry> => {
  const entries = new Map<string, Entry>();
  const listing = git(root, ['ls-tree', ...(recursive ? ['-r'] : []), '-z', snapshot, '--', ...paths.map((one) => `:(literal)${one}`)]);
  for (const row of listing.toString().split('\0')) {
    if (row === '') continue;
    const match = /^(\d+) (\S+) ([0-9a-f]+)\t(.*)$/s.exec(row);
    if (match === null) throw new Error(`unread tree entry: ${row}`);
    entries.set(match[4]!, { mode: match[1]!, kind: match[2]!, object: match[3]! });
  }
  return entries;
};

export const blobTexts = (root: string, ids: readonly string[]): Map<string, string> => {
  const texts = new Map<string, string>();
  const unique = [...new Set(ids)];
  if (unique.length === 0) return texts;
  const bytes = git(root, ['cat-file', '--batch'], `${unique.join('\n')}\n`);
  let at = 0;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  for (const object of unique) {
    const end = bytes.indexOf(10, at);
    const header = bytes.subarray(at, end).toString();
    const match = /^([0-9a-f]+) blob (\d+)$/.exec(header);
    if (match === null || match[1] !== object) throw new Error(`unread source blob: ${header}`);
    const size = Number(match[2]);
    at = end + 1;
    texts.set(object, decoder.decode(bytes.subarray(at, at + size)));
    at += size + 1;
  }
  if (at !== bytes.length) throw new Error('unexpected bytes after source blobs');
  return texts;
};
