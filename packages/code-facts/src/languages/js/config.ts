import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import ts from 'typescript';
import type { Resolution } from '../../adapter';
import { CopyStale, InputAbsent, UnsupportedSource } from '../../imports';
import { type Installed, submoduleOf, type Tree } from '../../tree';

export type Built = ReadonlyMap<string, string>;

export const namesConfig = (path: string): boolean => path.endsWith('.json');

const installedPlace = (path: string): boolean => path.startsWith('../') || path.split('/').includes('node_modules');

export const environmental = (tree: Tree, path: string): boolean => installedPlace(path) || submoduleOf(tree, path) !== undefined;

export const installedStamp = (found: Installed | undefined): string | null =>
  found === undefined ? null : createHash('sha256').update(found.at).update('\0').update(found.text).digest('hex');

export const installedOf = (tree: Tree, path: string): string | null | undefined =>
  !tree.has(path) && environmental(tree, path) ? installedStamp(tree.environment?.read(path)) : undefined;

type Mount = {
  readonly root: string;
  readonly absolute: (path: string) => string;
  readonly local: (path: string) => string;
  readonly aimed: (base: string, target: string) => string;
};

const mountOf = (depth: number): Mount => {
  const root = posix.join('/', ...Array.from({ length: depth }, () => '_'));
  const local = (path: string): string => posix.relative(root, path);
  return {
    root,
    absolute: (path) => posix.resolve(root, path),
    local,
    aimed: (base, target) => local(posix.resolve(base, target.replaceAll('\\', '/'))),
  };
};

const NOT_FOUND = 6053;
const COMPILED = /\.[cm]?js$/;

const writtenOf = (literal: string): string | undefined => {
  let value: unknown;
  try {
    value = JSON.parse(literal);
  } catch {
    return undefined;
  }
  return typeof value === 'string' ? value : undefined;
};

const staleOf = (tree: Tree, output: string, source: string, copy: string): UnsupportedSource | undefined => {
  const generated = tree.working?.(output);
  if (generated === undefined) return undefined;
  const made = ts.parseConfigFileTextToJson(output, generated);
  if (made.error !== undefined)
    return new UnsupportedSource(
      output,
      `the config this checkout's build generated does not parse, so \`${source}\`, which stands for it, cannot be checked against it: generate it again`,
    );
  const held = ts.parseConfigFileTextToJson(source, copy);
  return held.error === undefined && JSON.stringify(held.config) === JSON.stringify(made.config)
    ? undefined
    : new CopyStale(
        source,
        output,
        `it stands for \`${output}\`, and the \`${output}\` this checkout's build generated says otherwise: generate it again and copy it over \`${source}\``,
      );
};

export const staleAmong = (tree: Tree, built: Built, outputs: Iterable<string>): UnsupportedSource | undefined => {
  for (const output of outputs) {
    const source = built.get(output);
    if (source === undefined || tree.has(output) || !tree.has(source)) continue;
    const stale = staleOf(tree, output, source, tree.read(source));
    if (stale !== undefined) return stale;
  }
  return undefined;
};

