import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseImports } from './adapter';
import { js } from './languages/adapters';
import { resolveRelative } from './languages/js/resolve';
import type { Tree } from './tree';

const srcRoot = import.meta.dir;
const manifest = JSON.parse(readFileSync(join(srcRoot, '..', 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>;
};
const repoRoot = join(srcRoot, '..', '..', '..');
const workspace = new Set(
  (JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as { workspaces: { packages: string[] } }).workspaces.packages
    .flatMap((pattern) => [...new Bun.Glob(`${pattern}/package.json`).scanSync({ cwd: repoRoot })])
    .map((path) => (JSON.parse(readFileSync(join(repoRoot, path), 'utf8')) as { name?: string }).name),
);
const disk: Tree = {
  has: (path) => existsSync(path) && statSync(path).isFile(),
  read: (path) => readFileSync(path, 'utf8'),
};
const sources = [...new Bun.Glob('**/*.ts').scanSync({ cwd: srcRoot })]
  .filter((path) => !/\.(test|itest|spec|bench)\.ts$/.test(path))
  .map((path) => join(srcRoot, path));
const imports = sources.flatMap((file) => parseImports([js], disk.read(file), file, 'every').map(({ specifier }) => ({ file, specifier })));
const LANGUAGE_SPECIFIC = join(srcRoot, 'languages');

describe('code-facts package boundary', () => {
  it('reads code out of its own sources alone, every relative import landing inside them', () => {
    const escaping = imports
      .filter(({ specifier }) => specifier.startsWith('.'))
      .filter(({ file, specifier }) => !resolveRelative(specifier, file, disk)?.startsWith(`${srcRoot}/`));
    expect(escaping).toEqual([]);
  });

  it('reaches no workspace package: only what its manifest declares and Node built-ins', () => {
    const declared = Object.keys(manifest.dependencies ?? {});
    const foreign = imports
      .map(({ specifier }) => specifier)
      .filter((specifier) => !specifier.startsWith('.') && !specifier.startsWith('node:') && !declared.includes(specifier));
    expect(foreign).toEqual([]);
    expect(declared.filter((name) => workspace.has(name))).toEqual([]);
  });

  it('keeps its core free of any language: a parser and a language-specific reader are imported under languages/ alone', () => {
    const core = imports.filter(({ file }) => !file.startsWith(`${LANGUAGE_SPECIFIC}/`));
    const reaching = core.filter(
      ({ file, specifier }) =>
        (!specifier.startsWith('.') && !specifier.startsWith('node:')) ||
        (specifier.startsWith('.') && resolveRelative(specifier, file, disk)?.startsWith(`${LANGUAGE_SPECIFIC}/`)),
    );
    expect(reaching.map(({ file, specifier }) => `${relative(srcRoot, file)} -> ${specifier}`)).toEqual([]);
  });
});
