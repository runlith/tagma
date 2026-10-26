import { matchesGlob, posix } from 'node:path';
import type { Context, InputDelta, Manifest, Resolution, Resolver, ResolverInput, Traced } from '../../adapter';
import { UnsupportedSource } from '../../imports';
import type { Runtime } from '../../runtime';
import { runtimeNamed } from '../../runtimes/index';
import type { Tree } from '../../tree';
import { type Built, configResolver, namesConfig, staleAmong } from './config';
import { resolveRelative } from './resolve';

export type Member = { readonly dir: string; readonly manifest: Readonly<Record<string, unknown>> };

export type Members = { readonly manifest: string; readonly packages: ReadonlyMap<string, Member> };

type Target = string | null | undefined;

const NO_BUILT: Built = new Map();

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const packageName = (specifier: string): string => {
  const parts = specifier.split('/');
  return (specifier.startsWith('@') ? parts.slice(0, 2) : parts.slice(0, 1)).join('/');
};

const manifestPath = (dir: string): string => (dir === '' ? 'package.json' : `${dir}/package.json`);

const manifestOf = (path: string, text: string): Readonly<Record<string, unknown>> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new UnsupportedSource(path, 'the manifest is not JSON');
  }
  if (!isRecord(parsed)) throw new UnsupportedSource(path, 'the manifest is not a JSON object');
  return parsed;
};

const patternsOf = (path: string, workspaces: unknown): readonly string[] | undefined => {
  const declared = isRecord(workspaces) ? workspaces.packages : workspaces;
  if (declared === undefined) return undefined;
  if (!Array.isArray(declared) || !declared.every((pattern) => typeof pattern === 'string')) {
    throw new UnsupportedSource(path, 'its workspaces are not a list of patterns');
  }
  return declared;
};

const validImport = (target: string): boolean =>
  target.startsWith('./')
    ? !target
        .slice(2)
        .split('/')
        .some((part) => part === '.' || part === '..' || part === 'node_modules')
    : target !== '' && !target.startsWith('.') && !target.startsWith('/');

const conditioned = (value: unknown, fill: string | undefined, conditions: ReadonlySet<string>, imports = false): Target => {
  if (value === null) return null;
  if (typeof value === 'string') return fill === undefined ? value : value.replaceAll('*', fill);
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = conditioned(item, fill, conditions, imports);
      if (found === undefined || (typeof found === 'string' && !(imports ? validImport(found) : found.startsWith('./')))) continue;
      return found;
    }
    return null;
  }
  if (!isRecord(value)) return undefined;
  for (const [condition, held] of Object.entries(value)) {
    if (condition !== 'default' && !conditions.has(condition)) continue;
    const found = conditioned(held, fill, conditions, imports);
    if (found !== undefined) return found;
  }
  return undefined;
};

export const exportMap = (exports: unknown): Readonly<Record<string, unknown>> =>
  isRecord(exports) && Object.keys(exports).some((key) => key.startsWith('.')) ? exports : { '.': exports };

export type ExportSelection = { readonly key: string; readonly value: unknown; readonly fill?: string };

export const exportOf = (exports: unknown, subpath: string): ExportSelection | undefined => selectMap(exportMap(exports), subpath);

const selectMap = (map: Readonly<Record<string, unknown>>, subpath: string): ExportSelection | undefined => {
  if (Object.hasOwn(map, subpath) && !subpath.includes('*')) return { key: subpath, value: map[subpath] };
  let best: { readonly key: string; readonly fill: string } | undefined;
  for (const key of Object.keys(map)) {
    const star = key.indexOf('*');
    if (star === -1 || key.indexOf('*', star + 1) !== -1) continue;
    const prefix = key.slice(0, star);
    const suffix = key.slice(star + 1);
    if (!subpath.startsWith(prefix) || subpath === prefix || !subpath.endsWith(suffix) || subpath.length < key.length) continue;
    const wins =
      best === undefined ||
      star + 1 > best.key.indexOf('*') + 1 ||
      (star + 1 === best.key.indexOf('*') + 1 && key.length > best.key.length);
    if (wins) best = { key, fill: subpath.slice(prefix.length, subpath.length - suffix.length) };
  }
  return best === undefined ? undefined : { ...best, value: map[best.key] };
};

