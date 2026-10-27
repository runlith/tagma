import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import type { Records } from './records.ts';
import type { Loads } from './loads.ts';
import { adapterOf } from '@runlith/code-facts/adapter';
import type { ImportEdge, ImportSite } from '@runlith/code-facts/imports';
import { packagesOf, type Package } from './packages.ts';
import { ADAPTERS } from '@runlith/code-facts/adapters';
import { fileEdges, type Dynamic, type Probed, type Tree, type Unresolved } from '@runlith/code-facts/tree';
import { workspaceOf } from '@runlith/code-facts/js/workspace';
import { RUNTIMES } from '@runlith/code-facts/runtimes';

export type Source = {
  readonly inputs: readonly string[];
  readonly uncertain: readonly string[];
  readonly importers: readonly string[];
};
export const sourceFile = (path: string): boolean => /\.(?:[cm]?[jt]sx?|svelte)$/.test(path);
export const testFile = (path: string): boolean => /\.(?:test|itest)(?:\.svelte)?\.[cm]?[jt]sx?$/.test(path);
const VIRTUAL = (specifier: string): boolean => specifier.startsWith('$app/') || specifier === '$service-worker';

type Node = { readonly stamp: string; readonly probe: Probed };
type IndexRecord = { readonly resolution: string; readonly nodes: readonly [string, Node][] };

export class Graph {
  readonly packages: Package[];
  readonly files: ReadonlySet<string>;
  private readonly probes = new Map<string, Probed>();
  private readonly texts = new Map<string, string>();
  private readonly stamps = new Map<string, string>();
  private readonly sites = new Map<string, readonly ImportSite[]>();
  private readonly held = new Map<string, Node>();
  private readonly declarations = new Map<string, readonly string[] | undefined>();
  private readonly threaded = new Map<string, readonly ImportEdge[]>();
  private readonly resolution: string;
  private readonly resolvers;
  readonly tree: Tree;

  constructor(
    readonly root: string,
    paths: readonly string[],
    private readonly built: ReadonlyMap<string, string> = new Map(),
    private readonly cache?: Records,
    private readonly loads?: Loads,
  ) {
    this.files = new Set(paths);
    this.tree = {
      has: (path) => this.files.has(path),
      read: (path) => this.text(path),
      paths: () => this.files,
      sites: (path) => {
        let sites = this.sites.get(path);
        if (sites === undefined) {
          sites = adapterOf(ADAPTERS, path).imports(this.text(path), path);
          this.sites.set(path, sites);
        }
        return sites;
      },
    };
    const hash = createHash('sha256')
      .update(Bun.version)
      .update(readFileSync(import.meta.path))
      .update(JSON.stringify([...built]))
      .update(paths.filter(sourceFile).sort().join('\0'));
    for (const path of paths.filter(
      (path) =>
        path.endsWith('/package.json') ||
        path === 'package.json' ||
        path === 'bun.lock' ||
        /config.*\.json$/.test(path) ||
        (path.startsWith('packages/code-facts/') && sourceFile(path)),
    ))
      hash.update(path).update(this.text(path));
    this.resolution = hash.digest('hex');
    const saved = cache?.read<IndexRecord>('imports');
    if (saved?.resolution === this.resolution) for (const [path, node] of saved.nodes) this.held.set(path, node);
    this.resolvers = [
      workspaceOf(this.tree, '', ['bun', 'node', 'import'], built, RUNTIMES),
      workspaceOf(this.tree, '', ['browser', 'module', 'import', 'development'], built, RUNTIMES),
    ];
    this.packages = packagesOf(paths, (path) => this.text(path));
  }

  text(path: string): string {
    let text = this.texts.get(path);
    if (text === undefined) {
      text = readFileSync(join(this.root, path), 'utf8');
      this.texts.set(path, text);
    }
    return text;
  }

  stamp(path: string): string {
    let stamp = this.stamps.get(path);
    if (stamp === undefined) {
      stamp = createHash('sha256').update(this.text(path)).digest('hex');
      this.stamps.set(path, stamp);
    }
    return stamp;
  }

  package(path: string): Package {
    return this.packages.find((pkg) => pkg.dir === '' || path === pkg.dir || path.startsWith(`${pkg.dir}/`))!;
  }
  runner(path: string): 'bun' | 'vitest' {
    const sites = this.tree.sites!(path);
    return sites.some((site) => site.specifier === 'bun:test')
      ? 'bun'
      : sites.some((site) => site.specifier === 'vitest')
        ? 'vitest'
        : this.package(path).runner;
  }

