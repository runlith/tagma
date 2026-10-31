import { expect, test } from 'bun:test';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { resolveRelative } from '@runlith/code-facts/js/resolve';
import type { Tree } from '@runlith/code-facts/tree';

const SOURCE = join(import.meta.dir, '..');
const REPOSITORY = realpathSync(join(SOURCE, '../../../..'));

const disk: Tree = {
  has: (path) => existsSync(path) && statSync(path).isFile(),
  read: (path) => readFileSync(path, 'utf8'),
};

const workspaceSource = (specifier: string, from: string): string | null => {
  const resolved = (() => {
    try {
      return realpathSync(Bun.resolveSync(specifier, dirname(from)));
    } catch {
      return null;
    }
  })();
  if (resolved === null || !resolved.startsWith(`${REPOSITORY}/`) || resolved.includes('/node_modules/')) return null;
  return /\.(?:[cm]?ts|tsx)$/.test(resolved) ? resolved : null;
};

const transpilers = { ts: new Bun.Transpiler({ loader: 'ts' }), tsx: new Bun.Transpiler({ loader: 'tsx' }) };

const MACRO = /from\s+(['"])([^'"]+)\1\s+with\s*\{\s*type:\s*['"]macro['"]\s*\}/gu;

type Edge = { readonly specifier: string; readonly target: string | null; readonly package: boolean };

const edges = new Map<string, readonly Edge[]>();

const edgesOf = (file: string): readonly Edge[] => {
  const known = edges.get(file);
  if (known !== undefined) return known;
  const text = disk.read(file).replace(/^#!.*/u, '');
  const macros = new Set([...text.matchAll(MACRO)].map((match) => match[2]));
  const found = (file.endsWith('x') ? transpilers.tsx : transpilers.ts)
    .scanImports(text)
    .map((one) => one.path)
    .filter((specifier) => !macros.has(specifier))
    .map((specifier) =>
      specifier.startsWith('.')
        ? { specifier, target: resolveRelative(specifier, file, disk), package: false }
        : { specifier, target: workspaceSource(specifier, file), package: true },
    );
  edges.set(file, found);
  return found;
};

const loadedFrom = (entry: string): ReadonlyMap<string, string> => {
  const packages = new Map<string, string>();
  const seen = new Set<string>();
  const queue = [join(SOURCE, entry)];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file) || !/\.[cm]?[jt]sx?$/.test(file)) continue;
    seen.add(file);
    for (const edge of edgesOf(file)) {
      if (edge.package && !packages.has(edge.specifier)) packages.set(edge.specifier, relative(REPOSITORY, file));
      if (edge.target !== null) queue.push(edge.target);
    }
  }
  return packages;
};

const PARSING = [
  'oxc-parser',
  'typescript',
  '@runlith/code-facts/blobs',
  '@runlith/code-facts/adapters',
  '@tagma/inspection/node/implementations',
  '@tagma/inspection/node/judge',
];

const parsingOf = (packages: ReadonlyMap<string, string>) =>
  PARSING.filter((name) => packages.has(name)).map((name) => `${name} (${packages.get(name)})`);

test('the server and the CLI load no source parser on their event loop; the inspection workers load it', () => {
  expect(parsingOf(loadedFrom('composition/developer/server.ts'))).toEqual([]);
  expect(parsingOf(loadedFrom('composition/developer/cli.ts'))).toEqual([]);
  for (const worker of ['enforcement/workers/judge.worker.ts', 'enforcement/workers/reach.worker.ts']) {
    expect(PARSING.filter((name) => name !== 'typescript' && !loadedFrom(worker).has(name))).toEqual([]);
  }
});
