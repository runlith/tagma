import type { LanguageId } from '@runlith/code-facts/languages';
import { Schema } from 'effect';
import type { Languages } from './languages';
import { bare, entry } from './params';

export type Reach = 'local' | 'global';

export const moduleId = Schema.String.check(Schema.isPattern(/^(?:@[a-z0-9][a-z0-9._-]*\/)?[A-Za-z0-9][A-Za-z0-9._-]*$/u)).annotate({
  description: 'A module name: letters, digits, `.`, `_` and `-`, or a package name with its `@scope/`.',
});

const door = Schema.Struct({
  at: entry,
  for: Schema.optional(
    Schema.NonEmptyArray(moduleId).annotate({
      description: 'The only modules this entry is open to; absent, every module with a relation to its owner.',
    }),
  ),
  role: Schema.optional(
    Schema.Literals(['port', 'testing']).annotate({
      description:
        'Absent, the entry is open to the modules `for` names, or to every module with a relation to its owner. `port`: its types are open to every module with a relation, its values only to `for`. `testing`: only test code imports it — any module’s, relation or not, narrowed by `for` — and every file under it is test code itself.',
    }),
  ),
});

const mapModule = Schema.Struct({
  id: moduleId,
  territory: Schema.NonEmptyArray(entry).annotate({
    description:
      'The directories and files this module owns. A path belongs to the module whose territory entry covering it is the longest.',
  }),
  entries: Schema.optional(
    Schema.Array(door).annotate({
      description:
        'What another module may import of this one; the longest entry covering a path decides who may import it. Absent, the whole territory is open.',
    }),
  ),
  order: Schema.optional(
    Schema.Array(Schema.NonEmptyArray(entry)).annotate({
      description:
        'The floors inside the module, bottom first. A file stands on the floor of the longest entry covering it, and imports only from a lower floor or its own entry; a file no entry covers is free.',
    }),
  ),
});

const relation = Schema.Struct({
  from: moduleId,
  to: moduleId,
  role: Schema.optional(
    Schema.Literals(['testing']).annotate({
      description: 'Absent, every file of `from` may import `to` along it. `testing`: only the test code of `from` may.',
    }),
  ),
});

export const moduleMapSchema = Schema.Struct({
  modules: Schema.Array(mapModule),
  relations: Schema.Array(relation).annotate({ description: 'Which module may import which: `from` imports `to`.' }),
  region: Schema.Array(entry).annotate({
    description:
      'The directories and files every module card draws, a parent’s included: a selected file here is judged and must be owned.',
  }),
}).annotate({
  description: 'The module map, every path from the repository root: assembled from the project’s module cards, never stored with a rule.',
});

export type ModuleMap = typeof moduleMapSchema.Type;

export type MapModule = ModuleMap['modules'][number];

export const localEntry = (base: string, path: string): string | undefined => {
  if (base === '') return path;
  const held = bare(path);
  if (held === base || base.startsWith(`${held}/`)) return path.endsWith('/') ? '' : undefined;
  return path.startsWith(`${base}/`) ? path.slice(base.length + 1) : undefined;
};

export const territoryUnder = (map: ModuleMap, id: string, base: string): readonly string[] | undefined =>
  map.modules.find((one) => one.id === id)?.territory.flatMap((path) => localEntry(base, path) ?? []);

export const CONCERNS = ['imports', 'loading', 'code', 'size'] as const;
export type Concern = (typeof CONCERNS)[number];

const named = Schema.String;

export const thresholdsFigure = Schema.Struct({
  kind: Schema.Literal('thresholds'),
  thresholds: Schema.Array(Schema.Struct({ glob: named, metric: named, lines: Schema.Finite, why: Schema.optional(named) })),
});

export const modulesFigure = Schema.Struct({
  kind: Schema.Literal('modules'),
  modules: Schema.Array(
    Schema.Struct({
      id: named,
      territory: Schema.Array(named),
      entries: Schema.NullOr(
        Schema.Array(Schema.Struct({ at: named, for: Schema.optional(Schema.Array(named)), role: Schema.optional(named) })),
      ),
    }),
  ),
  relations: Schema.Array(Schema.Struct({ from: named, to: named, role: Schema.optional(named) })),
});

export const listsFigure = Schema.Struct({
  kind: Schema.Literal('lists'),
  lists: Schema.Array(Schema.Struct({ label: named, items: Schema.Array(named) })),
});

export const countsFigure = Schema.Struct({
  kind: Schema.Literal('counts'),
  label: named,
  counts: Schema.Array(Schema.Struct({ name: named, count: Schema.Int })),
});

export const figureSchema = Schema.Union([thresholdsFigure, modulesFigure, listsFigure, countsFigure]);
export type Figure = typeof figureSchema.Type;