export const exported = (exports: unknown, subpath: string, conditions: ReadonlySet<string>): Target => {
  const selected = exportOf(exports, subpath);
  return selected === undefined ? undefined : conditioned(selected.value, selected.fill, conditions);
};

const doorOf = (tree: Tree, member: Member, subpath: string, conditions: ReadonlySet<string>): Resolution => {
  const { exports, main } = member.manifest;
  if (exports === undefined) {
    const written = subpath === '.' ? (typeof main === 'string' ? main : 'index.js') : subpath;
    const relative = written.startsWith('.') ? written : `./${written}`;
    const to = resolveRelative(relative, manifestPath(member.dir), tree);
    return to === null ? { unlisted: posix.join(member.dir, relative) } : { to };
  }
  const target = exported(exports, subpath, conditions);
  if (typeof target !== 'string') return { unlisted: member.dir };
  const to = posix.join(member.dir, target);
  if (!target.startsWith('./') || !(to === member.dir || to.startsWith(member.dir === '' ? '' : `${member.dir}/`))) {
    return { unlisted: member.dir };
  }
  return tree.has(to) ? { to } : { unlisted: to };
};

const ancestorsOf = (from: string): readonly string[] => {
  const dirs: string[] = [];
  for (let dir = from.replace(/\/+$/, ''); ; dir = posix.dirname(dir) === '.' ? '' : posix.dirname(dir)) {
    dirs.push(dir);
    if (dir === '') return dirs;
  }
};

export const inputs = (from: string): readonly string[] =>
  ancestorsOf(from).flatMap((dir) => [manifestPath(dir), posix.join(dir, 'tsconfig.json')]);

export const input = (path: string, tree: Tree): ResolverInput | undefined => {
  const base = posix.basename(path);
  if (base === 'package.json') {
    const dir = posix.dirname(path) === '.' ? '' : posix.dirname(path);
    const manifest = tree.has(path) ? manifestOf(path, tree.read(path)) : {};
    const dependencies = [
      ...new Set(
        ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'].flatMap((key) =>
          isRecord(manifest[key]) ? Object.keys(manifest[key]) : [],
        ),
      ),
    ].sort();
    const scope = { name: manifest.name, main: manifest.main, imports: manifest.imports, workspaces: manifest.workspaces, dependencies };
    const stamp = JSON.stringify({ ...scope, exports: manifest.exports });
    const bindings =
      manifest.exports === undefined
        ? undefined
        : {
            scope: JSON.stringify(scope),
            entries: Object.fromEntries(Object.entries(exportMap(manifest.exports)).map(([key, value]) => [key, JSON.stringify(value)])),
          };
    return { kind: 'manifest', dir, name: typeof manifest.name === 'string' ? manifest.name : undefined, stamp, bindings };
  }
  return namesConfig(base) ? { kind: 'config' } : undefined;
};

const bindingKey = (dir: string, entry: string): string => `b:${dir}\0${entry}`;

