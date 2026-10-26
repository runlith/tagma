import { cp, mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

export type FetchedSource =
  | { readonly kind: 'path'; readonly path: string }
  | { readonly kind: 'npm'; readonly name: string; readonly range: string }
  | { readonly kind: 'github'; readonly repository: string; readonly ref: string };

const NPM_REGISTRY = 'https://registry.npmjs.org';
const COPIED_AWAY = new Set(['node_modules', '.git']);

const expanded = (source: string): string => (source === '~' || source.startsWith('~/') ? join(homedir(), source.slice(1)) : source);

export const sourceOf = (source: string): FetchedSource => {
  const text = source.trim();
  const github = /^(?:github:|https:\/\/github\.com\/)([\w.-]+\/[\w.-]+?)(?:\.git)?(?:#(.+))?$/.exec(text);
  if (github !== null) return { kind: 'github', repository: github[1] as string, ref: github[2] ?? 'HEAD' };
  if (text.startsWith('.') || text.startsWith('~') || isAbsolute(text)) return { kind: 'path', path: resolve(expanded(text)) };
  const at = text.lastIndexOf('@');
  return at > 0 ? { kind: 'npm', name: text.slice(0, at), range: text.slice(at + 1) } : { kind: 'npm', name: text, range: 'latest' };
};

const run = async (argv: readonly string[], cwd: string, what: string): Promise<void> => {
  const child = Bun.spawn([...argv], { cwd, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
  const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  if (code !== 0) throw new Error(`${what} exited ${code}: ${stderr.trim().split('\n').slice(-3).join(' ')}`);
};

const downloaded = async (url: string, into: string, what: string): Promise<void> => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${what}: ${url} answered ${response.status}`);
  const archive = join(into, '.archive.tgz');
  await writeFile(archive, new Uint8Array(await response.arrayBuffer()));
  await run(['tar', '-xzf', archive, '-C', into], into, `unpacking ${what}`);
  await rm(archive);
};

type NpmDocument = {
  readonly 'dist-tags'?: Readonly<Record<string, string>>;
  readonly versions?: Readonly<Record<string, { readonly dist?: { readonly tarball?: string } }>>;
};

const npmTarball = async (name: string, range: string): Promise<string> => {
  const response = await fetch(`${NPM_REGISTRY}/${name.replace('/', '%2F')}`);
  if (!response.ok) throw new Error(`the npm registry answered ${response.status} for ${name}`);
  const document = (await response.json()) as NpmDocument;
  const versions = Object.keys(document.versions ?? {});
  const tagged = document['dist-tags']?.[range];
  const chosen =
    tagged ??
    versions
      .filter((version) => Bun.semver.satisfies(version, range))
      .sort((left, right) => Bun.semver.order(right, left))[0];
  const tarball = chosen === undefined ? undefined : document.versions?.[chosen]?.dist?.tarball;
  if (tarball === undefined) throw new Error(`no version of ${name} satisfies ${range}`);
  return tarball;
};

const onlyDirectory = async (at: string): Promise<string> => {
  const entries = (await readdir(at, { withFileTypes: true })).filter((entry) => !entry.name.startsWith('.'));
  const only = entries[0];
  if (entries.length !== 1 || only === undefined || !only.isDirectory()) throw new Error('the archive does not hold one package directory');
  return join(at, only.name);
};

export const fetchInto = async (source: FetchedSource, staging: string, into: string): Promise<void> => {
  await mkdir(staging, { recursive: true });
  if (source.kind === 'path') {
    if (!(await stat(source.path)).isDirectory()) throw new Error(`${source.path} is not a directory`);
    await cp(source.path, into, { recursive: true, filter: (path) => !COPIED_AWAY.has(path.split('/').pop() ?? '') });
    return;
  }
  const url =
    source.kind === 'npm'
      ? await npmTarball(source.name, source.range)
      : `https://codeload.github.com/${source.repository}/tar.gz/${source.ref}`;
  await downloaded(url, staging, source.kind === 'npm' ? source.name : source.repository);
  await rename(await onlyDirectory(staging), into);
};

export const installDependencies = (directory: string): Promise<void> =>
  run([process.execPath, 'install', '--production', '--omit=peer', '--no-save'], directory, 'installing the adapter dependencies');
