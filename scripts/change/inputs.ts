import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, readlinkSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { Graph } from './graph.ts';
import type { Package } from './packages.ts';
import { sourceFile } from './graph.ts';

export type Inputs = {
  readonly key: string;
  readonly packages: readonly string[];
  readonly files: readonly string[];
  readonly uncertain: readonly string[];
};
export type Variant = { readonly seed: number; readonly adapter: string; readonly isolated: boolean };
const OUTPUTS = new Set(['node_modules', '.git', '.svelte-kit', '.vite', '.cache', 'target', 'coverage']);
const KIT = resolve(import.meta.dir, '../..');

export class Hashes {
  private readonly digests = new Map<string, string>();
  private readonly packageFiles = new Map<string, readonly string[]>();
  private readonly packageKeys = new Map<string, string>();
  private readonly global: readonly string[];
  private readonly common: string;
  readonly versions: readonly string[];

  constructor(
    readonly graph: Graph,
    versions: readonly string[],
    readonly variant: Variant,
  ) {
    this.versions = versions;
    this.global = [...graph.files].filter(
      (file) =>
        /^(?:bun\.lock|Cargo\.lock|bunfig\.toml|package\.json|tagma\.config\.ts)$/.test(file) ||
        file.startsWith('patches/') ||
        file.startsWith('packages/testbed/') ||
        file.startsWith('scripts/change/') ||
        file.includes('/drizzle/'),
    );
    for (const directory of ['packages/sqlite-process/src', 'packages/watch/src', 'packages/execution-host/native']) {
      if (!existsSync(join(graph.root, directory))) continue;
      this.global = [
        ...this.global,
        ...this.below(directory).filter(
          (file) => /\.(?:native|node|dylib|so|dll|exe)$/.test(file) || /\/(?:holder|execution-host)$/.test(file),
        ),
      ];
    }
    const engine = join(KIT, 'packages/sqlite-process/native/build');
    if (existsSync(engine))
      this.global = [
        ...this.global,
        ...readdirSync(engine, { recursive: true, withFileTypes: true })
          .filter((entry) => entry.isFile())
          .map((entry) => join(entry.parentPath, entry.name)),
      ];
    const release = 'packages/execution-host/native/target/release';
    if (existsSync(join(graph.root, release)))
      this.global = [
        ...this.global,
        ...readdirSync(join(graph.root, release), { withFileTypes: true })
          .filter(
            (entry) =>
              !entry.isDirectory() &&
              (/\.(?:dylib|so|dll|exe)$/.test(entry.name) || /^(?:execution-holder(?:-relay)?|execution-host)$/.test(entry.name)),
          )
          .map((entry) => `${release}/${entry.name}`),
      ];
    const common = createHash('sha256');
    for (const file of [...new Set(this.global)].sort()) common.update(file).update('\0').update(this.digest(file)).update('\0');
    this.common = common.digest('hex');
  }

  private below(directory: string): string[] {
    const paths: string[] = [];
    const visited = new Set<string>();
    const scan = (dir: string): void => {
      const absolute = realpathSync(join(this.graph.root, dir));
      if (visited.has(absolute)) return;
      visited.add(absolute);
      for (const entry of readdirSync(absolute, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        if (OUTPUTS.has(entry.name) || entry.name === '.bun-test-timings.json' || entry.name.endsWith('.tsbuildinfo')) continue;
        const file = dir === '' ? entry.name : `${dir}/${entry.name}`;
        const linkedDirectory = entry.isSymbolicLink() && statSync(join(absolute, entry.name), { throwIfNoEntry: false })?.isDirectory();
        if (entry.isDirectory() || linkedDirectory) {
          if (linkedDirectory) paths.push(file);
          if (this.graph.package(file).dir === directory || (directory !== '' && !this.graph.packages.some((pkg) => pkg.dir === file)))
            scan(file);
        } else paths.push(file);
      }
    };
    scan(directory);
    return paths.sort();
  }

  private filesOf(pkg: Package): readonly string[] {
    let files = this.packageFiles.get(pkg.dir);
    if (files === undefined) {
      files =
        pkg.dir === ''
          ? [...this.graph.files].filter((path) => !path.startsWith('.') && this.graph.package(path).dir === '')
          : this.below(pkg.dir);
      this.packageFiles.set(pkg.dir, files);
    }
    return files;
  }

  private digest(file: string): string {
    let digest = this.digests.get(file);
    if (digest === undefined) {
      const absolute = isAbsolute(file) ? file : join(this.graph.root, file);
      const info = lstatSync(absolute, { throwIfNoEntry: false });
      if (info === undefined) digest = 'missing';
      else {
        const target = info.isSymbolicLink() ? statSync(absolute, { throwIfNoEntry: false }) : info;
        digest = createHash('sha256')
          .update(info.isSymbolicLink() ? `link:${readlinkSync(absolute)}\0` : '')
          .update(target === undefined ? 'missing' : target.isDirectory() ? 'directory\0' : readFileSync(absolute))
          .digest('hex');
      }
      this.digests.set(file, digest);
    }
    return digest;
  }

  of(file: string): Inputs {
    const closure = this.graph.closure(file);
    const packages = [
      ...new Set([
        this.graph.package(file).dir,
        ...closure.inputs.filter(sourceFile).map((path) => this.graph.package(path).dir),
        ...(closure.uncertain.length > 0 ? this.graph.related(closure.inputs) : []),
      ]),
    ].sort();
    const files = [...new Set([...this.global, ...closure.inputs.filter((path) => !sourceFile(path))])].sort();
    const hash = createHash('sha256')
      .update(JSON.stringify({ file, versions: this.versions, variant: this.variant }))
      .update(this.common);
    for (const dir of packages) {
      let key = this.packageKeys.get(dir);
      if (key === undefined) {
        const digest = createHash('sha256');
        for (const path of this.filesOf(this.graph.packages.find((pkg) => pkg.dir === dir)!))
          digest.update(path).update('\0').update(this.digest(path)).update('\0');
        key = digest.digest('hex');
        this.packageKeys.set(dir, key);
      }
      hash.update(dir).update('\0').update(key);
    }
    for (const input of closure.inputs.filter((path) => !sourceFile(path)))
      hash.update(input).update('\0').update(this.digest(input)).update('\0');
    const pkg = this.graph.package(file);
    const external =
      pkg.externalInputs[relative(pkg.dir === '' ? this.graph.root : join(this.graph.root, pkg.dir), join(this.graph.root, file))];
    return { key: hash.digest('hex'), packages, files, uncertain: external === undefined ? [] : [`declared external input: ${external}`] };
  }
}