export const inputDelta = (before: ResolverInput, after: ResolverInput): InputDelta | undefined => {
  if (before.kind !== 'manifest' || after.kind !== 'manifest' || before.dir !== after.dir) return undefined;
  const was = before.bindings;
  const now = after.bindings;
  if (was === undefined || now === undefined || was.scope !== now.scope) return undefined;
  const narrowed = new Set<string>();
  const refreshed = new Set<string>();
  const families = Object.fromEntries(Object.entries(was.entries).filter(([key]) => key.includes('*')));
  const overlaps = (left: string, right: string): boolean => {
    const a = left.split('*');
    const b = right.split('*');
    return (
      a.length === 2 &&
      b.length === 2 &&
      (a[0]!.startsWith(b[0]!) || b[0]!.startsWith(a[0]!)) &&
      (a[1]!.endsWith(b[1]!) || b[1]!.endsWith(a[1]!))
    );
  };
  for (const key of new Set([...Object.keys(was.entries), ...Object.keys(now.entries)])) {
    if (was.entries[key] === now.entries[key]) continue;
    const watch = bindingKey(before.dir, key);
    refreshed.add(watch);
    if (Object.hasOwn(was.entries, key)) narrowed.add(watch);
    else {
      refreshed.add(bindingKey(before.dir, '\0'));
      const shadowed = key.includes('*')
        ? Object.keys(families).filter((entry) => overlaps(key, entry))
        : [selectMap(families, key)?.key].filter((entry): entry is string => entry !== undefined);
      for (const entry of shadowed) {
        const prior = bindingKey(before.dir, entry);
        narrowed.add(prior);
        refreshed.add(prior);
      }
    }
  }
  return { narrowed: [...narrowed], refreshed: [...refreshed] };
};

export function workspaceMembers(tree: Tree, from: string): Members | null {
  const root = findRoot(tree, from);
  if (root === undefined) return null;
  const found = listMemberDirs(tree, root.dir, root.patterns);
  const declared = found.map((dir) => tree.read(manifestPath(dir)));
  const members = new Map<string, Member>();
  for (const [at, dir] of found.entries()) {
    const manifest = manifestOf(manifestPath(dir), declared[at] ?? '');
    if (typeof manifest.name === 'string' && !members.has(manifest.name)) members.set(manifest.name, { dir, manifest });
  }
  return { manifest: manifestPath(root.dir), packages: members };
}

export type MemberSet = {
  readonly manifest: string | null;
  readonly patterns: readonly string[];
  readonly members: readonly (readonly [dir: string, name: string | null, object: string])[];
};

export function membersOf(tree: Tree, from: string): MemberSet {
  const root = findRoot(tree, from);
  if (root === undefined) return { manifest: null, patterns: [], members: [] };
  const found = listMemberDirs(tree, root.dir, root.patterns);
  const texts = found.map((dir) => tree.read(manifestPath(dir)));
  const members: (readonly [string, string | null, string])[] = [];
  for (const [at, dir] of found.entries()) {
    const manifest = manifestOf(manifestPath(dir), texts[at] ?? '');
    members.push([dir, typeof manifest.name === 'string' ? manifest.name : null, relevantOf(manifest)]);
  }
  return { manifest: manifestPath(root.dir), patterns: root.patterns, members };
}

export function membersDelta(
  held: MemberSet,
  tree: Tree,
  from: string,
  manifests: readonly string[],
): { readonly set: MemberSet; readonly names: readonly string[] } {
  const root = findRoot(tree, from);
  if (
    root === undefined ||
    held.manifest === null ||
    manifestPath(root.dir) !== held.manifest ||
    !samePatterns(root.patterns, held.patterns)
  ) {
    const set = membersOf(tree, from);
    return { set, names: memberNamesChanged(held, set) };
  }
  const globs = (negated: boolean) =>
    root.patterns
      .filter((pattern) => pattern.startsWith('!') === negated)
      .map((pattern) => posix.join(root.dir, pattern.replace(/^!/, '')));
  const named = globs(false);
  const unnamed = globs(true);
  const matches = (dir: string): boolean => named.some((glob) => matchesGlob(dir, glob)) && !unnamed.some((glob) => matchesGlob(dir, glob));
  const byDir = new Map(held.members.map(([dir, name, object]) => [dir, { name, object }] as const));
  const names: string[] = [];
  const changed = (name: string | null): void => {
    if (name !== null && !names.includes(name)) names.push(name);
  };
  for (const manifest of manifests) {
    const dir = manifest === 'package.json' ? '' : manifest.endsWith('/package.json') ? manifest.slice(0, -'/package.json'.length) : null;
    if (dir === null) continue;
    const prev = byDir.get(dir);
    if (!tree.has(manifest)) {
      if (prev === undefined) continue;
      const before = prev.name === null ? undefined : primaryOf(byDir, prev.name);
      byDir.delete(dir);
      if (prev.name !== null && !samePrimary(before, primaryOf(byDir, prev.name))) changed(prev.name);
      continue;
    }
    if (prev === undefined && !matches(dir)) continue;
    const parsed = manifestOf(manifest, tree.read(manifest));
    const name = typeof parsed.name === 'string' ? parsed.name : null;
    const object = relevantOf(parsed);
    if (prev !== undefined && prev.object === object) continue;
    const oldName = prev?.name ?? null;
    const beforeOld = oldName === null ? undefined : primaryOf(byDir, oldName);
    const beforeNew = name === null || name === oldName ? undefined : primaryOf(byDir, name);
    byDir.set(dir, { name, object });
    if (oldName !== null && !samePrimary(beforeOld, primaryOf(byDir, oldName))) changed(oldName);
    if (name !== null && name !== oldName && !samePrimary(beforeNew, primaryOf(byDir, name))) changed(name);
  }
  const members = [...byDir].map(([dir, { name, object }]): readonly [string, string | null, string] => [dir, name, object]);
  members.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  return { set: { manifest: held.manifest, patterns: held.patterns, members }, names };
}

