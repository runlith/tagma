import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import type { Finding } from '@runlith/tagma/rules';
import type { Corpus } from './corpus';
import type { RepeatedParams } from './declaration';
import type { Shape, ShapeKind } from './facts';
import type { Alias } from './resolve';

type Site = { readonly path: string; readonly shape: Shape; readonly group: string };

const REFERENCE = /\u0001([^\u0002]*)\u0002/g;

const normal = (path: string): string => path.replace(/\.[cm]?[jt]sx?$|\.svelte$/, '').replace(/\/index$/, '');

const specifierAt = (specifier: string, path: string, aliases: readonly Alias[]): string => {
  if (specifier.startsWith('.')) return normal(posix.normalize(posix.join(posix.dirname(path), specifier)));
  const alias = aliases.find((one) => specifier.startsWith(one.prefix));
  return alias === undefined ? specifier : normal(posix.normalize(posix.join(alias.dir, specifier.slice(alias.prefix.length))));
};

const identityOf = (token: string, path: string, aliases: readonly Alias[]): string => {
  if (token.startsWith('l:')) return `${path}#${token.slice(2)}`;
  const [specifier, tail] = token.slice(2).split('\u0003');
  return `${specifierAt(specifier!, path, aliases)}#${tail}`;
};

const groupOf = (shape: Shape, path: string, aliases: readonly Alias[]): string => {
  const coarse = `${shape.kind}:${shape.key}`;
  if (shape.text === undefined) return `${coarse}:`;
  const fine = shape.text.replace(REFERENCE, (_, token: string) => `<${identityOf(token, path, aliases)}>`);
  return `${coarse}:${createHash('sha1').update(fine).digest('hex').slice(0, 12)}`;
};

const MINIMUM = {
  object: (params: RepeatedParams) => params.minMembers,
  union: (params: RepeatedParams) => params.minUnion,
  literals: (params: RepeatedParams) => params.minLiterals,
} as const satisfies Record<ShapeKind, (params: RepeatedParams) => number>;

const WHAT: Readonly<Record<ShapeKind, string>> = {
  object: 'object type',
  union: 'union type',
  literals: 'set of string literals',
};

const FIX: Readonly<Record<ShapeKind, string>> = {
  object: 'Declare the type once in the lowest module that uses it and import it in the other files.',
  union: 'Declare the union once in the lowest module that uses it and import it in the other files.',
  literals: 'Keep one declaration of the set and derive the other forms from it (`typeof SET[number]`, `Schema.Literals(SET)`).',
};

const placed = (site: Site): string => `${site.path}:${site.shape.line}`;

export const keyOf = (shape: Shape): string => `${shape.kind}:${shape.key}`;

export const judges = (shape: Shape, params: RepeatedParams): boolean =>
  shape.size >= MINIMUM[shape.kind](params) && (params.scope === 'all' || shape.exported) && !params.ignoreNames.includes(shape.name);

export const inRegion = (path: string, params: RepeatedParams): boolean =>
  params.region.some((one) => path === one || path.startsWith(one));

export const findRepeated = (corpus: Corpus, params: RepeatedParams): readonly Finding[] => {
  const groups = new Map<string, Site[]>();
  for (const [path, file] of corpus.facts) {
    if (!inRegion(path, params)) continue;
    for (const shape of file.shapes) {
      if (!judges(shape, params)) continue;
      const group = groupOf(shape, path, params.aliases);
      const held = groups.get(group);
      if (held === undefined) groups.set(group, [{ path, shape, group }]);
      else held.push({ path, shape, group });
    }
  }
  const findings: Finding[] = [];
  for (const [key, sites] of groups) {
    const files = [...new Set(sites.map((one) => one.path))].sort();
    if (files.length < 2) continue;
    const kind = sites[0]!.shape.kind;
    for (const path of files) {
      const here = sites.filter((one) => one.path === path).sort((left, right) => left.shape.line - right.shape.line);
      const elsewhere = sites.filter((one) => one.path !== path).sort((left, right) => (placed(left) < placed(right) ? -1 : 1));
      const first = here[0]!;
      const others = elsewhere.slice(0, 3).map((one) => `${placed(one)}${one.shape.name === '' ? '' : ` (\`${one.shape.name}\`)`}`);
      const more = elsewhere.length > 3 ? ` and ${elsewhere.length - 3} more` : '';
      findings.push({
        fingerprint: `repeated ${key} ${path}`,
        path,
        line: first.shape.line,
        message: `${WHAT[kind]} ${first.shape.name === '' ? '' : `\`${first.shape.name}\` `}{${first.shape.label}} is also declared in ${others.join(', ')}${more}`,
        fix: FIX[kind],
        ...(here.length > 1 ? { sites: here.map((one) => ({ line: one.shape.line })) } : {}),
      });
    }
  }
  return findings.sort((left, right) =>
    left.path === right.path ? (left.line ?? 0) - (right.line ?? 0) : left.path < right.path ? -1 : 1,
  );
};
