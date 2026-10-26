import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, extname, join, relative, sep } from 'node:path';

export const PRELOAD_ROOT = 'TAGMA_JUDGED_ROOT';
export const PRELOAD_TREE = 'TAGMA_JUDGED_TREE';

type Script = 'ts' | 'tsx' | 'js' | 'jsx';
type Loader = Script | 'json';

const LOADERS: Readonly<Record<string, Loader>> = {
  '.ts': 'ts',
  '.mts': 'ts',
  '.cts': 'ts',
  '.tsx': 'tsx',
  '.js': 'js',
  '.mjs': 'js',
  '.cjs': 'js',
  '.jsx': 'jsx',
  '.json': 'json',
};

type Loaded =
  | { readonly contents: string; readonly loader: Loader }
  | { readonly exports: Readonly<Record<string, unknown>>; readonly loader: 'object' };

export type Git = (args: readonly string[]) => Buffer | null;

export type TreeLoad = {
  readonly filter: RegExp;
  readonly load: (args: { readonly path: string }) => Loaded;
};

const COMMONJS = /\b(?:module|exports|require)\b/u;

const commonJs = (path: string, text: string, loader: Script): boolean => {
  if (path.endsWith('.cjs') || path.endsWith('.cts')) return true;
  if (path.endsWith('.mjs') || path.endsWith('.mts') || !COMMONJS.test(text)) return false;
  const scanned = new Bun.Transpiler({ loader }).scan(text);
  return scanned.exports.length === 0 && !scanned.imports.some((one) => one.kind === 'import-statement') && !text.includes('import.meta');
};

//! Bun hands a plugin's source to the ES module loader whatever its form, so a CommonJS file is run here and given over as its module.exports.
const evaluated = (path: string, text: string, loader: Script): Loaded => {
  const module: { exports: unknown } = { exports: {} };
  const code = new Bun.Transpiler({ loader, target: 'bun' }).transformSync(text);
  new Function('exports', 'require', 'module', '__filename', '__dirname', code)(
    module.exports,
    createRequire(path),
    module,
    path,
    dirname(path),
  );
  const value = module.exports;
  const named = typeof value === 'object' && value !== null ? (value as Readonly<Record<string, unknown>>) : {};
  return { exports: { ...named, __esModule: true, default: value }, loader: 'object' };
};

const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

export const treeLoad = (root: string, tree: string, git: Git): TreeLoad | null => {
  const top = realpathSync(root);
  const differing = git(['diff', '--name-only', '-z', '--no-renames', '--ignore-submodules', '--diff-filter=MT', tree, '--']);
  if (differing === null) throw new Error(`git could not compare ${tree} with the checkout`);
  const paths = differing
    .toString()
    .split('\0')
    .filter((path) => LOADERS[extname(path)] !== undefined && !path.split('/').includes('node_modules'));
  if (paths.length === 0) return null;
  return {
    filter: new RegExp(`^(?:${paths.map((path) => escaped(join(top, path))).join('|')})$`, 'u'),
    load: ({ path }) => {
      const at = relative(top, path).split(sep).join('/');
      const blob = git(['cat-file', 'blob', `${tree}:${at}`]);
      if (blob === null) throw new Error(`git could not read ${at} at ${tree}`);
      const text = new TextDecoder().decode(blob);
      const loader = LOADERS[extname(path)]!;
      return loader !== 'json' && commonJs(path, text, loader) ? evaluated(path, text, loader) : { contents: text, loader };
    },
  };
};