export function workspaceFrom(
  set: MemberSet,
  tree: Tree,
  conditions: readonly string[],
  from = posix.dirname(set.manifest ?? 'package.json'),
  built: Built = NO_BUILT,
  runtimes: readonly Runtime[] = [],
): Resolver {
  const dirs = new Map<string, string>();
  for (const [dir, name] of set.members) if (name !== null && !dirs.has(name)) dirs.set(name, dir);
  const read = new Map<string, Member>();
  const memberAt = (dir: string): Member => {
    const held = read.get(dir);
    if (held !== undefined) return held;
    const path = manifestPath(dir);
    const member = { dir, manifest: tree.has(path) ? manifestOf(path, tree.read(path)) : {} };
    read.set(dir, member);
    return member;
  };
  const active = new Set(conditions);
  let packages: readonly Manifest[] | undefined;
  return doorsOf(
    tree,
    set.manifest ?? manifestPath(from),
    from,
    conditions,
    (name) => {
      const dir = dirs.get(name);
      return dir === undefined ? undefined : memberAt(dir);
    },
    () => {
      packages ??= set.members.flatMap(([dir, name]) => (name === null ? [] : [packageOf(name, memberAt(dir), active)]));
      return packages;
    },
    built,
    runtimes,
  );
}

const RUNTIME = ['dependencies', 'peerDependencies', 'optionalDependencies'] as const;

const listedIn = (manifest: Readonly<Record<string, unknown>>, fields: readonly string[], name: string): boolean =>
  fields.some((field) => {
    const held = manifest[field];
    return isRecord(held) && Object.hasOwn(held, name);
  });

const exportsOf = (member: Member, conditions: ReadonlySet<string>): ((path: string) => boolean) => {
  const inside = member.dir === '' ? '' : `${member.dir}/`;
  const { exports } = member.manifest;
  if (exports === undefined) return (path) => path.startsWith(inside);
  const map = exportMap(exports);
  const keys = Object.keys(map);
  const fillOf = (template: string, local: string): string | undefined => {
    const parts = template.split('*');
    const stars = parts.length - 1;
    if (stars === 0) return template === local ? '\0' : undefined;
    const size = (local.length - (template.length - stars)) / stars;
    if (!Number.isInteger(size) || size < 1) return undefined;
    const fill = local.slice((parts[0] as string).length, (parts[0] as string).length + size);
    return template.replaceAll('*', fill) === local ? fill : undefined;
  };
  const subpathOf = (key: string, local: string): string | undefined => {
    const star = key.indexOf('*');
    if (star === -1) return key;
    const template = conditioned(map[key], '*', conditions);
    const fill = typeof template === 'string' ? fillOf(template, local) : undefined;
    return fill === undefined ? undefined : `${key.slice(0, star)}${fill}${key.slice(star + 1)}`;
  };
  return (path) => {
    if (!path.startsWith(inside)) return false;
    const local = `./${path.slice(inside.length)}`;
    return keys.some((key) => {
      const subpath = subpathOf(key, local);
      const target = subpath === undefined ? undefined : exported(exports, subpath, conditions);
      return typeof target === 'string' && target.startsWith('./') && posix.join(member.dir, target) === path;
    });
  };
};

