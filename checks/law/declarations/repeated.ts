import { createHash } from 'node:crypto';
import type { Finding } from '@runlith/tagma/rules';
import type { Corpus } from './corpus';
import type { Boundaries } from '../architecture/boundaries';
import type { RepeatedParams } from './declaration';
import type { Shape, ShapeKind } from './facts';
import { ANY, type Resolver, resolverOf } from './resolve';

type Site = { readonly path: string; readonly shape: Shape; readonly group: string };

const REFERENCE = /\u0001([^\u0002]*)\u0002/g;

const normal = (path: string): string => path.replace(/\.[cm]?[jt]sx?$|\.svelte$/, '').replace(/\/index$/, '');

const DECLARATION = /\.d\.[cm]?ts$/;

const specifierAt = (specifier: string, path: string, resolver: Resolver): string => {
  const targets = resolver.resolve(specifier, path);
  const target = targets.find((one) => !DECLARATION.test(one)) ?? targets[0];
  return target === undefined ? specifier : normal(target);
};

const identityOf = (token: string, path: string, resolver: Resolver): string => {
  if (token.startsWith('l:')) return `${path}#${token.slice(2)}`;
  const [specifier, tail] = token.slice(2).split('\u0003');
  return `${specifierAt(specifier!, path, resolver)}#${tail}`;
};

const groupOf = (shape: Shape, path: string, resolver: Resolver): string => {
  const coarse = `${shape.kind}:${shape.key}`;
  if (shape.text === undefined) return `${coarse}:`;
  const fine = shape.text.replace(REFERENCE, (_, token: string) => `<${identityOf(token, path, resolver)}>`);
  return `${coarse}:${createHash('sha1').update(fine).digest('hex').slice(0, 12)}`;
};

const MINIMUM = {
  object: (params: RepeatedParams) => params.minMembers,
  union: (params: RepeatedParams) => params.minUnion,
  literals: (params: RepeatedParams) => params.minLiterals,
  alias: () => 1,
} as const satisfies Record<ShapeKind, (params: RepeatedParams) => number>;

const WHAT: Readonly<Record<ShapeKind, string>> = {
  object: 'object type',
  union: 'union type',
  literals: 'literal union type',
  alias: 'imported type alias',
};

const FIX: Readonly<Record<ShapeKind, string>> = {
  object: 'Declare the type once in the lowest module that uses it and import it in the other files.',
  union: 'Declare the union once in the lowest module that uses it and import it in the other files.',
  literals: 'Import the declared type instead of repeating its alternatives.',
  alias: 'Import and use the declaring owner’s type directly, without a renaming declaration.',
};

const placed = (site: Site): string => `${site.path}:${site.shape.line}`;

export const keyOf = (shape: Shape): string => `${shape.kind}:${shape.key}`;

export const judges = (shape: Shape, params: RepeatedParams): boolean =>
  shape.declaration === true && (params.scope === 'all' || shape.exported) && !params.ignoreNames.includes(shape.name);

export const inRegion = (path: string, params: RepeatedParams): boolean =>
  params.region.some((one) => path === one || path.startsWith(one));

export const findRepeated = (corpus: Corpus, params: RepeatedParams, boundaries: Boundaries): readonly Finding[] => {
  const groups = new Map<string, Site[]>();
  const findings: Finding[] = [];
  const resolver = resolverOf(ANY, corpus.packages, params.aliases);
  for (const [path, file] of corpus.facts) {
    if (!inRegion(path, params)) continue;
    for (const shape of file.shapes) {
      if (!judges(shape, params)) continue;
      if (shape.kind === 'alias') {
        findings.push({
          fingerprint: `repeated alias:${shape.name} ${path}`,
          path,
          line: shape.line,
          message: `type ${shape.name} only renames imported type ${shape.label}`,
          fix: FIX.alias,
        });
        continue;
      }
      const group = groupOf(shape, path, resolver);
      const held = groups.get(group);
      if (held === undefined) groups.set(group, [{ path, shape, group }]);
      else held.push({ path, shape, group });
    }
  }
  for (const [key, sites] of groups) {
    const files = [...new Set(sites.map((one) => one.path))].sort();
    if (sites.length < 2) continue;
    const kind = sites[0]!.shape.kind;
    for (const path of files) {
      const here = sites.filter((one) => one.path === path).sort((left, right) => left.shape.line - right.shape.line);
      const owner = boundaries.owner(path);
      const qualifies = (local: Site, other: Site): boolean => {
        const target = boundaries.owner(other.path);
        if (local === other || owner === undefined || target === undefined) return false;
        if (owner === target) return kind === 'object' && local.shape.size >= 3;
        if (local.shape.name === other.shape.name) return true;
        return local.shape.size >= MINIMUM[kind](params) && other.shape.exported && boundaries.imports(owner, target);
      };
      const matched = here.filter((local) => sites.some((other) => qualifies(local, other)));
      if (matched.length === 0) continue;
      const first = matched[0]!;
      const elsewhere = sites
        .filter((one) => one !== first && matched.some((local) => qualifies(local, one)))
        .sort((left, right) => (placed(left) < placed(right) ? -1 : 1));
      const others = elsewhere.slice(0, 3).map((one) => `${placed(one)}${one.shape.name === '' ? '' : ` (\`${one.shape.name}\`)`}`);
      const more = elsewhere.length > 3 ? ` and ${elsewhere.length - 3} more` : '';
      findings.push({
        fingerprint: `repeated ${key} ${path}`,
        path,
        line: first.shape.line,
        message: `${elsewhere.some((one) => boundaries.owner(one.path) === owner) ? 'same-module ' : ''}${WHAT[kind]} ${first.shape.name === '' ? '' : `\`${first.shape.name}\` `}{${first.shape.label}} is also declared in ${others.join(', ')}${more}`,
        fix: FIX[kind],
        ...(matched.length > 1 ? { sites: matched.map((one) => ({ line: one.shape.line })) } : {}),
      });
    }
  }
  return findings.sort((left, right) =>
    left.path === right.path ? (left.line ?? 0) - (right.line ?? 0) : left.path < right.path ? -1 : 1,
  );
};
