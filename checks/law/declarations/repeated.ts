import type { Finding } from '@runlith/tagma/rules';
import type { Corpus } from './corpus';
import type { RepeatedParams } from './declaration';
import type { Shape, ShapeKind } from './facts';

type Site = { readonly path: string; readonly shape: Shape };

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
      const key = keyOf(shape);
      const held = groups.get(key);
      if (held === undefined) groups.set(key, [{ path, shape }]);
      else held.push({ path, shape });
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
