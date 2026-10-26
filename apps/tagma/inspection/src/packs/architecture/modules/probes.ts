import { type Adapter, adapterOf, type Adapters, type Resolver, type ResolverInput } from '@runlith/code-facts/adapter';
import { COUNTS, InputAbsent, type ReachNode, type ReachRows, UnsupportedSource } from '@runlith/code-facts/imports';
import { fileEdges, impactOf, inputDeltaOf, sitesOf, type Probed, type ImpactIndex, type Tree } from '@runlith/code-facts/tree';
import { contextDigest } from '@runlith/code-facts/adapter';
import type { Budget } from '../../../core/node/budget';
import type { InspectionMemo, ReachIndex } from '../../../core/node/memo';
import { boundariesFor, type Run } from './declaration';
import type { AccessTarget } from './access';
import { globPaths, globRoot, localOf, prefixOf, resolvedGlobs } from '../../../core/node/select';

const mapped = new WeakMap<Run, ReadonlyMap<string, string>>();
export const builtSources = (params: Run): ReadonlyMap<string, string> => {
  let sources = mapped.get(params);
  if (sources === undefined) {
    const prefix = prefixOf(params.base);
    sources = new Map((params.built ?? []).map(({ output, source }) => [`${prefix}${output}`, `${prefix}${source}`]));
    mapped.set(params, sources);
  }
  return sources;
};

const rootOf = (params: Run, path: string): string | undefined => {
  let found: string | undefined;
  for (const root of params.roots ?? [])
    if ((root === '' || path.startsWith(`${root}/`)) && (found === undefined || root.length > found.length)) found = root;
  return found;
};

export const probeKey = (params: Run, slot: string): string => {
  const { map, ...policy } = params;
  const territory = map.modules.map(({ id, territory }) => ({ id, territory }));
  return `module-imports:glob:${slot}:${contextDigest({ ...policy, territory, region: map.region })}`;
};

type Reader = { readonly files: Map<string, Probed>; readonly resolvers: Map<Adapter, Resolver | null>; readonly checked: Set<string> };
const rounds = new WeakMap<Budget, Map<Tree['read'], Reader>>();

const readerOf = (budget: Budget, tree: Tree): Reader => {
  let trees = rounds.get(budget);
  if (trees === undefined) rounds.set(budget, (trees = new Map()));
  let reader = trees.get(tree.read);
  if (reader === undefined) trees.set(tree.read, (reader = { files: new Map(), resolvers: new Map(), checked: new Set() }));
  return reader;
};

const unread = (params: Run, failure: InputAbsent): InputAbsent => {
  const at = localOf(params.base, failure.absent);
  const way = [...builtSources(params).values()].includes(failure.absent)
    ? `land \`${at}\` in a commit of its own, or point the \`built\` entry that names it at a tracked file in the rule's inspection in tagma.config.ts`
    : at === undefined
      ? `it lies outside the rule's base, which no \`built\` entry names: widen the base of the rule's inspection in tagma.config.ts, then declare it there`
      : `land a copy of it in a commit of its own, then add to the rule's inspection in tagma.config.ts a \`built\` entry with \`${at}\` as its output and the copy as its source`;
  return new InputAbsent(failure.path, failure.absent, `${failure.why}; ${way}`);
};

export const probeFiles = (params: Run, tree: Tree, paths: readonly string[], adapters: Adapters, budget: Budget): Probed[] => {
  const reader = readerOf(budget, tree);
  const sources = builtSources(params);
  const context = () => ({
    conditions: params.conditions ?? [],
    runtimes: params.runtimes ?? [],
    built: [...sources].map(([output, source]) => ({ output, source })),
  });
  const resolverOf = (adapter: Adapter): Resolver | null => {
    if (!reader.resolvers.has(adapter)) reader.resolvers.set(adapter, adapter.resolver?.(tree, params.base, context()) ?? null);
    return reader.resolvers.get(adapter) ?? null;
  };
  const current = (path: string, note: Probed): Probed => {
    const copied = note.inputs.filter((input) => sources.has(input) && !reader.checked.has(input));
    if (copied.length === 0) return note;
    const stale = resolverOf(adapterOf(adapters, path))?.stale?.(copied);
    if (stale !== undefined) throw stale;
    for (const input of copied) reader.checked.add(input);
    return note;
  };
  return paths.map((path) => {
    const held = reader.files.get(path);
    if (held !== undefined) return current(path, held);
    const object = tree.object?.(path);
    if (object !== undefined && budget.source !== undefined) budget.source(object, tree.size?.(path) ?? 0);
    else budget.take(1, tree.size?.(path) ?? 0);
    const adapter = adapterOf(adapters, path);
    let found: Probed;
    try {
      const sites = sitesOf(tree, path, adapters);
      found = fileEdges(
        { ...tree, sites: (file) => (file === path ? sites : sitesOf(tree, file, adapters)) },
        path,
        params.reads,
        adapters,
        () => resolverOf(adapter),
        params.queries,
      );
      const edges = [...found.edges];
      const dynamic = [...found.dynamic];
      const watches = new Set(found.watches);
      for (const site of sites) {
        if (site.kind !== 'glob' || !COUNTS[params.reads](site)) continue;
        const patterns = resolvedGlobs(path, site.patterns ?? [], rootOf(params, path));
        if (patterns === undefined || tree.paths === undefined) {
          dynamic.push({ file: path, line: site.line, specifier: site.specifier });
          continue;
        }
        for (const pattern of patterns) if (!pattern.startsWith('!')) watches.add(`g:${globRoot(pattern)}`);
        for (const to of globPaths(
          (root) => tree.paths!(root),
          patterns,
          (units) => budget.take(units, 0),
        ))
          edges.push({ file: path, line: site.line, specifier: site.specifier, to });
      }
      found = { ...found, edges: edges.sort((left, right) => left.line - right.line), dynamic, watches: [...watches] };
    } catch (failure) {
      throw failure instanceof InputAbsent ? unread(params, failure) : failure;
    }
    reader.files.set(path, found);
    return current(path, found);
  });
};