  private globbed(path: string, patterns: readonly string[]): string[] | undefined {
    const positive: Bun.Glob[] = [];
    const negative: Bun.Glob[] = [];
    for (const written of patterns) {
      const negated = written.startsWith('!');
      const pattern = negated ? written.slice(1) : written;
      const at = pattern.startsWith('/')
        ? posix.join(this.package(path).dir, pattern.slice(1))
        : pattern.startsWith('./') || pattern.startsWith('../')
          ? posix.join(posix.dirname(path), pattern)
          : undefined;
      if (at === undefined) return undefined;
      (negated ? negative : positive).push(new Bun.Glob(at));
    }
    return [...this.files].filter((file) => positive.some((glob) => glob.match(file)) && !negative.some((glob) => glob.match(file)));
  }

  private probe(path: string): Probed {
    const current = this.probes.get(path);
    if (current !== undefined) return current;
    const stamp = this.stamp(path);
    const saved = this.held.get(path);
    if (saved?.stamp === stamp) {
      this.probes.set(path, saved.probe);
      return saved.probe;
    }
    const reads = this.resolvers.map((resolver) =>
      fileEdges(this.tree, path, 'runtime', ADAPTERS, resolver, ['?raw', '?url', '?inline', '?worker']),
    );
    const special = this.tree.sites!(path).filter((site) => site.kind !== undefined && site.loads !== 'never');
    const edges: ImportEdge[] = [];
    const unresolved: Unresolved[] = [];
    const dynamic: Dynamic[] = [];
    const add = (edge: ImportEdge): void => {
      const source = this.built.get(edge.to);
      if (source === undefined) edges.push(edge);
      else if (this.files.has(source)) edges.push({ ...edge, to: source });
      else unresolved.push({ file: edge.file, line: edge.line, specifier: edge.specifier, unlisted: source, absent: [source] });
    };
    for (const edge of reads.flatMap((read) => read.edges)) add(edge);
    for (const edge of this.workers(path)) add(edge);
    for (const site of special) {
      if (site.kind === 'worker') continue;
      const matched = site.kind === 'glob' && site.patterns !== undefined ? this.globbed(path, site.patterns) : undefined;
      if (matched === undefined) dynamic.push({ file: path, line: site.line, specifier: site.specifier });
      else for (const to of matched) edges.push({ file: path, line: site.line, specifier: site.specifier, to });
    }
    const reached = new Set(edges.map((edge) => `${edge.line}\0${edge.specifier}`));
    const missed = new Set<string>();
    for (const missing of reads.flatMap((read) => read.unresolved)) {
      const source = this.built.get(missing.unlisted);
      if (source !== undefined && this.files.has(source)) {
        edges.push({ file: missing.file, line: missing.line, specifier: missing.specifier, to: source });
        reached.add(`${missing.line}\0${missing.specifier}`);
      }
    }
    for (const missing of reads.flatMap((read) => read.unresolved)) {
      const site = `${missing.line}\0${missing.specifier}`;
      if (reached.has(site) || missed.has(site)) continue;
      missed.add(site);
      unresolved.push(missing);
    }
    const probe: Probed = {
      edges,
      inputs: [...new Set(reads.flatMap((read) => read.inputs))],
      absent: [...new Set(reads.flatMap((read) => read.absent))],
      packages: [],
      unresolved: unresolved.filter((missing) => !VIRTUAL(missing.specifier)),
      dynamic,
    };
    this.probes.set(path, probe);
    this.held.set(path, { stamp, probe });
    return probe;
  }

  private workers(path: string): readonly ImportEdge[] {
    let edges = this.threaded.get(path);
    if (edges === undefined) {
      edges = this.tree.sites!(path).flatMap((site) => {
        if (site.kind !== 'worker') return [];
        const target = adapterOf(ADAPTERS, path).resolve(site.specifier, path, this.tree);
        return target !== null && 'to' in target ? [{ file: path, line: site.line, specifier: site.specifier, to: target.to }] : [];
      });
      this.threaded.set(path, edges);
    }
    return edges;
  }

  private unknown(path: string): readonly { readonly line: number; readonly specifier: string }[] {
    const probe = this.probe(path);
    return [...probe.dynamic, ...probe.unresolved];
  }

  literal(path: string): readonly string[] {
    return this.tree.sites!(path)
      .filter((site) => site.kind === undefined)
      .map((site) => site.specifier);
  }

  declared(path: string): readonly string[] | undefined {
    if (this.declarations.has(path)) return this.declarations.get(path);
    const pkg = this.package(path);
    const globs = pkg.loads[pkg.dir === '' ? path : path.slice(pkg.dir.length + 1)]?.map((glob) => new Bun.Glob(glob));
    const targets = globs === undefined ? undefined : [...this.files].filter((file) => globs.some((glob) => glob.match(file)));
    this.declarations.set(path, targets);
    return targets;
  }

