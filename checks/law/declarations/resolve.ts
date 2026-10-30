import { posix } from 'node:path';
import { LANGUAGES } from '@runlith/code-facts/languages';
import { leavesOf, type Package, type Packages } from './corpus';
import { globRegex } from './glob';

export type Alias = { readonly prefix: string; readonly dir: string };

export type Resolver = {
  readonly resolve: (specifier: string, from: string) => readonly string[];
  readonly pattern: (pattern: string, from: string) => readonly string[];
  readonly inside: (pkg: Package, relative: string) => readonly string[];
  readonly exported: (pkg: Package) => readonly string[];
};

const FIRST = ['.ts', '.tsx'];

const EXTENSIONS = [...FIRST, ...LANGUAGES[0].extensions.filter((one) => !FIRST.includes(one))];

const COMPILED = /\.[cm]?js$/;

const joined = (dir: string, relative: string): string => posix.normalize(dir === '' ? relative : `${dir}/${relative}`);

export type Paths = { readonly has: (path: string) => boolean } & Iterable<string>;

export const ANY: Paths = { has: () => true, [Symbol.iterator]: () => [][Symbol.iterator]() };

const GLOBBED = /[*{?]/;

const absoluteOf = (value: string, from: string): string =>
  value.startsWith('.') ? joined(posix.dirname(from) === '.' ? '' : posix.dirname(from), value) : value.replace(/^\//, '');

const staticDir = (absolute: string): string | undefined => {
  if (!GLOBBED.test(absolute)) return undefined;
  const kept: string[] = [];
  for (const part of absolute.split('/')) {
    if (GLOBBED.test(part)) break;
    kept.push(part);
  }
  return kept.join('/');
};

export const patternDir = (value: string, from: string): string | undefined =>
  value.startsWith('!') ? undefined : staticDir(absoluteOf(value, from));

export const resolverOf = (paths: Paths, packages: Packages, aliases: readonly Alias[]): Resolver => {
  const probe = (base: string): string | undefined => {
    if (paths.has(base)) return base;
    if (COMPILED.test(base)) {
      const stem = base.replace(COMPILED, '');
      for (const extension of ['.ts', '.tsx', '.mts', '.cts']) if (paths.has(`${stem}${extension}`)) return `${stem}${extension}`;
    }
    for (const extension of EXTENSIONS) if (paths.has(`${base}${extension}`)) return `${base}${extension}`;
    for (const extension of EXTENSIONS) if (paths.has(`${base}/index${extension}`)) return `${base}/index${extension}`;
    return undefined;
  };
  const inside = (pkg: Package, relative: string): readonly string[] => {
    const found = probe(joined(pkg.dir, relative));
    return found === undefined ? [] : [found];
  };
  const targets = (pkg: Package, key: string): readonly string[] => {
    const exported = pkg.exports;
    if (exported === undefined || exported === null) return key === '.' ? pkg.entries.flatMap((one) => inside(pkg, one)) : inside(pkg, key);
    const table =
      typeof exported === 'object' && !Array.isArray(exported) && Object.keys(exported).some((one) => one.startsWith('.'))
        ? (exported as Readonly<Record<string, unknown>>)
        : { '.': exported };
    const leaves = (value: unknown, star: string): string[] => {
      if (typeof value === 'string') return [value.replace('*', star)];
      if (Array.isArray(value)) return value.flatMap((one) => leaves(one, star));
      if (value !== null && typeof value === 'object') return Object.values(value).flatMap((one) => leaves(one, star));
      return [];
    };
    if (key in table) return [...new Set(leaves(table[key], '').flatMap((one) => inside(pkg, one)))];
    let best: { readonly key: string; readonly star: string } | undefined;
    for (const candidate of Object.keys(table)) {
      const at = candidate.indexOf('*');
      if (at < 0) continue;
      const head = candidate.slice(0, at);
      const tail = candidate.slice(at + 1);
      if (
        key.startsWith(head) &&
        key.endsWith(tail) &&
        key.length >= head.length + tail.length &&
        (best === undefined || head.length > best.key.indexOf('*'))
      )
        best = { key: candidate, star: key.slice(head.length, key.length - tail.length) };
    }
    return best === undefined ? [] : [...new Set(leaves(table[best.key], best.star).flatMap((one) => inside(pkg, one)))];
  };
  const bare = (specifier: string): readonly string[] => {
    const parts = specifier.split('/');
    const name = specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!;
    const pkg = packages.named(name);
    if (pkg === undefined) return [];
    const rest = specifier.slice(name.length);
    return targets(pkg, rest === '' ? '.' : `.${rest}`);
  };
  const resolve = (specifier: string, from: string): readonly string[] => {
    if (specifier.startsWith('.')) {
      const found = probe(joined(posix.dirname(from) === '.' ? '' : posix.dirname(from), specifier));
      return found === undefined ? [] : [found];
    }
    for (const alias of aliases)
      if (specifier.startsWith(alias.prefix)) {
        const found = probe(joined(alias.dir, specifier.slice(alias.prefix.length)));
        return found === undefined ? [] : [found];
      }
    return bare(specifier);
  };
  const pattern = (value: string, from: string): readonly string[] => {
    if (value.startsWith('!')) return [];
    const absolute = absoluteOf(value, from);
    if (!GLOBBED.test(absolute)) return resolve(value, from);
    const regex = globRegex(absolute);
    return [...paths].filter((path) => regex.test(path));
  };
  const exported = (pkg: Package): readonly string[] => {
    const table = pkg.exports;
    if (table === undefined || table === null) return targets(pkg, '.');
    const found: string[] = [];
    const walk = (value: unknown): void => {
      if (typeof value === 'string') {
        if (!value.includes('*')) found.push(...inside(pkg, value));
        else {
          const regex = globRegex(joined(pkg.dir, value));
          for (const path of paths) if (regex.test(path)) found.push(path);
        }
      } else if (Array.isArray(value)) value.forEach(walk);
      else if (value !== null && typeof value === 'object') Object.values(value).forEach(walk);
    };
    walk(table);
    return [...new Set(found)];
  };
  return { resolve, pattern, inside, exported };
};

const lastSegment = (value: string): string => value.slice(value.lastIndexOf('/') + 1);

type Keyed = {
  readonly exact: ReadonlyMap<string, readonly string[]>;
  readonly patterns: readonly { readonly regex: RegExp; readonly stem: string }[];
  readonly whole: string | undefined;
};

const keyed = new WeakMap<Package, Keyed>();

const keyedOf = (pkg: Package): Keyed => {
  const held = keyed.get(pkg);
  if (held !== undefined) return held;
  const table = pkg.exports;
  const exact = new Map<string, string[]>();
  const patterns: { regex: RegExp; stem: string }[] = [];
  let whole: string | undefined;
  if (
    table === undefined ||
    table === null ||
    typeof table !== 'object' ||
    Array.isArray(table) ||
    !Object.keys(table).some((one) => one.startsWith('.'))
  )
    whole = lastSegment(pkg.name);
  else
    for (const [key, value] of Object.entries(table))
      for (const leaf of leavesOf(value)) {
        const stem = key === '.' ? lastSegment(pkg.name) : lastSegment(key);
        const target = joined(pkg.dir, leaf);
        if (target.includes('*')) patterns.push({ regex: globRegex(target), stem });
        else exact.set(target, [...(exact.get(target) ?? []), stem]);
      }
  const made = { exact, patterns, whole };
  keyed.set(pkg, made);
  return made;
};

export const keyStems = (packages: Packages, path: string): readonly string[] => {
  const stems = new Set<string>();
  for (const pkg of packages.around(path)) {
    const held = keyedOf(pkg);
    if (held.whole !== undefined) stems.add(held.whole);
    for (const stem of held.exact.get(path) ?? []) stems.add(stem);
    for (const one of held.patterns) if (one.regex.test(path)) stems.add(one.stem);
  }
  return [...stems];
};