const remember = (budget: Budget, tree: Tree, path: string, note: Probed): void => {
  readerOf(budget, tree).files.set(path, note);
};

class Probes implements ReachRows<Probed> {
  readonly changed = new Map<string, ReachNode<Probed> | null>();
  private readonly out = new Map<string, Set<string>>();
  private readonly watch = new Map<string, Set<string>>();
  constructor(private readonly held: ReachRows<Probed> | undefined) {}
  node(path: string): ReachNode<Probed> | undefined {
    return this.changed.has(path) ? (this.changed.get(path) ?? undefined) : this.held?.node(path);
  }
  sources(path: string): Iterable<string> {
    return this.readers(this.held?.sources(path), this.out.get(path));
  }
  watchers(key: string): Iterable<string> {
    return this.readers(this.held?.watchers(key), this.watch.get(key));
  }
  private readers(standing: Iterable<string> | undefined, fresh: Set<string> | undefined): string[] {
    return [...new Set([...(standing ?? [])].filter((path) => !this.changed.has(path)).concat([...(fresh ?? [])]))];
  }
  set(path: string, node: ReachNode<Probed> | null): void {
    const before = this.changed.get(path);
    if (before !== undefined && before !== null) {
      for (const key of before.out) this.out.get(key)?.delete(path);
      for (const key of before.watch) this.watch.get(key)?.delete(path);
    }
    this.changed.set(path, node);
    if (node === null) return;
    const add = (map: Map<string, Set<string>>, key: string) => {
      let files = map.get(key);
      if (files === undefined) map.set(key, (files = new Set()));
      files.add(path);
    };
    for (const key of node.out) add(this.out, key);
    for (const key of node.watch) add(this.watch, key);
  }
}

const pairKey = (consumer: string, owner: string): string => `m:${consumer}\0${owner}`;

const derive = (params: Run, tree: Tree, path: string, adapters: Adapters, budget: Budget): ReachNode<Probed> => {
  const [note] = probeFiles(params, tree, [path], adapters, budget);
  const sources = builtSources(params);
  const projected = [
    ...note!.edges.map(({ to }) => sources.get(to)),
    ...note!.unresolved.map(({ unlisted }) => sources.get(unlisted)),
  ].filter((path): path is string => path !== undefined);
  const boundaries = boundariesFor(params);
  const prefix = prefixOf(params.base);
  const consumer = boundaries.consumerOf(path.slice(prefix.length));
  const outbound = [...new Set([...note!.edges.map(({ to }) => to), ...projected])];
  const pairs =
    consumer === undefined
      ? []
      : outbound.flatMap((target) => {
          if (!target.startsWith(prefix)) return [];
          const owner = boundaries.ownerOf(target.slice(prefix.length));
          return owner === undefined ? [] : [pairKey(consumer, owner)];
        });
  return {
    object: tree.object?.(path) ?? '',
    rank: 0,
    out: outbound,
    watch: [...new Set([...note!.absent, ...note!.inputs, ...projected])]
      .map((path) => `p:${path}`)
      .concat(
        note!.packages.map((name) => `n:${name}`),
        note!.watches ?? [],
        [...new Set(pairs)],
      ),
    note: note!,
  };
};

type Inputs = Readonly<Record<string, ResolverInput | null>>;

