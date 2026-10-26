import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Records } from './records.ts';
import { adapterOf } from '@runlith/code-facts/adapter';
import type { ImportEdge, ImportSite } from '@runlith/code-facts/imports';
import { join } from 'node:path';
import { packagesOf, type Package } from './packages.ts';
import { ADAPTERS } from '@runlith/code-facts/adapters';
import { fileEdges, type Probed, type Tree, type Unresolved } from '@runlith/code-facts/tree';
import { workspaceOf } from '@runlith/code-facts/js/workspace';
import { RUNTIMES } from '@runlith/code-facts/runtimes';

export type Module = {
  readonly id: string;
  readonly paths: readonly string[];
  readonly imports: readonly string[];
  readonly tests: readonly string[];
};
export type Source = { readonly inputs: readonly string[]; readonly uncertain: readonly string[] };
export const sourceFile = (path: string): boolean => /\.(?:[cm]?[jt]sx?|svelte)$/.test(path);
export const testFile = (path: string): boolean => /\.(?:test|itest)(?:\.svelte)?\.[cm]?[jt]sx?$/.test(path);
const inside = (path: string, root: string): boolean => root === '' || path === root || path.startsWith(`${root}/`);

type Node = { readonly stamp: string; readonly probe: Probed };
type IndexRecord = { readonly resolution: string; readonly nodes: readonly [string, Node][] };

export class Graph {
  readonly modules: Module[];
  readonly packages: Package[];
  readonly files: ReadonlySet<string>;
  private readonly probes = new Map<string, Probed>();
  private readonly texts = new Map<string, string>();
  private readonly sites = new Map<string, readonly ImportSite[]>();
  private readonly held = new Map<string, Node>();
  private readonly dependencyPackages = new Map<string, readonly string[]>();
  private readonly resolution: string;
  private readonly resolvers;
  readonly tree: Tree;

  constructor(
    readonly root: string,
    paths: readonly string[],
    modules: readonly Module[],
    private readonly built: ReadonlyMap<string, string> = new Map(),
    private readonly cache?: Records,
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
    this.modules = [...modules];
  }

  text(path: string): string {
    let text = this.texts.get(path);
    if (text === undefined) {
      text = readFileSync(join(this.root, path), 'utf8');
      this.texts.set(path, text);
    }
    return text;
  }

  owner(path: string): Module | undefined {
    let owner: Module | undefined;
    let depth = -1;
    for (const module of this.modules)
      for (const root of module.paths)
        if (root.length > depth && inside(path, root)) {
          owner = module;
          depth = root.length;
        }
    return owner;
  }
  package(path: string): Package {
    return this.packages.find((pkg) => pkg.dir === '' || inside(path, pkg.dir))!;
  }
  runner(path: string): 'bun' | 'vitest' {
    const sites = this.tree.sites!(path);
    return sites.some((site) => site.specifier === 'bun:test')
      ? 'bun'
      : sites.some((site) => site.specifier === 'vitest')
        ? 'vitest'
        : this.package(path).runner;
  }

  affected(changed: readonly string[]): Map<string, string> {
    const reached = new Map<string, string>();
    for (const path of changed) {
      const owner = this.owner(path);
      if (owner !== undefined) reached.set(owner.id, `changed ${path} (${owner.id})`);
    }
    const reverse = new Map<string, Module[]>();
    for (const module of this.modules)
      for (const dependency of [...module.imports, ...module.tests]) {
        const list = reverse.get(dependency) ?? [];
        list.push(module);
        reverse.set(dependency, list);
      }
    const queue = [...reached.keys()];
    for (let at = 0; at < queue.length; at++)
      for (const module of reverse.get(queue[at]!) ?? []) {
        if (reached.has(module.id)) continue;
        reached.set(module.id, `module ${module.id} imports a changed dependency`);
        queue.push(module.id);
      }
    return reached;
  }

