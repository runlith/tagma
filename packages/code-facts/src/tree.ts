import {
  type Adapter,
  adapterOf,
  type Adapters,
  type Context,
  type Facet,
  parseFacet,
  parseImports,
  type Resolution,
  type Resolver,
  type ResolverInput,
  type InputDelta,
} from './adapter';
import { COUNTS, type ImportEdge, type ImportReads, type ImportSite, type ParsedImport } from './imports';

export type TreeDiffEntry = {
  readonly path: string;
  readonly before: string | null;
  readonly after: string | null;
  readonly status: string;
};

export type TreeChange = {
  readonly slot: string;
  readonly baseTree: string;
  readonly builtTree: string;
  readonly baseEntries: readonly TreeDiffEntry[];
  readonly headTree?: string | null;
  readonly headEntries?: readonly TreeDiffEntry[];
};

export type Installed = { readonly text: string; readonly at: string };

export type Environment = { readonly depth: number; readonly read: (path: string) => Installed | undefined };

export type Tree = {
  readonly has: (path: string) => boolean;
  readonly read: (path: string) => string;
  readonly object?: (path: string) => string | undefined;
  readonly snapshot?: string;
  readonly slot?: string;
  readonly change?: TreeChange;
  readonly sites?: (path: string) => readonly ImportSite[];
  readonly imports?: (path: string, reads: ImportReads) => readonly ParsedImport[];
  readonly facet?: <T>(path: string, facet: Facet<T>) => T;
  readonly paths?: (prefix?: string) => Iterable<string>;
  readonly matching?: (globs: readonly string[]) => Iterable<string>;
  readonly size?: (path: string) => number | undefined;
  readonly mentions?: (words: readonly string[]) => ReadonlySet<string> | undefined;
  readonly working?: (path: string) => string | undefined;
  readonly environment?: Environment;
  readonly realpath?: (path: string) => string;
};

export type Unresolved = ParsedImport & { readonly file: string; readonly unlisted: string; readonly absent: readonly string[] };

export type Dynamic = ParsedImport & { readonly file: string };

export type Probed = {
  readonly edges: readonly ImportEdge[];
  readonly unresolved: readonly Unresolved[];
  readonly dynamic: readonly Dynamic[];
  readonly absent: readonly string[];
  readonly packages: readonly string[];
  readonly inputs: readonly string[];
  readonly watches?: readonly string[];
};

export type ImportEdges = {
  readonly edges: readonly ImportEdge[];
  readonly unresolved: readonly Unresolved[];
  readonly dynamic: readonly Dynamic[];
};

export type Packages = { readonly from: string; readonly context: Context };

export type DependencyKind = 'value' | 'type' | 'dynamic' | 'side-effect';

export type Target =
  | { readonly path: string }
  | { readonly external: string }
  | { readonly unlisted: string }
  | { readonly unjudged: string };

export type Dependency = {
  readonly specifier: string;
  readonly line: number;
  readonly kind: DependencyKind;
  readonly forwards: boolean;
  readonly target: Target;
};

export function* pathsUnder(sorted: readonly string[], prefix = ''): Iterable<string> {
  if (prefix === '') {
    yield* sorted;
    return;
  }
  const lower = (target: string): number => {
    let start = 0;
    let end = sorted.length;
    while (start < end) {
      const middle = (start + end) >>> 1;
      if ((sorted[middle] as string) < target) start = middle + 1;
      else end = middle;
    }
    return start;
  };
  const exact = lower(prefix);
  if (sorted[exact] === prefix) yield prefix;
  const directory = `${prefix}/`;
  for (let at = lower(directory); (sorted[at] ?? '').startsWith(directory); at++) yield sorted[at] as string;
}

export const importsOf = (tree: Tree, path: string, reads: ImportReads, adapters: Adapters): readonly ParsedImport[] =>
  tree.imports?.(path, reads) ?? parseImports(adapters, tree.read(path), path, reads);

export const sitesOf = (tree: Tree, path: string, adapters: Adapters): readonly ImportSite[] =>
  tree.sites?.(path) ?? adapterOf(adapters, path).imports(tree.read(path), path);

export const facetOf = <T>(tree: Tree, path: string, facet: Facet<T>, adapters: Adapters): T =>
  tree.facet !== undefined ? tree.facet(path, facet) : parseFacet(adapters, facet, tree.read(path), path);

const kindOf = (site: ImportSite): DependencyKind =>
  site.loads === 'never'
    ? 'type'
    : site.loads === 'lazily' || site.kind === 'worker'
      ? 'dynamic'
      : site.clause || site.form === 'require'
        ? 'value'
        : 'side-effect';