const candidates = (
  base: Tree,
  built: Tree,
  paths: readonly string[],
  adapters: Adapters,
  rows: Probes,
  beforeInputs?: Inputs,
  mode: 'narrowed' | 'refreshed' = 'refreshed',
): readonly string[] => {
  const indexed = (): ImpactIndex => ({
    importers: (path) => [...new Set([...rows.sources(path), ...rows.watchers(`p:${path}`)])],
    users: (name) => [...rows.watchers(`n:${name}`)],
    under: (dir) => [...(built.paths?.(dir) ?? [])],
    watchers: (key) => rows.watchers(key),
  });
  const impact = impactOf({ base, built, paths, beforeInputs, mode }, adapters, indexed);
  if (impact.whole) return [...(built.paths?.() ?? [])];
  const found = new Set(impact.files);
  for (const path of paths) {
    if (base.has(path) === built.has(path)) continue;
    for (let at = path.lastIndexOf('/'); at !== -1; at = path.lastIndexOf('/', at - 1))
      for (const file of rows.watchers(`g:${path.slice(0, at)}`)) found.add(file);
    for (const file of rows.watchers('g:')) found.add(file);
  }
  return [...found];
};

export const mapFiles = (
  params: Run,
  tree: Tree,
  targets: readonly AccessTarget[],
  sources: readonly string[],
  adapters: Adapters,
  budget: Budget,
  memo: InspectionMemo | undefined,
  selects: (path: string) => boolean,
  narrowed: (file: string, note: Probed) => boolean,
): { readonly paths: readonly string[]; readonly inputs: readonly string[] } => {
  if (targets.length === 0 && sources.length === 0) return { paths: [], inputs: [] };
  if (tree.paths === undefined) throw new UnsupportedSource(params.base, 'the tree must list paths to find narrowed module access');
  const index: ReachIndex<Probed, Inputs> | undefined = tree.slot === undefined ? undefined : memo?.reach?.(probeKey(params, tree.slot));
  const change = tree.change;
  const advances = change?.headEntries !== undefined && index?.head?.tree === change.headTree;
  const rebuild = index?.head === undefined || (index.head.tree !== tree.snapshot && !advances);
  const rows = new Probes(rebuild ? undefined : index);
  const update = (files: Iterable<string>) => {
    for (const path of new Set(files))
      rows.set(path, tree.has(path) && selects(path) ? derive(params, tree, path, adapters, budget) : null);
  };
  if (rebuild) update(tree.paths());
  else if (advances) {
    const entries = change!.headEntries!;
    const touched = entries.map(({ path }) => path);
    const before = new Map(entries.map((entry) => [entry.path, entry.before]));
    const prior: Tree = { ...tree, has: (path) => (before.has(path) ? before.get(path) !== null : tree.has(path)) };
    update([...touched, ...candidates(prior, tree, touched, adapters, rows, index?.members)]);
  }
  if ((rebuild || advances) && index !== undefined && tree.snapshot !== undefined) {
    const inputs: Record<string, ResolverInput | null> = rebuild ? {} : { ...index.members };
    const observed = new Set([
      ...adapters.flatMap((adapter) => adapter.inputs?.(params.base) ?? []),
      ...(change?.headEntries ?? []).map(({ path }) => path),
    ]);
    for (const node of rows.changed.values()) if (node !== null) for (const path of node.note.inputs) observed.add(path);
    for (const path of observed) {
      delete inputs[path];
      for (const adapter of adapters) {
        const input = adapter.input?.(path, tree);
        if (input !== undefined) {
          inputs[path] = tree.has(path) ? input : null;
          break;
        }
      }
    }
    index.stage(
      index.head,
      tree.snapshot,
      { nodes: rows.changed, added: [], removed: [], derived: [...rows.changed.keys()] },
      inputs,
      rebuild,
    );
  }
  const found = new Set<string>();
  const pairs = new Set(targets.flatMap(({ owner, consumers }) => consumers.map((consumer) => pairKey(consumer, owner))));
  for (const key of pairs)
    for (const file of rows.watchers(key)) {
      const note = rows.node(file)?.note;
      if (note !== undefined && narrowed(file, note)) found.add(file);
    }
  for (const root of sources) for (const file of tree.paths(root)) if (selects(file)) found.add(file);
  const inputs = new Set(Object.keys(index?.members ?? {}));
  for (const node of rows.changed.values()) if (node !== null) for (const path of node.note.inputs) inputs.add(path);
  for (const file of found) {
    const note = rows.node(file)?.note;
    if (note !== undefined) {
      remember(budget, tree, file, note);
      for (const path of note.inputs) inputs.add(path);
    }
  }
  return { paths: [...found], inputs: [...inputs] };
};

const landing = (note: Probed): string =>
  JSON.stringify([
    note.edges.map(({ line, specifier, to }) => [line, specifier, to]),
    note.unresolved.map(({ line, specifier, unlisted }) => [line, specifier, unlisted]),
  ]);