const packageOf = (name: string, member: Member, conditions: ReadonlySet<string>): Manifest => ({
  name,
  dir: member.dir,
  dependency: (other) =>
    listedIn(member.manifest, RUNTIME, other)
      ? 'runtime'
      : listedIn(member.manifest, ['devDependencies'], other)
        ? 'development'
        : undefined,
  entry: exportsOf(member, conditions),
});

export function workspaceOf(
  tree: Tree,
  from: string,
  conditions: readonly string[],
  built: Built = NO_BUILT,
  runtimes: readonly Runtime[] = [],
): Resolver {
  return workspaceFrom(membersOf(tree, from), tree, conditions, from, built, runtimes);
}

export const runtimesOf = (context: Context): readonly Runtime[] => {
  const { runtimes } = context;
  if (runtimes === undefined) return [];
  const found = Array.isArray(runtimes) ? runtimes.map((id: unknown) => (typeof id === 'string' ? runtimeNamed(id) : undefined)) : [];
  if (!Array.isArray(runtimes) || found.some((one) => one === undefined))
    throw new UnsupportedSource('', 'the JavaScript resolution context names `runtimes` that are not a list of runtime adapter ids');
  return found as readonly Runtime[];
};

export const conditionsOf = (context: Context): readonly string[] => {
  const { conditions } = context;
  if (conditions === undefined) return [];
  if (!Array.isArray(conditions) || !conditions.every((one) => typeof one === 'string')) {
    throw new UnsupportedSource('', 'the JavaScript resolution context names `conditions` that are not a list of strings');
  }
  return conditions;
};

export const builtOf = (context: Context): Built => {
  const { built } = context;
  if (built === undefined) return NO_BUILT;
  const refused = new UnsupportedSource(
    '',
    'the JavaScript resolution context names `built` entries that are not an output and a source path each, every output once',
  );
  if (!Array.isArray(built)) throw refused;
  const found = new Map<string, string>();
  for (const one of built as readonly unknown[]) {
    if (!isRecord(one) || typeof one.output !== 'string' || typeof one.source !== 'string' || found.has(one.output)) throw refused;
    found.set(one.output, one.source);
  }
  return found;
};

export const resolverOf = (tree: Tree, from: string, context: Context): Resolver =>
  workspaceOf(tree, from, conditionsOf(context), builtOf(context), runtimesOf(context));

const attempt = (read: () => string): string | { readonly failed: unknown } => {
  try {
    return read();
  } catch (failed) {
    return { failed };
  }
};

const findRoot = (tree: Tree, from: string): { readonly dir: string; readonly patterns: readonly string[] } | undefined => {
  const held = ancestorsOf(from).flatMap((dir) =>
    tree.has(manifestPath(dir)) ? [{ dir, text: attempt(() => tree.read(manifestPath(dir))) }] : [],
  );
  for (const { dir, text } of held) {
    if (typeof text !== 'string') throw text.failed;
    const patterns = patternsOf(manifestPath(dir), manifestOf(manifestPath(dir), text).workspaces);
    if (patterns !== undefined) return { dir, patterns };
  }
  return undefined;
};

