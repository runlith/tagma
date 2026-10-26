import { posix } from 'node:path';
import type { Context, Resolution, Resolver, ResolverInput, Traced } from '../../adapter';
import { UnsupportedSource } from '../../imports';
import type { Tree } from '../../tree';

const PROJECT = ['pyproject.toml', 'setup.cfg', 'setup.py'];

const join = (dir: string, path: string): string => (dir === '' ? path : path === '' ? dir : `${dir}/${path}`);

const parent = (dir: string): string => (posix.dirname(dir) === '.' ? '' : posix.dirname(dir));

const split = (specifier: string): { readonly module: string; readonly name: string | undefined } => {
  const at = specifier.indexOf(':');
  return at === -1 ? { module: specifier, name: undefined } : { module: specifier.slice(0, at), name: specifier.slice(at + 1) };
};

const moduleAt = (dir: string, tree: Tree): string | undefined =>
  [join(dir, '__init__.py'), `${dir}.py`, join(dir, '__init__.pyi'), `${dir}.pyi`].find((path) => tree.has(path));

const listsUnder = (tree: Tree, dir: string): boolean => {
  if (tree.paths === undefined) return false;
  for (const path of tree.paths(dir)) if (dir === '' || path.startsWith(`${dir}/`)) return true;
  return false;
};

const landing = (dir: string, name: string | undefined, tree: Tree): Resolution => {
  if (name !== undefined) {
    const submodule = moduleAt(join(dir, name), tree);
    if (submodule !== undefined) return { to: submodule };
    if (listsUnder(tree, join(dir, name))) return { unlisted: join(dir, name) };
  }
  const module = dir === '' ? undefined : moduleAt(dir, tree);
  if (module !== undefined) return { to: module };
  return { unlisted: name === undefined ? dir : join(dir, name) };
};

export function resolve(specifier: string, from: string, tree: Tree): Resolution | null {
  if (!specifier.startsWith('.')) return null;
  const { module, name } = split(specifier);
  const dots = /^\.*/.exec(module)?.[0].length ?? 0;
  let dir = posix.dirname(from) === '.' ? '' : posix.dirname(from);
  for (let up = 1; up < dots; up += 1) {
    if (dir === '') return { unlisted: join('', module.slice(dots).replaceAll('.', '/')) };
    dir = parent(dir);
  }
  const rest = module.slice(dots);
  return landing(join(dir, rest.replaceAll('.', '/')), name, tree);
}

const rootsOf = (context: Context): readonly string[] | undefined => {
  const { roots } = context;
  if (roots === undefined) return undefined;
  if (!Array.isArray(roots) || !roots.every((one) => typeof one === 'string')) {
    throw new UnsupportedSource('', 'the Python resolution context names `roots` that are not a list of directories');
  }
  return roots.map((one) => one.replace(/\/+$/, ''));
};

export function resolverOf(tree: Tree, from: string, context: Context): Resolver {
  const declared = rootsOf(context);
  const projects = new Map<string, string | undefined>();
  const projectOf = (dir: string): string | undefined => {
    if (projects.has(dir)) return projects.get(dir);
    const found = PROJECT.some((name) => tree.has(join(dir, name))) ? dir : dir === '' ? undefined : projectOf(parent(dir));
    projects.set(dir, found);
    return found;
  };
  const laid = new Map<string, readonly string[]>();
  const rootsFor = (file: string): readonly string[] => {
    if (declared !== undefined) return declared;
    const project = projectOf(posix.dirname(file) === '.' ? '' : posix.dirname(file));
    if (project === undefined) return [''];
    let roots = laid.get(project);
    if (roots === undefined) {
      const src = join(project, 'src');
      roots = listsUnder(tree, src) ? [src] : [project];
      laid.set(project, roots);
    }
    return roots;
  };
  const tracedIn = (over: Tree, specifier: string, file: string): Traced => {
    const absent: string[] = [];
    const observed = declared === undefined ? inputs(posix.dirname(file)) : [];
    const measuring: Tree = {
      ...over,
      has: (path) => {
        const hit = over.has(path);
        if (!hit && !absent.includes(path)) absent.push(path);
        return hit;
      },
    };
    const { module, name } = split(specifier);
    if (module === '' || module.startsWith('.')) return { resolution: null, absent, packages: [], inputs: observed };
    const top = module.split('.')[0] as string;
    for (const root of rootsFor(file)) {
      const owned = moduleAt(join(root, top), measuring) !== undefined || listsUnder(over, join(root, top));
      if (!owned) continue;
      const resolution = landing(join(root, module.replaceAll('.', '/')), name, measuring);
      return { resolution, absent, packages: [], inputs: observed };
    }
    return { resolution: null, absent, packages: [], inputs: observed };
  };
  const importer = join(from, '__importer__.py');
  return {
    manifest: PROJECT.map((name) => join(projectOf(from) ?? '', name)).find((path) => tree.has(path)) ?? '',
    resolve: (specifier, file = importer) => tracedIn(tree, specifier, file).resolution,
    traced: (specifier, file = importer) => tracedIn(tree, specifier, file),
    over: (over, specifier, file = importer) => tracedIn(over, specifier, file).resolution,
    manifests: () => [],
  };
}

export const inputs = (from: string): readonly string[] => {
  const found: string[] = [];
  for (let dir = from.replace(/\/+$/, ''); ; dir = parent(dir)) {
    for (const name of PROJECT) found.push(join(dir, name));
    if (dir === '') return found;
  }
};

export const input = (path: string): ResolverInput | undefined => (PROJECT.includes(posix.basename(path)) ? { kind: 'config' } : undefined);
