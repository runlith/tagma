import { existsSync, readFileSync } from 'node:fs';
import { cp, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { Scanner } from '@tailwindcss/oxide';
import type { BunPlugin } from 'bun';
import sveltePackage from 'svelte/package.json' with { type: 'json' };
import { graphFiles, svelteFiles, type ViewFailure } from './bundling.js';
import { GRAPH_FILE, graphRefusal, hostModules, UI_MODULE, VIEW_GRAPH, viewCompileOptions, viewModuleOptions } from './checks.generated.js';
import { computedImports } from './computed.js';
import { BuildFailed } from './failure.js';
import type { ViewGraph } from './points.generated.js';
import { framesMedia } from './media.js';

const DEPENDENCIES = '_modules';

const isDependency = (path: string): boolean => path.startsWith(`${DEPENDENCIES}/`);

const isSvelteSpecifier = (specifier: string): boolean => specifier === 'svelte' || specifier.startsWith('svelte/');

type ViewsInput = {
  readonly directory: string;
  readonly entries: readonly string[];
  readonly icons: readonly string[];
};

type ViewsBuilt = {
  readonly stage: string;
  readonly graph: ViewGraph;
  readonly read: readonly string[];
  readonly media: ReadonlySet<string>;
};

const CONDITIONS = ['svelte', 'browser', 'production'];

const DEFINES = { 'process.env.NODE_ENV': '"production"' };

const TEXT = new Set(['.svelte', '.ts', '.js', '.mjs', '.cjs', '.mts', '.cts', '.jsx', '.tsx', '.html']);

type Package = { readonly root: string; readonly name: string; readonly version: string };

const posix = (path: string): string => path.split(sep).join('/');

const packages = (): ((file: string) => Package | null) => {
  const held = new Map<string, Package | null>();
  const find = (directory: string): Package | null => {
    if (held.has(directory)) return held.get(directory)!;
    const manifest = join(directory, 'package.json');
    let found: Package | null = null;
    if (existsSync(manifest)) {
      const { name, version } = JSON.parse(readFileSync(manifest, 'utf8')) as { readonly name?: unknown; readonly version?: unknown };
      if (typeof name === 'string') found = { root: directory, name, version: typeof version === 'string' ? version : '0.0.0' };
    }
    if (found === null && dirname(directory) !== directory) found = find(dirname(directory));
    held.set(directory, found);
    return found;
  };
  return (file) => find(dirname(file));
};

const graphPaths = (directory: string): ((absolute: string) => string) => {
  const packageOf = packages();
  return (absolute) => {
    const own = posix(relative(directory, absolute));
    if (own !== '' && !own.startsWith('../') && !own.split('/').includes('node_modules')) return own;
    const owner = packageOf(absolute);
    if (owner === null)
      throw new BuildFailed('views', `${absolute} is outside ${directory} and belongs to no package, so the graph cannot name it`);
    return `${DEPENDENCIES}/${owner.name}@${owner.version}/${posix(relative(owner.root, absolute))}`;
  };
};

const refusals = (hosts: ReadonlySet<string>, graphPath: (absolute: string) => string, refused: string[]): BunPlugin => ({
  name: 'tagma-view-refusals',
  setup: (build) => {
    const refuse = (message: string): never => {
      refused.push(message);
      throw new BuildFailed('views', message);
    };
    build.onResolve({ filter: /.*/u }, ({ path, importer }) => {
      if (hosts.has(path)) return { path, external: true };
      if (isSvelteSpecifier(path))
        return refuse(
          `${graphPath(importer)} imports ${path}, which the window does not serve to a view: a view imports svelte, svelte/store and the other client modules of Svelte only`,
        );
      if (/\.css(?:[?#].*)?$/u.test(path))
        return refuse(
          `${graphPath(importer)} imports ${path}: a view styles itself with Tailwind classes and its components' <style>, so a stylesheet import is not shipped`,
        );
      return undefined;
    });
    build.onLoad({ filter: /\.node$/u }, ({ path }) => refuse(`${graphPath(path)} is a native addon, which a view cannot carry`));
  },
});

const reasonOf = (refused: readonly string[], failures: readonly ViewFailure[], logs: readonly unknown[]): string => {
  const known = [...refused, ...failures.map(({ file, message }) => `${file}: ${message}`)];
  return (known.length > 0 ? known : logs.map(String)).join('\n');
};

const scanned = async (files: ReadonlyMap<string, string>): Promise<readonly string[]> => {
  const content: { content: string; extension: string }[] = [];
  for (const absolute of files.values()) {
    const extension = extname(absolute);
    if (TEXT.has(extension)) content.push({ content: await Bun.file(absolute).text(), extension: extension.slice(1) });
  }
  return [...new Set(new Scanner({ sources: [] }).scanFiles(content))].sort();
};

const reachable = (graph: ViewGraph, entries: readonly string[]): ReadonlySet<string> => {
  const seen = new Set<string>();
  const visit = (path: string): void => {
    if (seen.has(path)) return;
    seen.add(path);
    for (const target of Object.values(graph.files[path]?.imports ?? {})) if (target !== 'host') visit(target);
  };
  for (const entry of entries) visit(entry);
  return seen;
};

const staged = async ({ directory, entries, icons }: ViewsInput, root: string): Promise<Omit<ViewsBuilt, 'stage'>> => {
  const compiler = await import('svelte/compiler');
  const hostList = hostModules(sveltePackage.exports);
  const hosts = new Set(hostList);
  const graphPath = graphPaths(directory);
  const failures: ViewFailure[] = [];
  const refused: string[] = [];
  const built = await Bun.build({
    entrypoints: entries.map((entry) => join(directory, entry)),
    plugins: [
      refusals(hosts, graphPath, refused),
      svelteFiles({
        compiler,
        graphPath,
        component: (path) => viewCompileOptions(path, isDependency(path)),
        module: viewModuleOptions,
        failed: (failure) => failures.push(failure),
      }),
    ],
    conditions: CONDITIONS,
    define: DEFINES,
    target: 'browser',
    format: 'esm',
    splitting: true,
    metafile: true,
    throw: false,
  });
  if (!built.success || built.metafile === undefined) throw new BuildFailed('views', reasonOf(refused, failures, built.logs));
  const locations = new Map<string, string>();
  const files: Record<string, { imports: Record<string, string>; dependency?: true }> = {};
  const base = await realpath(process.cwd());
  for (const [key, input] of Object.entries(built.metafile.inputs)) {
    const absolute = resolve(base, key);
    const own = graphPath(absolute);
    locations.set(own, absolute);
    const imports: Record<string, string> = {};
    for (const imported of input.imports) {
      const specifier = imported.original ?? imported.path;
      if (imported.external === true && imported.entryPoint === undefined) {
        imports[specifier] = 'host';
        if (/\.(?:[cm]?js)$/u.test(absolute) && !/\.svelte\.js$/u.test(absolute) && specifier.startsWith('svelte/internal/'))
          throw new BuildFailed(
            'views',
            `${own} imports ${specifier}, which only Svelte's compiler writes: it is another compiler's output, so ship the component's .svelte source instead`,
          );
        continue;
      }
      if (imported.original === undefined)
        throw new BuildFailed('views', `${own} loads ${imported.path} in a form the graph cannot record: write it as an import of a file`);
      imports[specifier] = graphPath(resolve(base, imported.entryPoint ?? imported.path));
    }
    files[own] = isDependency(own) ? { imports, dependency: true } : { imports };
  }
  const computed = (await Promise.all(built.outputs.filter((output) => output.kind !== 'sourcemap').map((output) => output.text()))).reduce(
    (total, code) => total + computedImports(code),
    0,
  );
  if (computed > 0)
    throw new BuildFailed(
      'views',
      `the views name a module by a computed value in ${computed} import or require ${computed === 1 ? 'call' : 'calls'}, which Tagma cannot bundle: import each module by its literal name`,
    );
  for (const icon of icons) {
    const absolute = join(directory, icon);
    if (!existsSync(absolute)) throw new BuildFailed('views', `the icon ${icon} is no file of the plugin`);
    locations.set(icon, absolute);
    files[icon] ??= { imports: {} };
  }
  for (const entry of entries)
    if (!Object.hasOwn(files, entry)) throw new BuildFailed('views', `the view entry ${entry} is no file the graph holds`);
  const sorted = Object.fromEntries(Object.entries(files).sort(([left], [right]) => (left < right ? -1 : 1)));
  const graph: ViewGraph = { files: sorted, candidates: await scanned(locations) };
  const refusal = graphRefusal(graph);
  if (refusal !== null) throw new BuildFailed('check', `${VIEW_GRAPH}/${GRAPH_FILE}: ${refusal}`);
  for (const [path, absolute] of locations) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await Bun.write(join(root, path), Bun.file(absolute));
  }
  await writeFile(join(root, GRAPH_FILE), `${JSON.stringify(graph, null, 2)}\n`);
  const again = await Bun.build({
    entrypoints: entries.map((entry) => join(root, entry)),
    plugins: [
      graphFiles({ root, graph, hosts }),
      svelteFiles({
        compiler,
        graphPath: (absolute) => posix(relative(root, absolute)),
        component: (path) => viewCompileOptions(path, graph.files[path]?.dependency === true),
        module: viewModuleOptions,
        failed: (failure) => failures.push(failure),
      }),
    ],
    define: DEFINES,
    target: 'browser',
    format: 'esm',
    splitting: true,
    minify: true,
    throw: false,
  });
  if (!again.success)
    throw new BuildFailed(
      'views',
      `the shipped graph does not bundle on its own, so Tagma could not build the views from it:\n${reasonOf([], failures, again.logs)}`,
    );
  const own = (path: string): boolean => !isDependency(path);
  const media = new Set<string>();
  for (const entry of entries) {
    const framing = [...reachable(graph, [entry])].filter((path) => own(path) && path.endsWith('.svelte'));
    for (const path of framing) {
      if (framesMedia(compiler.parse, readFileSync(join(root, path), 'utf8'), UI_MODULE)) {
        media.add(entry);
        break;
      }
    }
  }
  const read = [...locations].flatMap(([path, absolute]) => (own(path) ? [absolute] : []));
  return { graph, read, media };
};

export const buildViews = async (input: ViewsInput): Promise<ViewsBuilt> => {
  const stage = await realpath(await mkdtemp(join(tmpdir(), 'tagma-views-')));
  try {
    return { ...(await staged(input, stage)), stage };
  } catch (error) {
    await rm(stage, { recursive: true, force: true });
    throw error;
  }
};

export const publishViews = async (built: ViewsBuilt | null, directory: string): Promise<void> => {
  const root = join(directory, VIEW_GRAPH);
  await rm(root, { recursive: true, force: true });
  if (built === null) return;
  await cp(built.stage, root, { recursive: true });
  await rm(built.stage, { recursive: true, force: true });
};
