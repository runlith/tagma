import { lstatSync, readdirSync, readFileSync, readlinkSync, realpathSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { Problem } from '@runlith/navigation/adapter';
import type { CreateSnapshotParams } from 'typescript7/async';

export type Request = NonNullable<CreateSnapshotParams['fileSystem']>;

type Symlinks = NonNullable<Request['symlinks']>;

export type Links = { readonly symlinks: Symlinks; readonly removed: readonly string[] };

export type Dependencies = {
  readonly locks: readonly string[];
  readonly links: Links | null;
  readonly problem: Problem | null;
  readonly locked: string;
};

export type Moved = {
  readonly from: string;
  readonly to: string;
  readonly committed: ReadonlyMap<string, string | null>;
  readonly drift: readonly string[];
};

export type Hashing = 'sha1' | 'sha256';

const CONFIGS = new Set(['tsconfig.json', 'jsconfig.json']);

const SOURCES = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.json']);

export const LOCKS = ['bun.lock', 'bun.lockb', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock'];

const MODULES = 'node_modules';

const CYCLE = 'cycle';

const GONE = new Set(['ENOENT', 'ENOTDIR', 'EISDIR']);

export const relevant = (path: string): boolean => SOURCES.has(extname(path));

export const tracked = (path: string): boolean => relevant(path) || LOCKS.includes(path);

const git = async (root: string, args: readonly string[], absent?: number, input?: string): Promise<string> => {
  const child = Bun.spawn(['git', ...args], {
    cwd: root,
    stdin: input === undefined ? 'ignore' : new Blob([input]),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (code === 0) return out;
  if (code === absent) return '';
  throw new Error(`git ${args.join(' ')} in ${root} failed (${code}): ${err.trim()}`);
};

const listed = (out: string): readonly string[] => out.split('\0').filter((path) => path !== '');

const missing = (cause: unknown): boolean =>
  typeof cause === 'object' && cause !== null && 'code' in cause && GONE.has(String((cause as { code: unknown }).code));

export const headOf = async (root: string): Promise<string> => (await git(root, ['rev-parse', '--verify', '--quiet', 'HEAD'], 1)).trim();

export const storeOf = async (root: string): Promise<string> => resolve(root, (await git(root, ['rev-parse', '--git-common-dir'])).trim());

export const configsOf = async (root: string): Promise<readonly string[]> =>
  listed(await git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'])).filter(
    (path) => CONFIGS.has(basename(path)) && contentOf(root, path) !== null,
  );

const untrackedOf = async (root: string): Promise<readonly string[]> =>
  listed(await git(root, ['ls-files', '-z', '--others', '--exclude-standard']));

export const driftOf = async (root: string, head: string): Promise<readonly string[]> => {
  if (head === '') return listed(await git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']));
  const [tracked, untracked] = await Promise.all([git(root, ['diff', '--name-only', '-z', head, '--']).then(listed), untrackedOf(root)]);
  return [...new Set([...tracked, ...untracked])];
};

export const hashingOf = async (root: string): Promise<Hashing> =>
  (await git(root, ['rev-parse', '--show-object-format'])).trim() === 'sha256' ? 'sha256' : 'sha1';

const committedOf = async (root: string, from: string, to: string): Promise<ReadonlyMap<string, string | null>> => {
  const committed = new Map<string, string | null>();
  if (from === '' || to === '' || from === to) return committed;
  const fields = (await git(root, ['diff', '--raw', '-z', '--no-abbrev', '--no-renames', from, to])).split('\0');
  for (let at = 0; at + 1 < fields.length; at += 2) {
    const [, , blob] = (fields[at] ?? '').split(' ');
    const path = fields[at + 1];
    if (blob === undefined || path === undefined) continue;
    committed.set(path, /^0+$/.test(blob) ? null : blob);
  }
  return committed;
};

export const movedOf = async (root: string, from: string): Promise<Moved> => {
  const to = await headOf(root);
  const [committed, drift] = await Promise.all([committedOf(root, from, to), driftOf(root, to)]);
  return { from, to, committed, drift };
};

export const cleanBlobsOf = async (root: string, paths: readonly string[]): Promise<ReadonlyMap<string, string | null>> => {
  const found = new Map<string, string | null>(paths.map((path) => [path, null]));
  const present = paths.filter((path) => !path.includes('\n') && kindOf(join(root, path))?.isFile());
  if (present.length === 0) return found;
  const blobs = (await git(root, ['hash-object', '--stdin-paths'], undefined, `${present.join('\n')}\n`)).trim().split('\n');
  present.forEach((path, at) => found.set(path, blobs[at] ?? null));
  return found;
};

export const headBlobsOf = async (root: string, head: string, paths: readonly string[]): Promise<ReadonlyMap<string, string | null>> => {
  const found = new Map<string, string | null>(paths.map((path) => [path, null]));
  if (head === '' || paths.length === 0) return found;
  for (const line of listed(await git(root, ['ls-tree', '-z', head, '--', ...paths]))) {
    const tab = line.indexOf('\t');
    const [, type, blob] = line.slice(0, tab).split(' ');
    if (type === 'blob' && blob !== undefined) found.set(line.slice(tab + 1), blob);
  }
  return found;
};

export const blobOf = (root: string, path: string, hashing: Hashing): string | null => {
  let bytes: Buffer;
  try {
    bytes = readFileSync(join(root, path));
  } catch (cause) {
    if (missing(cause)) return null;
    throw cause;
  }
  const hasher = new Bun.CryptoHasher(hashing);
  hasher.update(`blob ${bytes.byteLength}\0`);
  hasher.update(bytes);
  return hasher.digest('hex');
};

export const contentOf = (root: string, path: string): string | null => {
  try {
    return readFileSync(join(root, path), 'utf8');
  } catch (cause) {
    if (missing(cause)) return null;
    throw cause;
  }
};

export const reckon = (base: string, root: string, paths: Iterable<string>, differs: Map<string, string | null>): readonly string[] => {
  const shifted: string[] = [];
  for (const path of paths) {
    if (!relevant(path)) continue;
    const mine = contentOf(root, path);
    const had = differs.has(path);
    const was = differs.get(path);
    if (mine === contentOf(base, path)) differs.delete(path);
    else differs.set(path, mine);
    if (had !== differs.has(path) || was !== differs.get(path)) shifted.push(path);
  }
  return shifted;
};

export const differencesOf = async (base: string, root: string): Promise<Map<string, string | null>> => {
  const [from, to] = await Promise.all([headOf(base), headOf(root)]);
  const [committed, theirs, mine] = await Promise.all([
    from === '' || to === '' || from === to
      ? Promise.resolve([])
      : git(root, ['diff', '--name-only', '--no-renames', '-z', from, to]).then(listed),
    driftOf(base, from),
    driftOf(root, to),
  ]);
  const differs = new Map<string, string | null>();
  reckon(base, root, new Set([...committed, ...theirs, ...mine]), differs);
  return differs;
};

const kindOf = (path: string) => {
  try {
    return lstatSync(path);
  } catch (cause) {
    if (missing(cause)) return null;
    throw cause;
  }
};

const namesOf = (directory: string): readonly string[] => {
  const names: string[] = [];
  let entries: readonly string[];
  try {
    entries = readdirSync(directory);
  } catch (cause) {
    if (missing(cause)) return [];
    throw cause;
  }
  for (const name of entries) {
    if (name.startsWith('.')) continue;
    if (!name.startsWith('@')) {
      names.push(name);
      continue;
    }
    for (const inner of namesOf(join(directory, name))) names.push(`${name}/${inner}`);
  }
  return names;
};

const versionOf = (directory: string): string => {
  const manifest = contentOf(directory, 'package.json');
  if (manifest === null) return '';
  const version = /"version"\s*:\s*"([^"]*)"/.exec(manifest);
  return version?.[1] ?? '';
};

const realOf = (path: string): string | null => {
  try {
    return realpathSync(path);
  } catch (cause) {
    if (missing(cause)) return null;
    throw cause;
  }
};

const identityOf = (seen: Map<string, string>, path: string): string | null => {
  const real = realOf(path);
  if (real === null) return null;
  const known = seen.get(real);
  if (known !== undefined) return known;
  if (!kindOf(real)?.isDirectory()) return null;
  seen.set(real, CYCLE);
  const parent = dirname(real);
  const scoped = basename(parent).startsWith('@');
  const home = scoped ? dirname(parent) : parent;
  const parts = [versionOf(real), environmentOf(seen, join(real, MODULES), null)];
  if (basename(home) === MODULES) parts.push(environmentOf(seen, home, scoped ? `${basename(parent)}/${basename(real)}` : basename(real)));
  const identity = String(Bun.hash(parts.join('\n')));
  seen.set(real, identity);
  return identity;
};

const environmentOf = (seen: Map<string, string>, directory: string, self: string | null): string =>
  namesOf(directory)
    .filter((name) => name !== self)
    .map((name) => `${name}=${identityOf(seen, join(directory, name)) ?? '-'}`)
    .join(',');

const workspaceLink = (root: string, link: string): string | null => {
  if (!kindOf(link)?.isSymbolicLink()) return null;
  const text = readlinkSync(link);
  const inside = relative(root, resolve(dirname(link), text));
  return inside.startsWith('..') || isAbsolute(inside) || inside.split(sep).includes(MODULES) ? null : text;
};

const linksOf = async (base: string, root: string): Promise<Links & { readonly installed: boolean }> => {
  const packages = listed(await git(root, ['ls-files', '-z', '--', 'package.json', '*/package.json'])).map(dirname);
  const symlinks: Symlinks = {};
  const removed: string[] = [];
  const ours = new Map<string, string>();
  const based = new Map<string, string>();
  let installed = false;
  for (const directory of new Set(packages)) {
    const mine = join(root, directory, MODULES);
    const theirs = join(base, directory, MODULES);
    if (!kindOf(mine)?.isDirectory()) continue;
    installed = true;
    for (const name of new Set([...namesOf(mine), ...namesOf(theirs)])) {
      const own = identityOf(ours, join(mine, name));
      if (own === identityOf(based, join(theirs, name))) continue;
      const at = join(theirs, name);
      if (own === null) {
        removed.push(at);
        continue;
      }
      const text = workspaceLink(root, join(mine, name));
      symlinks[at] = text === null ? { target: join(mine, name), host: true } : { target: text };
    }
  }
  return { installed, symlinks, removed };
};

const lockContentsOf = (base: string, root: string) => LOCKS.map((lock) => [contentOf(root, lock), contentOf(base, lock)] as const);

const lockedOf = (contents: ReturnType<typeof lockContentsOf>): string => String(Bun.hash(JSON.stringify(contents)));

export const locksMoved = (base: string, root: string, dependencies: Dependencies): boolean =>
  lockedOf(lockContentsOf(base, root)) !== dependencies.locked;

export const dependenciesOf = async (base: string, root: string): Promise<Dependencies> => {
  const contents = lockContentsOf(base, root);
  const locked = lockedOf(contents);
  const locks = LOCKS.filter((_, at) => contents[at]?.[0] !== contents[at]?.[1]);
  if (locks.length === 0) return { locks, links: null, problem: null, locked };
  const { installed, symlinks, removed } = await linksOf(base, root);
  if (installed)
    return Object.keys(symlinks).length + removed.length > 0
      ? { locks, links: { symlinks, removed }, problem: null, locked }
      : { locks: [], links: null, problem: null, locked };
  return {
    locks,
    locked,
    links: null,
    problem: {
      project: '.',
      problem: 'dependencies',
      detail: `${locks.join(', ')} of this worktree differs from the base checkout's and the worktree has no ${MODULES} of its own: dependencies are read from the base checkout's`,
    },
  };
};

export const requestOf = (base: string, root: string, paths: Iterable<string>, links: Links | null): Request => {
  const files: Record<string, string> = {};
  const removedPaths: string[] = [...(links?.removed ?? [])];
  for (const path of paths) {
    const content = contentOf(root, path);
    if (content === null) removedPaths.push(join(base, path));
    else files[join(base, path)] = content;
  }
  return { kind: 'layer', files, removedPaths, symlinks: links?.symlinks };
};