  private next(path: string): string[] {
    const probe = this.probe(path);
    const observed = this.unknown(path).length === 0 ? [] : (this.declared(path) ?? this.loads?.targets(path, this.stamp(path)) ?? []);
    return [...probe.edges.map((edge) => edge.to), ...observed.filter((target) => this.files.has(target))];
  }

  private settled(path: string, test: string | undefined, threaded: ReadonlySet<string>): boolean {
    if (this.declared(path) !== undefined) return true;
    return test !== undefined && !threaded.has(path) && this.loads?.covers(test, path, this.stamp(path)) === true;
  }

  private threads(starts: readonly string[]): Set<string> {
    const threaded = new Set<string>();
    const queue = starts.flatMap((path) => (this.files.has(path) && sourceFile(path) ? this.workers(path).map((edge) => edge.to) : []));
    while (queue.length > 0) {
      const path = queue.pop()!;
      if (threaded.has(path)) continue;
      threaded.add(path);
      if (this.files.has(path) && sourceFile(path)) queue.push(...this.next(path), ...this.workers(path).map((edge) => edge.to));
    }
    return threaded;
  }

  private walk(files: readonly string[], test?: string): Source {
    const visited = new Set<string>();
    const inputs = new Set<string>();
    const found = new Set<string>();
    const queue = [...files];
    while (queue.length > 0) {
      const path = queue.pop()!;
      if (visited.has(path)) continue;
      visited.add(path);
      inputs.add(path);
      if (!this.files.has(path) || !sourceFile(path)) continue;
      for (const input of this.probe(path).inputs) if (this.files.has(input)) inputs.add(input);
      for (const target of this.next(path)) if (!visited.has(target)) queue.push(target);
      if (this.unknown(path).length > 0) found.add(path);
    }
    const threaded = this.threads([...visited]);
    const uncertain = [...found].flatMap((path) => {
      const site = this.unknown(path)[0]!;
      return this.settled(path, test, threaded) ? [] : [`${path}:${site.line} ${site.specifier}`];
    });
    return { inputs: [...inputs].sort(), uncertain: uncertain.sort(), importers: [...found].sort() };
  }

  closure(file: string): Source {
    return this.walk([file], file);
  }

  select(
    files: readonly string[],
    changed: readonly string[],
  ): { readonly selected: Map<string, string>; readonly imports: number; readonly untraced: number } {
    this.walk(files);
    const reverse = new Map<string, Set<string>>();
    const add = (to: string, from: string): void => {
      const list = reverse.get(to) ?? new Set();
      list.add(from);
      reverse.set(to, list);
    };
    const importers: string[] = [];
    for (const [path, probe] of this.probes) {
      for (const target of [...this.next(path), ...probe.inputs, ...probe.absent]) add(target, path);
      add(`package:${this.package(path).dir}`, path);
      if (this.unknown(path).length > 0 && this.declared(path) === undefined) importers.push(path);
    }
    const reach = (starts: readonly string[]): Set<string> => {
      const found = new Set(starts);
      const queue = [...starts];
      for (let at = 0; at < queue.length; at++)
        for (const path of reverse.get(queue[at]!) ?? [])
          if (!found.has(path)) {
            found.add(path);
            queue.push(path);
          }
      return found;
    };
    const seeds = changed.flatMap((path) =>
      !sourceFile(path) || (!testFile(path) && (/\.fixture\.|\/fixtures?\//.test(path) || !reverse.has(path)))
        ? [path, `package:${this.package(path).dir}`]
        : [path],
    );
    const imported = reach(seeds);
    const selected = new Map<string, string>();
    for (const file of files)
      if (imported.has(file))
        selected.set(file, changed.includes(file) ? `test changed: ${file}` : 'import closure reaches a changed input');
    let untraced = 0;
    const tests = new Set(files);
    const threaded = this.threads([...this.probes.keys()]);
    for (const importer of importers.sort()) {
      const site = this.unknown(importer)[0]!;
      for (const file of reach([importer])) {
        if (!tests.has(file) || this.settled(importer, file, threaded)) continue;
        if (!selected.has(file)) {
          untraced++;
          selected.set(file, `reaches a nonliteral import its run has not traced: ${importer}:${site.line} ${site.specifier}`);
        }
      }
    }
    return { selected, imports: files.filter((file) => imported.has(file)).length, untraced };
  }

  save(): void {
    this.cache?.write('imports', { resolution: this.resolution, nodes: [...this.held] });
  }
}