const listMemberDirs = (tree: Tree, dir: string, patterns: readonly string[]): readonly string[] => {
  const globs = (negated: boolean) =>
    patterns.filter((pattern) => pattern.startsWith('!') === negated).map((pattern) => posix.join(dir, pattern.replace(/^!/, '')));
  const named = globs(false);
  const unnamed = globs(true);
  const listed =
    tree.paths === undefined && tree.matching === undefined
      ? undefined
      : tree.matching === undefined
        ? tree.paths?.()
        : tree.matching(named);
  if (listed === undefined)
    throw new UnsupportedSource(manifestPath(dir), 'the tree lists no paths, so its workspace members cannot be found');
  const found: string[] = [];
  for (const path of listed) {
    if (!path.endsWith('/package.json')) continue;
    const member = posix.dirname(path);
    if (named.some((glob) => matchesGlob(member, glob)) && !unnamed.some((glob) => matchesGlob(member, glob))) found.push(member);
  }
  found.sort();
  return found;
};

const relevantOf = (manifest: Readonly<Record<string, unknown>>): string =>
  JSON.stringify({ name: manifest.name ?? null, exports: manifest.exports ?? null, main: manifest.main ?? null });

const samePatterns = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((pattern, at) => pattern === right[at]);

const primaryOf = (
  byDir: ReadonlyMap<string, { readonly name: string | null; readonly object: string }>,
  name: string,
): { readonly dir: string; readonly object: string } | undefined => {
  let found: { readonly dir: string; readonly object: string } | undefined;
  for (const [dir, entry] of byDir) {
    if (entry.name !== name) continue;
    if (found === undefined || dir < found.dir) found = { dir, object: entry.object };
  }
  return found;
};

const samePrimary = (
  before: { readonly dir: string; readonly object: string } | undefined,
  after: { readonly dir: string; readonly object: string } | undefined,
): boolean => (before === undefined || after === undefined ? before === after : before.dir === after.dir && before.object === after.object);

const memberNamesChanged = (before: MemberSet, after: MemberSet): readonly string[] => {
  const names: string[] = [];
  const changed = (name: string): void => {
    if (!names.includes(name)) names.push(name);
  };
  const was = new Map<string, { readonly dir: string; readonly object: string }>();
  for (const [dir, name, object] of before.members) if (name !== null && !was.has(name)) was.set(name, { dir, object });
  const is = new Map<string, { readonly dir: string; readonly object: string }>();
  for (const [dir, name, object] of after.members) if (name !== null && !is.has(name)) is.set(name, { dir, object });
  for (const [name, entry] of was) {
    const found = is.get(name);
    if (found === undefined || found.dir !== entry.dir || found.object !== entry.object) changed(name);
  }
  for (const [name, entry] of is) {
    const held = was.get(name);
    if (held === undefined || held.dir !== entry.dir || held.object !== entry.object) changed(name);
  }
  return names;
};

const traceDoor = (
  tree: Tree,
  run: (tree: Tree) => Resolution | null,
): { readonly resolution: Resolution | null; readonly absent: readonly string[] } => {
  const seen: string[] = [];
  const hits = new Map<string, boolean>();
  const measuring: Tree = {
    ...tree,
    has: (path) => {
      const hit = tree.has(path);
      if (!hits.has(path)) {
        seen.push(path);
        hits.set(path, hit);
      }
      return hit;
    },
  };
  const resolution = run(measuring);
  if (resolution !== null && 'to' in resolution) {
    const at = seen.indexOf(resolution.to);
    return { resolution, absent: at === -1 ? seen.filter((path) => !hits.get(path)) : seen.slice(0, at) };
  }
  return { resolution, absent: seen };
};