  private probe(path: string): Probed {
    const current = this.probes.get(path);
    if (current !== undefined) return current;
    const stamp = createHash('sha256').update(this.text(path)).digest('hex');
    const saved = this.held.get(path);
    if (saved?.stamp === stamp) {
      this.probes.set(path, saved.probe);
      return saved.probe;
    }
    const reads = this.resolvers.map((resolver) =>
      fileEdges(this.tree, path, 'every', ADAPTERS, resolver, ['?raw', '?url', '?inline', '?worker']),
    );
    const special = this.tree.sites!(path).filter((site) => site.kind !== undefined);
    const workers = special
      .filter((site) => site.kind === 'worker')
      .flatMap((site) => {
        const target = adapterOf(ADAPTERS, path).resolve(site.specifier, path, this.tree);
        return target !== null && 'to' in target ? [{ file: path, line: site.line, specifier: site.specifier, to: target.to }] : [];
      });
    const edges: ImportEdge[] = [];
    const unresolved: Unresolved[] = [];
    for (const edge of [...reads.flatMap((read) => read.edges), ...workers]) {
      const source = this.built.get(edge.to);
      if (source === undefined) edges.push(edge);
      else if (this.files.has(source)) edges.push({ ...edge, to: source });
      else unresolved.push({ file: edge.file, line: edge.line, specifier: edge.specifier, unlisted: source, absent: [source] });
    }
    for (const missing of reads.flatMap((read) => read.unresolved)) {
      const source = this.built.get(missing.unlisted);
      if (source !== undefined && this.files.has(source))
        edges.push({ file: missing.file, line: missing.line, specifier: missing.specifier, to: source });
      else unresolved.push(missing);
    }
    const probe: Probed = {
      edges,
      inputs: [...new Set(reads.flatMap((read) => read.inputs))],
      absent: [...new Set(reads.flatMap((read) => read.absent))],
      packages: [],
      unresolved,
      dynamic: [
        ...reads.flatMap((read) => read.dynamic),
        ...special
          .filter((site) => site.kind !== 'worker')
          .map((site) => ({ file: path, line: site.line, specifier: `${site.kind} ${site.specifier}` })),
      ],
    };
    this.probes.set(path, probe);
    this.held.set(path, { stamp, probe });
    return probe;
  }

  private walk(files: readonly string[]): Source {
    const visited = new Set<string>();
    const inputs = new Set<string>();
    const uncertain = new Set<string>();
    const queue = [...files];
    while (queue.length > 0) {
      const path = queue.pop()!;
      if (visited.has(path)) continue;
      visited.add(path);
      inputs.add(path);
      if (!this.files.has(path) || !sourceFile(path)) continue;
      const probe = this.probe(path);
      for (const input of probe.inputs) if (this.files.has(input)) inputs.add(input);
      for (const edge of probe.edges) if (!visited.has(edge.to)) queue.push(edge.to);
      for (const missing of [...probe.dynamic, ...probe.unresolved]) {
        if (!missing.specifier.startsWith('$app/') && missing.specifier !== '$service-worker')
          uncertain.add(`${path}:${missing.line} unresolved ${missing.specifier}`);
      }
    }
    return { inputs: [...inputs].sort(), uncertain: [...uncertain].sort() };
  }

  closure(file: string): Source {
    return this.walk([file]);
  }

  related(paths: readonly string[]): readonly string[] {
    const roots = new Set(paths.map((path) => this.owner(path)?.id).filter((id): id is string => id !== undefined));
    const packages = new Set<string>();
    const byId = new Map(this.modules.map((module) => [module.id, module]));
    for (const root of roots) {
      let held = this.dependencyPackages.get(root);
      if (held === undefined) {
        const seen = new Set<string>();
        const found = new Set<string>();
        const queue = [root];
        while (queue.length > 0) {
          const id = queue.pop()!;
          if (seen.has(id)) continue;
          seen.add(id);
          const module = byId.get(id);
          if (module === undefined) continue;
          for (const path of module.paths) {
            found.add(this.package(path).dir);
            for (const pkg of this.packages) if (inside(pkg.dir, path)) found.add(pkg.dir);
          }
          queue.push(...module.imports, ...module.tests);
        }
        held = [...found];
        this.dependencyPackages.set(root, held);
      }
      for (const dir of held) packages.add(dir);
    }
    return [...packages];
  }

  select(
    files: readonly string[],
    changed: readonly string[],
  ): { readonly selected: Map<string, string>; readonly imports: number; readonly cards: number; readonly runtime: number } {
    this.walk(files);
    const reverse = new Map<string, Set<string>>();
    const add = (to: string, from: string): void => {
      const list = reverse.get(to) ?? new Set();
      list.add(from);
      reverse.set(to, list);
    };
    for (const [path, probe] of this.probes) {
      for (const target of [...probe.edges.map((edge) => edge.to), ...probe.inputs, ...probe.absent]) add(target, path);
      add(`package:${this.package(path).dir}`, path);
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
    const uncertain = reach([...this.probes].filter(([, probe]) => probe.dynamic.length > 0).map(([path]) => path));
    const cards = this.affected(changed);
    const runtimeFiles = reach(['apps/tagma/server/src/composition/runtime.ts']);
    const selected = new Map<string, string>();
    let cardCount = 0;
    let runtime = 0;
    for (const file of files) {
      const owner = this.owner(file);
      const card = owner === undefined ? undefined : cards.get(owner.id);
      if (card !== undefined) cardCount++;
      if (imported.has(file))
        selected.set(file, changed.includes(file) ? `test changed: ${file}` : 'import closure reaches a changed input');
      else if (card !== undefined && uncertain.has(file)) selected.set(file, 'module-card reach covers a nonliteral import');
      if (runtimeFiles.has(file)) runtime++;
    }
    return { selected, imports: files.filter((file) => imported.has(file)).length, cards: cardCount, runtime };
  }

  save(): void {
    this.cache?.write('imports', { resolution: this.resolution, nodes: [...this.held] });
  }
}