export const affectedFiles = (
  params: Run,
  base: Tree,
  built: Tree,
  paths: readonly string[],
  adapters: Adapters,
  budget: Budget,
  memo: InspectionMemo | undefined,
  selects: (path: string) => boolean,
): readonly string[] => {
  const inputAt = (tree: Tree, path: string): ResolverInput | undefined => {
    for (const adapter of adapters) {
      const input = adapter.input?.(path, tree);
      if (input !== undefined) return input;
    }
    return undefined;
  };
  const breaking = paths.filter((path) => {
    if (!base.has(path)) return false;
    const before = inputAt(base, path);
    if (before?.kind === 'config') return true;
    if (before?.kind !== 'manifest') return !built.has(path);
    const after = inputAt(built, path);
    if (!built.has(path) || after?.kind !== 'manifest') return true;
    if (before.stamp !== undefined && before.stamp === after.stamp) return false;
    return (inputDeltaOf(adapters, before, after)?.narrowed.length ?? 1) > 0;
  });
  const index: ReachIndex<Probed, Inputs> | undefined = base.slot === undefined ? undefined : memo?.reach?.(probeKey(params, base.slot));
  const change = base.change;
  const matches = index?.head?.tree === base.snapshot;
  const advances = change !== undefined && index?.head?.tree === change.headTree && change.headEntries !== undefined;
  const moved = paths.filter((path) => base.has(path) !== built.has(path));
  if (breaking.length === 0 && moved.length === 0 && (index?.head === undefined || (!matches && !advances))) return [];
  if (base.paths === undefined || built.paths === undefined)
    throw new UnsupportedSource(params.base, 'both trees must list paths, so affected importers can be found');
  const rebuild = index?.head === undefined || (!matches && !advances);
  const rows = new Probes(rebuild ? undefined : index);
  const update = (tree: Tree, files: readonly string[]): void => {
    for (const path of new Set(files))
      rows.set(path, tree.has(path) && selects(path) ? derive(params, tree, path, adapters, budget) : null);
  };
  const changed = new Set(paths);
  if (rebuild) {
    const globsOnly = breaking.length === 0 && index === undefined;
    const mentioned = globsOnly ? base.mentions?.(['meta']) : undefined;
    update(
      base,
      [...(mentioned ?? base.paths())].filter(
        (path) => !changed.has(path) && selects(path) && (!globsOnly || mentioned !== undefined || base.read(path).includes('meta')),
      ),
    );
  } else if (advances) {
    const entries = change!.headEntries!;
    const touched = entries.map(({ path }) => path);
    const before = new Map(entries.map((entry) => [entry.path, entry.before]));
    const prior: Tree = { ...base, has: (path) => (before.has(path) ? before.get(path) !== null : base.has(path)) };
    update(
      base,
      [...touched, ...candidates(prior, base, touched, adapters, rows, index?.members)].filter((path) => !changed.has(path)),
    );
  }
  const found = candidates(base, built, [...new Set([...breaking, ...moved])], adapters, rows, undefined, 'narrowed').filter(
    (path) => !changed.has(path) && base.has(path) && built.has(path) && selects(path),
  );
  const before = new Map<string, Probed>();
  for (const path of found) {
    const note = rows.node(path)?.note;
    if (note !== undefined) {
      before.set(path, note);
      remember(budget, base, path, note);
    }
  }
  update(built, [...paths, ...found, ...candidates(base, built, paths, adapters, rows)]);
  if (index !== undefined && built.snapshot !== undefined) {
    const inputs: Record<string, ResolverInput | null> = rebuild ? {} : { ...index.members };
    const observed = new Set([
      ...paths,
      ...(change?.headEntries ?? []).map(({ path }) => path),
      ...adapters.flatMap((adapter) => adapter.inputs?.(params.base) ?? []),
    ]);
    for (const node of rows.changed.values()) if (node !== null) for (const path of node.note.inputs) observed.add(path);
    const moved = new Set([...(change?.baseEntries ?? []).map(({ path }) => path), ...(change?.headEntries ?? []).map(({ path }) => path)]);
    for (const path of observed) {
      if (!rebuild && !moved.has(path) && Object.hasOwn(inputs, path)) continue;
      const input = inputAt(built, path);
      if (input === undefined) delete inputs[path];
      else inputs[path] = built.has(path) ? input : null;
    }
    index.stage(
      index.head,
      built.snapshot,
      {
        nodes: rows.changed,
        added: [],
        removed: [],
        derived: [...rows.changed.keys()],
      },
      inputs,
      rebuild,
    );
  }
  return found.filter((path) => {
    const was = before.get(path);
    const now = rows.node(path)?.note;
    return was !== undefined && now !== undefined && (builtSources(params).size > 0 || landing(was) !== landing(now));
  });
};