const doorsOf = (
  tree: Tree,
  manifest: string,
  from: string,
  conditions: readonly string[],
  memberOf: (name: string) => Member | undefined,
  packages: () => readonly Manifest[],
  built: Built,
  runtimes: readonly Runtime[],
): Resolver => {
  const active = new Set(conditions);
  const configured = configResolver(tree, (name) => memberOf(name)?.dir, built);
  const scopes = new Map<string, Member>();
  const scopeOf = (file: string): Member => {
    const directory = posix.dirname(file);
    const held = scopes.get(directory);
    if (held !== undefined) return held;
    for (const dir of ancestorsOf(directory)) {
      const cached = scopes.get(dir);
      if (cached !== undefined) {
        scopes.set(directory, cached);
        return cached;
      }
      const path = manifestPath(dir);
      if (!tree.has(path)) continue;
      const member = { dir, manifest: manifestOf(path, tree.read(path)) };
      scopes.set(directory, member);
      return member;
    }
    const member = { dir: directory, manifest: {} };
    scopes.set(directory, member);
    return member;
  };
  const resolve = (
    specifier: string,
    file: string,
    measuring: Tree,
    seen: ReadonlySet<string>,
    consulted: string[],
    inputs: Set<string>,
    watches: Set<string>,
  ): Resolution | null => {
    if (seen.has(specifier)) return { unlisted: scopeOf(file).dir };
    if (!specifier.startsWith('#') && !consulted.includes(packageName(specifier))) consulted.push(packageName(specifier));
    if (specifier.startsWith('#')) {
      const scope = scopeOf(file);
      inputs.add(manifestPath(scope.dir));
      const imports = scope.manifest.imports;
      const selection = isRecord(imports) ? selectMap(imports, specifier) : undefined;
      const target = selection === undefined ? undefined : conditioned(selection.value, selection.fill, active, true);
      if (typeof target !== 'string' || !validImport(target)) return { unlisted: scope.dir };
      if (target.startsWith('./')) {
        const path = posix.join(scope.dir, target);
        const to = resolveRelative(target, manifestPath(scope.dir), measuring);
        return to === null ? { unlisted: path } : { to };
      }
      return resolve(target, file, measuring, new Set([...seen, specifier]), consulted, inputs, watches);
    }
    if (runtimes.some((runtime) => runtime.builtin(specifier) !== undefined)) return null;
    const alias = configured(specifier, file, measuring, inputs);
    if (alias !== null && 'to' in alias) return alias;
    const name = packageName(specifier);
    const member = memberOf(name);
    const enter = (member: Member): Resolution => {
      const subpath = specifier === name ? '.' : `.${specifier.slice(name.length)}`;
      inputs.add(manifestPath(member.dir));
      if (member.manifest.exports !== undefined) {
        const entry = exportOf(member.manifest.exports, subpath)?.key;
        watches.add(bindingKey(member.dir, entry ?? subpath));
        if (entry === undefined) watches.add(bindingKey(member.dir, '\0'));
      }
      return doorOf(measuring, member, subpath, active);
    };
    if (member !== undefined) return enter(member);
    const scope = scopeOf(file);
    inputs.add(manifestPath(scope.dir));
    if (scope.manifest.name === name && scope.manifest.exports !== undefined) return enter(scope);
    if (listedIn(scope.manifest, [...RUNTIME, 'devDependencies'], name)) return null;
    return alias ?? { unlisted: posix.join(posix.dirname(file), specifier) };
  };
  const doors = new Map<string, Traced>();
  const traced = (specifier: string, file = posix.join(from, '__importer__.ts')): Traced => {
    const key = `${posix.dirname(file)}\0${specifier}`;
    const held = doors.get(key);
    if (held !== undefined) return held;
    const packages: string[] = [];
    const inputs = new Set<string>([manifest]);
    const watches = new Set<string>();
    const { resolution, absent } = traceDoor(tree, (measuring) =>
      resolve(specifier, file, measuring, new Set(), packages, inputs, watches),
    );
    const found = { resolution, absent, packages, inputs: [...inputs], watches: [...watches] };
    doors.set(key, found);
    return found;
  };
  return {
    manifest,
    resolve: (specifier, file) => traced(specifier, file).resolution,
    traced,
    over: (over, specifier, file = posix.join(from, '__importer__.ts')) =>
      resolve(specifier, file, over, new Set(), [], new Set(), new Set()),
    manifests: packages,
    stale: (inputs) => staleAmong(tree, built, inputs),
  };
};
