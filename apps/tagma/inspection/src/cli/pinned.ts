import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const PINNED = ['apps/tagma/inspection', 'packages/code-facts'] as const;
const KEPT = 4;
const ABANDONED_MS = 10 * 60_000;

const git = (cwd: string, args: readonly string[]): string => {
  const ran = Bun.spawnSync(['git', ...args], { cwd });
  if (ran.exitCode !== 0) throw new Error(`git ${args.join(' ')} exited ${ran.exitCode}: ${ran.stderr.toString().trim()}`);
  return ran.stdout.toString().trim();
};

const entries = (modules: string): readonly string[] => {
  if (!existsSync(modules)) return [];
  return readdirSync(modules).flatMap((name) => {
    if (name.startsWith('.')) return [];
    if (name.startsWith('@')) return readdirSync(join(modules, name)).map((inner) => `${name}/${inner}`);
    return [name];
  });
};

const linked = (repository: string, into: string) => {
  const pinned = new Map(PINNED.map((path) => [realpathSync(join(repository, path)), join(into, path)]));
  for (const path of PINNED) {
    const modules = join(repository, path, 'node_modules');
    for (const name of entries(modules)) {
      const real = realpathSync(join(modules, name));
      const target = pinned.get(real) ?? real;
      const link = join(into, path, 'node_modules', name);
      mkdirSync(dirname(link), { recursive: true });
      symlinkSync(relative(dirname(link), target), link);
    }
  }
};

export const materialized = (repository: string): string => {
  const trees = PINNED.map((path) => git(repository, ['rev-parse', `HEAD:${path}`]));
  const key = Bun.hash(trees.join('\n')).toString(16);
  const cache = join(resolve(repository, git(repository, ['rev-parse', '--git-common-dir'])), 'tagma-inspection');
  const into = join(cache, key);
  if (existsSync(join(into, 'ready'))) {
    utimesSync(into, new Date(), new Date());
    return into;
  }
  const building = `${into}.${process.pid}`;
  rmSync(building, { recursive: true, force: true });
  mkdirSync(building, { recursive: true });
  const archive = Bun.spawnSync(['sh', '-c', `git archive --format=tar HEAD ${PINNED.join(' ')} | tar -x -C "${building}"`], {
    cwd: repository,
  });
  if (archive.exitCode !== 0) throw new Error(`git archive exited ${archive.exitCode}: ${archive.stderr.toString().trim()}`);
  linked(repository, building);
  writeFileSync(join(building, 'ready'), `${trees.join('\n')}\n`);
  try {
    renameSync(building, into);
  } catch {
    rmSync(building, { recursive: true, force: true });
  }
  const now = Date.now();
  for (const name of readdirSync(cache)) {
    if (name.includes('.') && now - statSync(join(cache, name)).mtimeMs > ABANDONED_MS)
      rmSync(join(cache, name), { recursive: true, force: true });
  }
  const held = readdirSync(cache)
    .filter((name) => !name.includes('.') && lstatSync(join(cache, name)).isDirectory())
    .map((name) => ({ name, at: statSync(join(cache, name)).mtimeMs }))
    .sort((left, right) => right.at - left.at);
  for (const { name } of held.slice(KEPT)) if (name !== key) rmSync(join(cache, name), { recursive: true, force: true });
  return into;
};

if (import.meta.main) {
  const repository = git(process.cwd(), ['rev-parse', '--show-toplevel']);
  const into = materialized(repository);
  const args = Bun.argv.slice(2);
  const ran = Bun.spawnSync(
    ['bun', join(into, 'apps/tagma/inspection/src/cli/inspect.ts'), ...(args.includes('--repo') ? [] : ['--repo', repository]), ...args],
    {
      stdio: ['inherit', 'inherit', 'inherit'],
    },
  );
  process.exitCode = ran.exitCode ?? 1;
}