export type Showing = { readonly concern: Concern; readonly figures: readonly Figure[] };

export type Shown = { readonly concern?: Concern; readonly figures: readonly Figure[] };

export type Envelope = { readonly files: number; readonly mib: number };

export type Based = { readonly base: string };

export type Applied<P extends Based = Based> = { readonly builtin: string; readonly params: P };

export type List = {
  readonly at: string;
  readonly item: Schema.Codec<unknown, unknown>;
  readonly key: Schema.Codec<unknown, unknown>;
  readonly identity: readonly string[];
  readonly path?: string;
};

export const recordList = <F extends Record<string, Schema.Codec<unknown, unknown>>, K extends keyof F & string>(
  at: string,
  item: Schema.Struct<F>,
  identity: readonly K[],
  path?: K,
): List => ({
  at,
  item,
  key: Schema.Struct(Object.fromEntries(identity.map((key) => [key, item.fields[key]!]))),
  identity,
  path,
});

export type Rule<P = never, R = P> = {
  readonly id: string;
  readonly params: Schema.Top;
  readonly summary: string;
  readonly concern: Concern;
  readonly lists?: readonly List[];
  readonly describe: (params: P) => string;
  readonly shows: (params: R) => Shown;
  readonly map?: (params: P, map: ModuleMap) => string | undefined;
  readonly languages: Languages;
  readonly reach: Reach;
  readonly fileLocal?: true;
  readonly hides?: 'file' | 'nothing';
  readonly unit: string;
  readonly limitations: readonly string[];
  readonly unblock: readonly string[];
  readonly envelope?: Envelope;
  readonly calibrated?: true;
  readonly sliced?: true;
  readonly movedBy?: 'file' | 'fingerprint';
  readonly relevant?: (params: R, path: string) => boolean;
  readonly follows?: (params: R, fingerprint: string) => boolean;
  readonly modulesRenamed?: (fingerprint: string, renamed: ReadonlyMap<string, string>) => string | undefined;
};

export type Usage = { readonly languages?: readonly LanguageId[]; readonly packages?: readonly string[] };

export type Pack = { readonly id: string; readonly uses: Usage; readonly requires?: readonly string[]; readonly rules: readonly Rule[] };

export type ProjectFacts = { readonly languages: ReadonlySet<LanguageId>; readonly packages: ReadonlySet<string> };

export const usedBy = (pack: Pack, facts: ProjectFacts): boolean => {
  const { languages = [], packages = [] } = pack.uses;
  if (languages.length === 0 && packages.length === 0) return true;
  return languages.some((one) => facts.languages.has(one)) || packages.some((one) => facts.packages.has(one));
};

const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

type Location = { readonly next: Map<string, Location>; path?: string };

export const locationsOf = (
  inspection: Applied,
  paths: readonly string[],
  fingerprints: readonly string[],
): ReadonlyMap<string, ReadonlySet<string>> => {
  const prefix = inspection.params.base === '' ? '' : `${inspection.params.base}/`;
  const root: Location = { next: new Map() };
  for (const path of paths) {
    if (!path.startsWith(prefix)) continue;
    const local = path.slice(prefix.length);
    if (local === '') continue;
    let node = root;
    for (let at = 0; at < local.length; at += 1) {
      const char = local[at]!;
      let next = node.next.get(char);
      if (next === undefined) node.next.set(char, (next = { next: new Map() }));
      node = next;
    }
    node.path = path;
  }
  const found = new Map<string, Set<string>>();
  const space = /\s/;
  const ending = /[\s#]/;
  for (const fingerprint of fingerprints) {
    for (let start = 0; start < fingerprint.length; start += 1) {
      if (start > 0 && !space.test(fingerprint[start - 1]!)) continue;
      let node: Location | undefined = root;
      for (let at = start; at < fingerprint.length; at += 1) {
        node = node.next.get(fingerprint[at]!);
        if (node === undefined) break;
        if (node.path !== undefined && (at + 1 === fingerprint.length || ending.test(fingerprint[at + 1]!))) {
          let held = found.get(node.path);
          if (held === undefined) found.set(node.path, (held = new Set()));
          held.add(fingerprint);
        }
      }
    }
  }
  return found;
};

export const relocated = (inspection: Applied, fingerprint: string, from: string, to: string): string | undefined => {
  const prefix = inspection.params.base === '' ? '' : `${inspection.params.base}/`;
  if (!from.startsWith(prefix) || !to.startsWith(prefix)) return undefined;
  const token = new RegExp(`(^|\\s)${escaped(from.slice(prefix.length))}(?=$|\\s|#)`, 'g');
  const moved = fingerprint.replace(token, `$1${to.slice(prefix.length)}`);
  return moved === fingerprint ? undefined : moved;
};