export function dependenciesOf(tree: Tree, file: string, adapters: Adapters, resolver: () => Resolver | null): readonly Dependency[] {
  const adapter = adapterOf(adapters, file);
  return sitesOf(tree, file, adapters).map((site): Dependency => {
    const { specifier, line, forwards } = site;
    const kind = kindOf(site);
    if (site.kind === 'unresolved' || site.kind === 'glob') {
      return {
        specifier,
        line,
        kind,
        forwards,
        target: { unjudged: site.kind === 'glob' ? 'a glob of paths' : 'a specifier that is not a literal' },
      };
    }
    const resolution = adapter.resolve(specifier, file, tree) ?? resolver()?.resolve(specifier, file) ?? null;
    const target: Target =
      resolution === null ? { external: specifier } : 'to' in resolution ? { path: resolution.to } : { unlisted: resolution.unlisted };
    return { specifier, line, kind, forwards, target };
  });
}

const landingOn =
  (tree: Tree, resolve: (over: Tree) => Resolution | null) =>
  (path: string): boolean => {
    const found = resolve({
      ...tree,
      has: (probe) => probe === path || tree.has(probe),
      read: (probe) => (probe === path ? '' : tree.read(probe)),
    });
    return found !== null && 'to' in found && found.to === path;
  };

export const queryOf = (queries: readonly string[], specifier: string): string | undefined =>
  queries.find((one) => specifier.length > one.length && specifier.endsWith(one));

export function fileEdges(
  tree: Tree,
  file: string,
  reads: ImportReads,
  adapters: Adapters,
  resolver: Resolver | null | (() => Resolver | null),
  queries: readonly string[] = [],
): Probed {
  const adapter = adapterOf(adapters, file);
  const edges: ImportEdge[] = [];
  const unresolved: Unresolved[] = [];
  const dynamic: Dynamic[] = [];
  const absent: string[] = [];
  const packages: string[] = [];
  const inputs = new Set<string>();
  const watches = new Set<string>();
  const seenAbsent = new Set<string>();
  const seenPackages = new Set<string>();
  const noteAbsent = (paths: readonly string[]): void => {
    for (const path of paths)
      if (!seenAbsent.has(path)) {
        seenAbsent.add(path);
        absent.push(path);
      }
  };
  let held: Resolver | null | undefined;
  const resolverOf = (): Resolver | null => {
    if (held === undefined) held = typeof resolver === 'function' ? resolver() : resolver;
    return held;
  };
  const counted = COUNTS[reads];
  for (const site of sitesOf(tree, file, adapters)) {
    if (!counted(site)) continue;
    const { specifier, line } = site;
    if (site.kind === 'unresolved') dynamic.push({ file, line, specifier });
    if (site.kind !== undefined) continue;
    const query = queryOf(queries, specifier);
    const aimed = query === undefined ? specifier : specifier.slice(0, -query.length);
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
    const relative = adapter.resolve(aimed, file, measuring);
    if (relative !== null) {
      if ('to' in relative) {
        edges.push({ file, line, specifier, to: relative.to });
        const at = seen.indexOf(relative.to);
        noteAbsent(at === -1 ? seen.filter((path) => !hits.get(path)) : seen.slice(0, at));
      } else {
        const lands = landingOn(tree, (over) => adapter.resolve(aimed, file, over));
        unresolved.push({
          file,
          line,
          specifier,
          unlisted: relative.unlisted,
          absent: seen.filter((path) => !hits.get(path) && lands(path)),
        });
        noteAbsent(seen);
      }
      continue;
    }
    const doors = resolverOf();
    const reported = doors?.traced(aimed, file);
    if (reported !== undefined) {
      for (const name of reported.packages)
        if (!seenPackages.has(name)) {
          seenPackages.add(name);
          packages.push(name);
        }
      noteAbsent(reported.absent);
      for (const path of reported.inputs) inputs.add(path);
      for (const key of reported.watches ?? []) watches.add(key);
    }
    const resolution = reported?.resolution ?? null;
    if (resolution === null || doors === null || reported === undefined) continue;
    if ('to' in resolution) {
      edges.push({ file, line, specifier, to: resolution.to });
      continue;
    }
    const lands = landingOn(tree, (over) => doors.over(over, aimed, file));
    unresolved.push({
      file,
      line,
      specifier,
      unlisted: resolution.unlisted,
      absent: reported.absent.filter((path) => !tree.has(path) && lands(path)),
    });
  }
  return { edges, unresolved, dynamic, absent, packages, inputs: [...inputs], watches: [...watches] };
}

export function importEdges(tree: Tree, files: Iterable<string>, reads: ImportReads, adapters: Adapters, packages?: Packages): ImportEdges {
  const edges: ImportEdge[] = [];
  const unresolved: Unresolved[] = [];
  const dynamic: Dynamic[] = [];
  const resolvers = new Map<Adapter, Resolver | null>();
  const resolverOf =
    (adapter: Adapter): (() => Resolver | null) =>
    () => {
      if (packages === undefined || adapter.resolver === undefined) return null;
      if (!resolvers.has(adapter)) resolvers.set(adapter, adapter.resolver(tree, packages.from, packages.context));
      return resolvers.get(adapter) ?? null;
    };
  for (const file of files) {
    const probed = fileEdges(tree, file, reads, adapters, resolverOf(adapterOf(adapters, file)));
    edges.push(...probed.edges);
    unresolved.push(...probed.unresolved);
    dynamic.push(...probed.dynamic);
  }
  return { edges, unresolved, dynamic };
}

