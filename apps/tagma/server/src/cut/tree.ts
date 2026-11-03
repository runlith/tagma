import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir, readlink } from 'node:fs/promises';
import { join } from 'node:path';
import { entryPath, entryRefusal } from '../installation/contract/wire/archive.js';
import { walkTarball } from '../installation/archive/tarball.js';

type TreeProof = { readonly root: string; readonly entries: ReadonlyMap<string, string> };

const OWNER_EXECUTES = 0o100;

const canonical = (...fields: readonly (string | number | boolean)[]): string => JSON.stringify(fields);

export const tarballTree = async (tarball: string): Promise<TreeProof> => {
  const entries = new Map<string, string>();
  const roots = new Set<string>();
  await walkTarball(tarball, (entry) => {
    const refusal = entryRefusal(entry);
    if (refusal !== null) throw new Error(refusal);
    const named = entryPath(entry.name);
    if (named === '' || named === '.') return null;
    const parts = named.split('/');
    roots.add(parts[0]!);
    for (let depth = 1; depth < parts.length; depth += 1) entries.set(parts.slice(0, depth).join('/'), canonical('directory'));
    const path = parts.join('/');
    if (entry.kind === 'directory') {
      entries.set(path, canonical('directory'));
      return null;
    }
    if (entry.kind === 'link') {
      entries.set(path, canonical('link', entry.target ?? ''));
      return null;
    }
    const hash = createHash('sha512');
    return {
      chunk: (bytes) => void hash.update(bytes),
      end: () => entries.set(path, canonical('file', (entry.mode & OWNER_EXECUTES) !== 0, entry.size, hash.digest('base64'))),
    };
  });
  const [root] = roots;
  if (roots.size !== 1 || root === undefined || entries.get(root) !== canonical('directory')) {
    throw new Error(`the tarball holds ${roots.size} roots, and a package is one directory`);
  }
  return { root, entries };
};

export const standingTree = async (directory: string, name: string): Promise<ReadonlyMap<string, string>> => {
  const entries = new Map<string, string>();
  const walk = async (path: string, relative: string): Promise<void> => {
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) entries.set(relative, canonical('link', await readlink(path)));
    else if (stat.isDirectory()) {
      entries.set(relative, canonical('directory'));
      for (const child of await readdir(path)) await walk(join(path, child), `${relative}/${child}`);
    } else if (stat.isFile()) {
      const hash = createHash('sha512');
      for await (const chunk of createReadStream(path)) hash.update(chunk);
      entries.set(relative, canonical('file', (stat.mode & OWNER_EXECUTES) !== 0, stat.size, hash.digest('base64')));
    } else entries.set(relative, canonical('other'));
  };
  await walk(directory, name);
  return entries;
};

export const treeDifference = (expected: ReadonlyMap<string, string>, standing: ReadonlyMap<string, string>): string | null => {
  for (const [path, entry] of expected) {
    const found = standing.get(path);
    if (found === undefined) return `${path} is missing`;
    if (found !== entry) return `${path} differs`;
  }
  for (const path of standing.keys()) if (!expected.has(path)) return `${path} is not in the tarball`;
  return null;
};
