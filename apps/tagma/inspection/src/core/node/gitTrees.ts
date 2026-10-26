import { UnsupportedSource } from '@runlith/code-facts/imports';
import type { TreeDiffEntry } from '@runlith/code-facts/tree';

export const git = (repository: string, args: readonly string[], input?: string): Buffer => {
  const ran = Bun.spawnSync(['git', ...args], { cwd: repository, stdin: input === undefined ? undefined : Buffer.from(input) });
  if (ran.exitCode !== 0 && !(args[0] === 'grep' && ran.exitCode === 1)) {
    throw new Error(`git ${args.join(' ')} exited ${ran.exitCode}: ${ran.stderr.toString().trim()}`);
  }
  return ran.stdout;
};

export const specs = (parts: readonly string[]): readonly string[] =>
  parts.includes('') ? [] : ['--', ...parts.map((part) => `:(literal)${part}`)];

const strict = new TextDecoder('utf-8', { fatal: true });

export const decoded = (path: string, bytes: Uint8Array): string => {
  try {
    return strict.decode(bytes);
  } catch {
    throw new UnsupportedSource(path, 'its bytes are not UTF-8 text');
  }
};

const LISTED = /^\d+ (\w+) ([0-9a-f]+) +(-|\d+)$/;

export const grepped = (out: Buffer, prefix: string): ReadonlySet<string> => {
  const found = new Set<string>();
  for (const record of out.toString().split('\0')) if (record.startsWith(prefix)) found.add(record.slice(prefix.length));
  return found;
};

export type Listed = Map<string, { readonly object: string; readonly size: number }>;
export type Wanted = readonly { readonly path: string; readonly object: string }[];

export type DiffEntry = TreeDiffEntry;

const NULL_OBJECT = /^0+$/;

export const parseTreeId = (output: string): string => output.trim().split('\n')[0] ?? '';

export const parseDiffTreeZero = (output: string): TreeDiffEntry[] => {
  const parts = output.split('\0');
  const entries: TreeDiffEntry[] = [];
  for (let at = 0; at + 1 < parts.length; at += 2) {
    const info = parts[at] ?? '';
    const path = parts[at + 1] ?? '';
    if (path === '' || !info.startsWith(':')) continue;
    const fields = info.split(' ');
    if (fields.length < 5) continue;
    const before = fields[2] ?? '';
    const after = fields[3] ?? '';
    entries.push({
      path,
      before: before === '' || NULL_OBJECT.test(before) ? null : before,
      after: after === '' || NULL_OBJECT.test(after) ? null : after,
      status: fields[4] ?? '',
    });
  }
  return entries;
};

export const listedOf = (output: string): Listed => {
  const listed: Listed = new Map();
  for (const record of output.split('\0')) {
    const tab = record.indexOf('\t');
    const fields = tab === -1 ? null : LISTED.exec(record.slice(0, tab));
    if (fields === null || fields[1] !== 'blob' || fields[2] === undefined) continue;
    listed.set(record.slice(tab + 1), { object: fields[2], size: Number(fields[3]) });
  }
  return listed;
};

export const commitListing = (repository: string, commit: string, parts: readonly string[]): Listed =>
  listedOf(git(repository, ['ls-tree', '-r', '-l', '-z', '--full-tree', commit, ...specs(parts)]).toString());

export const treeIdOf = (repository: string, commit: string): string =>
  parseTreeId(git(repository, ['rev-parse', '--verify', `${commit}^{tree}`]).toString());

export const diffEntriesOf = (repository: string, from: string, to: string): TreeDiffEntry[] =>
  parseDiffTreeZero(git(repository, ['diff-tree', '-r', '-z', '--no-renames', from, to, '--']).toString());

export const pointListingOf = (repository: string, tree: string, paths: readonly string[]): Listed => {
  if (paths.length === 0) return new Map();
  return listedOf(git(repository, ['ls-tree', '-l', '-z', '--full-tree', tree, ...specs(paths)]).toString());
};

export const commitLoad = (repository: string) => (wanted: Wanted) => {
  const texts = new Map<string, string>();
  const objects = [...new Set(wanted.map(({ object }) => object))];
  if (objects.length === 0) return texts;
  const pathOf = new Map(wanted.map(({ path, object }) => [object, path]));
  const out = git(repository, ['cat-file', '--batch'], `${objects.join('\n')}\n`);
  let at = 0;
  while (at < out.length) {
    const end = out.indexOf(10, at);
    const [object = '', type, size] = out.subarray(at, end).toString().split(' ');
    if (type !== 'blob') throw new Error(`git cat-file answered ${out.subarray(at, end).toString()}`);
    const length = Number(size);
    texts.set(object, decoded(pathOf.get(object) ?? object, out.subarray(end + 1, end + 1 + length)));
    at = end + 1 + length + 1;
  }
  return texts;
};

export const commitGrep = (repository: string, commit: string, parts: readonly string[]) => (words: readonly string[]) =>
  words.length === 0
    ? new Set<string>()
    : grepped(
        git(repository, ['grep', '-l', '-z', '-F', '-w', ...words.flatMap((word) => ['-e', word]), commit, ...specs(parts)]),
        `${commit}:`,
      );

export const within = (parts: readonly string[], path: string): boolean =>
  parts.some((part) => part === '' || path === part || path.startsWith(part.endsWith('/') ? part : `${part}/`));