export type ImpactIndex = {
  readonly importers: (path: string) => readonly string[];
  readonly users: (name: string) => readonly string[];
  readonly under: (dir: string) => readonly string[];
  readonly watchers?: (key: string) => Iterable<string>;
};

export type ReverseIndex = ImpactIndex & {
  readonly reaching: (dir: string) => readonly string[];
};

export type Impact =
  | { readonly whole: false; readonly files: readonly string[]; readonly manifests: readonly string[] }
  | { readonly whole: true; readonly because: string };

export type ImpactChange = {
  readonly base: Tree;
  readonly built: Tree;
  readonly paths: readonly string[];
  readonly beforeInputs?: Readonly<Record<string, ResolverInput | null>>;
  readonly mode?: 'narrowed' | 'refreshed';
};

const NONE: readonly string[] = [];

const keyed = (map: Map<string, Set<string>>, key: string, file: string): void => {
  const held = map.get(key);
  if (held === undefined) map.set(key, new Set([file]));
  else held.add(file);
};

const sortedUnder = <T>(rows: readonly (readonly [string, T])[], dir: string): T[] => {
  const at = dir === '' ? '' : `${dir}/`;
  let low = 0;
  for (let high = rows.length; low < high;) {
    const middle = (low + high) >> 1;
    if ((rows[middle] as readonly [string, T])[0] < at) low = middle + 1;
    else high = middle;
  }
  const found: T[] = [];
  for (let next = low; next < rows.length && (rows[next] as readonly [string, T])[0].startsWith(at); next++)
    found.push((rows[next] as readonly [string, T])[1]);
  return found;
};

export function reverseIndex(probes: ReadonlyMap<string, Probed>): ReverseIndex {
  const byPath = new Map<string, Set<string>>();
  const byName = new Map<string, Set<string>>();
  const targets: (readonly [string, string])[] = [];
  for (const [file, { edges, absent, packages, inputs }] of probes) {
    for (const { to } of edges) {
      keyed(byPath, to, file);
      targets.push([to, file]);
    }
    for (const path of [...absent, ...inputs]) keyed(byPath, path, file);
    for (const name of packages) keyed(byName, name, file);
  }
  targets.sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0));
  const files = [...probes.keys()].sort().map((file) => [file, file] as const);
  return {
    importers: (path) => [...(byPath.get(path) ?? NONE)],
    users: (name) => [...(byName.get(name) ?? NONE)],
    reaching: (dir) => [...new Set(sortedUnder(targets, dir))],
    under: (dir) => sortedUnder(files, dir),
  };
}

const inputOf = (adapters: Adapters, path: string, tree: Tree): ResolverInput | undefined => {
  for (const adapter of adapters) {
    const found = adapter.input?.(path, tree);
    if (found !== undefined) return found;
  }
  return undefined;
};

export const inputDeltaOf = (adapters: Adapters, before: ResolverInput, after: ResolverInput): InputDelta | undefined => {
  for (const adapter of adapters) {
    const delta = adapter.inputDelta?.(before, after);
    if (delta !== undefined) return delta;
  }
  return undefined;
};

export function impactOf(change: ImpactChange, adapters: Adapters, index: () => ImpactIndex): Impact {
  const { base, built } = change;
  const files = new Set<string>();
  const manifests: string[] = [];
  let held: ImpactIndex | undefined;
  const indexed = (): ImpactIndex => {
    held ??= index();
    return held;
  };
  for (const path of change.paths) {
    if (!base.has(path) && !built.has(path)) continue;
    const before = change.beforeInputs === undefined ? inputOf(adapters, path, base) : (change.beforeInputs[path] ?? undefined);
    const after = inputOf(adapters, path, built);
    if (before?.kind === 'config' || after?.kind === 'config' || before?.kind === 'installed' || after?.kind === 'installed') {
      for (const file of indexed().importers(path)) files.add(file);
      continue;
    }
    if (before?.kind === 'manifest' || after?.kind === 'manifest') {
      if (
        base.has(path) &&
        built.has(path) &&
        before?.kind === 'manifest' &&
        after?.kind === 'manifest' &&
        before.stamp !== undefined &&
        before.stamp === after.stamp
      )
        continue;
      const delta = before === undefined || after === undefined ? undefined : inputDeltaOf(adapters, before, after);
      if (delta !== undefined && indexed().watchers !== undefined) {
        for (const key of delta[change.mode ?? 'refreshed']) for (const file of indexed().watchers!(key)) files.add(file);
        continue;
      }
      const { dir } = (before ?? after) as Extract<ResolverInput, { kind: 'manifest' }>;
      manifests.push(dir);
      for (const file of indexed().under(dir)) files.add(file);
      for (const one of [before, after]) {
        if (one?.kind === 'manifest' && one.name !== undefined) for (const file of indexed().users(one.name)) files.add(file);
      }
      continue;
    }
    if (base.has(path) !== built.has(path)) for (const file of indexed().importers(path)) files.add(file);
  }
  return { whole: false, files: [...files].sort(), manifests };
}
