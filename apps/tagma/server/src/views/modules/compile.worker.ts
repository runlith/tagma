/// <reference types="bun" />
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, extname, join, relative, resolve } from 'node:path';
import { type CompiledCache, graphFiles, svelteFiles, type ViewFailure } from '@runlith/tagma/plugin/bundling';
import { optimize } from '@tailwindcss/node';
import { compile, compileModule, VERSION } from 'svelte/compiler';
import svelte from 'svelte/package.json' with { type: 'json' };
import { compile as compileStyles } from 'tailwindcss';
import { viewCompileOptions, viewModuleOptions } from '../contract/wire/compile.js';
import { hostModules } from '../contract/wire/host.js';
import { stylesheetKey, utilitiesSource } from '../contract/wire/utilities.js';
import { type CompileAnswer, type CompileAsk, type CompiledIndex, INDEX_FILE } from './compile.js';

declare const self: Worker;

const KEPT = 4096;

const held = new Map<string, string>();

const cache: CompiledCache = {
  get: (key) => {
    const code = held.get(key);
    if (code === undefined) return undefined;
    held.delete(key);
    held.set(key, code);
    return code;
  },
  set: (key, code) => {
    held.set(key, code);
    if (held.size > KEPT) held.delete(held.keys().next().value!);
  },
};

const hosts: ReadonlySet<string> = new Set(hostModules(svelte.exports));

const NAMES = { entry: '[name]-[hash].[ext]', chunk: '[name]-[hash].[ext]', asset: '[name]-[hash].[ext]' };

const shortHash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex').slice(0, 10);

const logged = (logs: readonly unknown[]): string => logs.map((log) => String(log)).join('\n') || 'the bundler answered no reason';

const sheet = async (ask: Extract<CompileAsk, { kind: 'sheet' }>): Promise<CompileAnswer> => {
  const { entry, candidates, stylesheets } = ask.utilities;
  const styles = await compileStyles(utilitiesSource(entry), {
    base: '.',
    loadStylesheet: async (id, base) => {
      const recorded = stylesheets[stylesheetKey(id, base)];
      if (recorded === undefined) throw new Error(`the window's styles record no stylesheet ${id} from ${base}`);
      return recorded;
    },
  });
  const { code } = optimize(styles.build([...candidates, ...ask.candidates]), { minify: true });
  const staging = `${ask.out}.${process.pid}-${ask.id}.partial`;
  await mkdir(join(ask.out, '..'), { recursive: true });
  await writeFile(staging, code);
  await rename(staging, ask.out);
  return { id: ask.id, ok: true, kind: 'sheet' };
};

const views = async (ask: Extract<CompileAsk, { kind: 'views' }>): Promise<CompileAnswer> => {
  const staging = `${ask.out}.${process.pid}-${ask.id}.partial`;
  await rm(staging, { recursive: true, force: true });
  const failures: ViewFailure[] = [];
  const result = await Bun.build({
    entrypoints: ask.entries.map((entry) => join(ask.root, entry)),
    outdir: staging,
    target: 'browser',
    format: 'esm',
    splitting: true,
    minify: true,
    sourcemap: 'linked',
    define: { 'process.env.NODE_ENV': '"production"' },
    naming: NAMES,
    publicPath: ask.publicPath,
    metafile: true,
    throw: false,
    plugins: [
      graphFiles({ root: ask.root, graph: ask.graph, hosts }),
      svelteFiles({
        compiler: { compile, compileModule, VERSION },
        graphPath: (absolute) => relative(ask.root, absolute),
        component: (path) => viewCompileOptions(path, ask.graph.files[path]?.dependency === true),
        module: viewModuleOptions,
        cache,
        failed: (found) => {
          failures.push(found);
        },
      }),
    ],
  });
  if (!result.success || result.metafile === undefined) {
    await rm(staging, { recursive: true, force: true });
    const [told] = failures;
    return { id: ask.id, ok: false, file: told?.file ?? null, message: told?.message ?? logged(result.logs) };
  }
  const built = new Map(ask.entries.map((entry) => [resolve(ask.root, entry), entry]));
  const modules: Record<string, string> = {};
  for (const [output, made] of Object.entries(result.metafile.outputs)) {
    const entry = made.entryPoint === undefined ? undefined : built.get(resolve(made.entryPoint));
    if (entry !== undefined) modules[entry] = basename(output);
  }
  const icons: Record<string, string> = {};
  for (const icon of ask.icons) {
    const source = join(ask.root, icon);
    const name = `${basename(icon, extname(icon))}-${shortHash(await readFile(source))}${extname(icon)}`;
    await copyFile(source, join(staging, name));
    icons[icon] = name;
  }
  const index: CompiledIndex = { modules, icons };
  await writeFile(join(staging, INDEX_FILE), JSON.stringify(index));
  await mkdir(join(ask.out, '..'), { recursive: true });
  await rename(staging, ask.out).catch(async () => rm(staging, { recursive: true, force: true }));
  return { id: ask.id, ok: true, kind: 'views', index };
};

let queue: Promise<void> = Promise.resolve();

self.onmessage = (event: MessageEvent<CompileAsk>) => {
  const ask = event.data;
  queue = queue.then(() =>
    (ask.kind === 'views' ? views(ask) : sheet(ask)).then(
      (answer) => self.postMessage(answer),
      (error: unknown) =>
        self.postMessage({
          id: ask.id,
          ok: false,
          file: null,
          message: error instanceof Error ? error.message : String(error),
        } satisfies CompileAnswer),
    ),
  );
};