export function configResolver(
  tree: Tree,
  memberDir: (name: string) => string | undefined,
  built: Built,
): (specifier: string, from: string, measuring: Tree, inputs: Set<string>) => Resolution | null {
  const { environment } = tree;
  const { root, absolute, local, aimed } = mountOf(environment?.depth ?? 0);
  const installedAt = (path: string): Installed | undefined =>
    environment === undefined || !environmental(tree, path) ? undefined : environment.read(path);
  const canonical = (path: string, inputs: Set<string>): string => {
    const marker = '/node_modules/';
    const at = path.lastIndexOf(marker);
    if (at === -1) return path;
    const parts = path.slice(at + marker.length).split('/');
    const size = parts[0]?.startsWith('@') ? 2 : 1;
    const dir = memberDir(parts.slice(0, size).join('/'));
    if (dir === undefined) return path;
    inputs.add(posix.join(dir, 'package.json'));
    return absolute(posix.join(dir, ...parts.slice(size)));
  };
  const standing = (path: string, observed: Set<string>): string | undefined => {
    observed.add(path);
    if (tree.has(path)) return path;
    const source = built.get(path);
    if (source === undefined) return installedAt(path) === undefined ? undefined : path;
    if (!namesConfig(source))
      throw new UnsupportedSource(
        source,
        `it stands for the config \`${path}\`, and only a file named \`.json\` is watched as a config, so an edit to it would judge nothing`,
      );
    observed.add(source);
    return tree.has(source) ? source : undefined;
  };
  const uninstalled = (config: string, named: string): UnsupportedSource =>
    new UnsupportedSource(
      config,
      `its extends chain names \`${named}\`, which no package installed in the judging checkout provides: install the checkout's dependencies`,
    );
  const absentOf = (config: string, missing: string): UnsupportedSource => {
    const source = built.get(missing);
    const submodule = source === undefined ? submoduleOf(tree, missing) : undefined;
    if (submodule !== undefined && environment !== undefined)
      return new UnsupportedSource(
        config,
        `its extends chain reaches \`${missing}\`, which the submodule \`${submodule}\` of the judging checkout does not hold: check out the checkout's submodules (\`git submodule update --init\`)`,
      );
    if (source === undefined && environment !== undefined && installedPlace(missing)) return uninstalled(config, missing);
    return source === undefined
      ? new InputAbsent(config, missing, `its extends chain reaches \`${missing}\`, which the tree lacks`)
      : new InputAbsent(
          config,
          source,
          `its extends chain reaches \`${missing}\`, which the tree lacks, and \`${source}\`, declared to stand for it, is absent too`,
        );
  };
  const unfound = (config: string, diagnostic: ts.Diagnostic): UnsupportedSource | undefined => {
    const { code, file, start, length } = diagnostic;
    if (code !== NOT_FOUND || file === undefined || start === undefined || length === undefined) return undefined;
    const extended = writtenOf(file.text.slice(start, start + length))?.replaceAll('\\', '/');
    if (extended === undefined) return undefined;
    if (!extended.startsWith('./') && !extended.startsWith('../') && !extended.startsWith('/'))
      return environment === undefined
        ? new UnsupportedSource(
            config,
            `its extends chain names the package config \`${extended}\`, which resolves to no file the tree holds`,
          )
        : uninstalled(config, extended);
    const path = aimed(posix.dirname(file.fileName), extended);
    return absentOf(config, namesConfig(path) ? path : `${path}.json`);
  };
  const nearest = new Map<string, { readonly path: string | undefined; readonly inputs: readonly string[] }>();
  const configs = new Map<string, { readonly options: ts.CompilerOptions; readonly inputs: readonly string[] }>();
  const configOf = (from: string, inputs: Set<string>): ts.CompilerOptions | undefined => {
    const dir = posix.dirname(from);
    let near = nearest.get(dir);
    if (near === undefined) {
      const probes = new Set<string>();
      const path = ts.findConfigFile(absolute(dir), (path) => {
        const at = local(path);
        return !at.startsWith('../') && standing(at, probes) !== undefined;
      });
      near = { path, inputs: [...probes] };
      nearest.set(dir, near);
    }
    for (const path of near.inputs) inputs.add(path);
    const path = near.path;
    if (path === undefined) return undefined;
    const held = configs.get(path);
    if (held !== undefined) {
      for (const path of held.inputs) inputs.add(path);
      return held.options;
    }
    const observed = new Set<string>();
    const missed: string[] = [];
    let refused: unknown;
    const fail = (diagnostic: ts.Diagnostic): never => {
      if (refused !== undefined) throw refused;
      throw new UnsupportedSource(local(diagnostic.file?.fileName ?? path), ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
    };
    const guarded = <A>(otherwise: A, answer: () => A): A => {
      try {
        return answer();
      } catch (error) {
        refused ??= error;
        return otherwise;
      }
    };
    const read = (wanted: string): string | undefined => {
      const at = standing(wanted, observed);
      if (at === undefined) {
        missed.push(wanted);
        return undefined;
      }
      if (at === wanted && !tree.has(at)) return installedAt(at)?.text;
      const text = tree.read(at);
      const stale = at === wanted ? undefined : staleOf(tree, wanted, at, text);
      if (stale !== undefined) throw stale;
      return text;
    };
    const real = (file: string): string => {
      const named = canonical(file, observed);
      const at = local(named);
      if (tree.has(at) || built.has(at)) return named;
      const found = installedAt(at);
      if (found === undefined) return named;
      observed.add(found.at);
      return absolute(found.at);
    };
    try {
      const parsed = ts.getParsedCommandLineOfConfigFile(
        path,
        {},
        {
          useCaseSensitiveFileNames: true,
          getCurrentDirectory: () => root,
          fileExists: (file) => guarded(false, () => standing(local(canonical(file, observed)), observed) !== undefined),
          readFile: (file) => guarded(undefined, () => read(local(canonical(file, observed)))),
          realpath: (file) => guarded(file, () => real(file)),
          readDirectory: () => [],
          onUnRecoverableConfigFileDiagnostic: fail,
        },
      );
      if (refused !== undefined) throw refused;
      const [missing] = missed;
      if (missing !== undefined) throw absentOf(local(path), missing);
      if (parsed === undefined) throw new UnsupportedSource(local(path), 'the TypeScript config could not be read');
      const error = parsed.errors.find((diagnostic) => diagnostic.code !== 18003 && diagnostic.code !== 18002);
      const absent = error === undefined ? undefined : unfound(local(path), error);
      if (absent !== undefined) throw absent;
      if (error !== undefined) fail(error);
      const malformed = Object.entries(parsed.options.paths ?? {}).find(
        ([, targets]) => !Array.isArray(targets) || !targets.every((target) => typeof target === 'string'),
      );
      if (malformed !== undefined)
        throw new UnsupportedSource(local(path), `its \`paths\` entry \`${malformed[0]}\` is not a list of paths`);
      configs.set(path, { options: parsed.options, inputs: [...observed] });
      return parsed.options;
    } finally {
      for (const path of observed) inputs.add(path);
    }
  };
  return (specifier, from, measuring, inputs) => {
    const options = configOf(from, inputs);
    const aims = options === undefined ? [] : aimsOf(specifier, options, root, aimed).map((aim) => local(canonical(absolute(aim), inputs)));
    const [first] = aims;
    if (options === undefined || first === undefined) return null;
    const host = {
      fileExists: (file: string) => !file.split('/').includes('node_modules') && measuring.has(local(file)),
      readFile: (file: string) => {
        if (file.split('/').includes('node_modules')) return undefined;
        const path = local(file);
        return measuring.has(path) ? measuring.read(path) : undefined;
      },
    };
    const settings = {
      ...options,
      moduleResolution: ts.ModuleResolutionKind.Node10,
      resolvePackageJsonExports: false,
      resolvePackageJsonImports: false,
      typeRoots: [],
    };
    for (const aim of aims) {
      if (!COMPILED.test(specifier) && measuring.has(aim)) return { to: aim };
      const answer = ts.resolveModuleName(absolute(aim), absolute(from), settings, host).resolvedModule;
      if (answer !== undefined) return { to: local(answer.resolvedFileName) };
    }
    const exact = aims.find((aim) => measuring.has(aim));
    return exact === undefined ? { unlisted: aims.find((aim) => environmental(tree, aim)) ?? first } : { to: exact };
  };
}

const aimsOf = (specifier: string, options: ts.CompilerOptions, root: string, aimed: Mount['aimed']): readonly string[] => {
  const { paths, baseUrl, pathsBasePath } = options;
  const matched = paths === undefined ? undefined : patternOf(Object.keys(paths), specifier);
  if (paths === undefined || matched === undefined) return baseUrl === undefined ? [] : [aimed(baseUrl, specifier)];
  const base = baseUrl ?? (typeof pathsBasePath === 'string' ? pathsBasePath : root);
  return (paths[matched.key] ?? []).map((target) => aimed(base, matched.star === undefined ? target : target.replace('*', matched.star)));
};

const patternOf = (keys: readonly string[], specifier: string): { readonly key: string; readonly star?: string } | undefined => {
  if (keys.includes(specifier) && !specifier.includes('*')) return { key: specifier };
  let best: { readonly key: string; readonly star: string; readonly prefix: number } | undefined;
  for (const key of keys) {
    const star = key.indexOf('*');
    if (star === -1 || key.includes('*', star + 1)) continue;
    const prefix = key.slice(0, star);
    const suffix = key.slice(star + 1);
    if (specifier.length < prefix.length + suffix.length || !specifier.startsWith(prefix) || !specifier.endsWith(suffix)) continue;
    if (best === undefined || prefix.length > best.prefix)
      best = { key, star: specifier.slice(prefix.length, specifier.length - suffix.length), prefix: prefix.length };
  }
  return best;
};
