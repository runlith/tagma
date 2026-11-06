import { realpathSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { BunPlugin } from 'bun';
import type { CompileOptions, ModuleCompileOptions } from 'svelte/compiler';
import type { ViewGraph } from './points.generated.js';

export type SvelteCompiler = Pick<typeof import('svelte/compiler'), 'compile' | 'compileModule' | 'VERSION'>;

export type ViewFailure = { readonly file: string; readonly message: string };

export type CompiledCache = { get(key: string): string | undefined; set(key: string, code: string): void };

export type SvelteFilesInput = {
  readonly compiler: SvelteCompiler;
  readonly graphPath: (absolute: string) => string;
  readonly component: (graphPath: string) => CompileOptions;
  readonly module: (graphPath: string) => ModuleCompileOptions;
  readonly cache?: CompiledCache;
  readonly failed: (failure: ViewFailure) => void;
};

export type GraphFilesInput = {
  readonly root: string;
  readonly graph: ViewGraph;
  readonly hosts: ReadonlySet<string>;
};

const COMPONENT = /\.svelte$/u;

const MODULE = /\.svelte\.(?:ts|js)$/u;

const TYPESCRIPT = /\.ts$/u;

type Located = { readonly message: string; readonly start?: { readonly line: number; readonly column: number } | null };

export const messageOf = (error: unknown): string => {
  const { message, start } = error as Located;
  if (typeof message !== 'string') return String(error);
  return start === undefined || start === null ? message : `${message} (${start.line}:${start.column + 1})`;
};

const digest = (...parts: readonly string[]): string => {
  const hash = new Bun.CryptoHasher('sha256');
  for (const part of parts) hash.update(`${part.length}\0${part}`);
  return hash.digest('hex');
};

export const svelteFiles = ({ compiler, graphPath, component, module, cache, failed }: SvelteFilesInput): BunPlugin => {
  const transpiler = new Bun.Transpiler({ loader: 'ts' });
  const load = async (path: string, compile: (source: string, graph: string) => string): Promise<{ contents: string; loader: 'js' }> => {
    const graph = graphPath(path);
    const source = await Bun.file(path).text();
    const key = digest(graph, source, compiler.VERSION);
    const held = cache?.get(key);
    if (held !== undefined) return { contents: held, loader: 'js' };
    try {
      const code = compile(source, graph);
      cache?.set(key, code);
      return { contents: code, loader: 'js' };
    } catch (error) {
      failed({ file: graph, message: messageOf(error) });
      throw error;
    }
  };
  return {
    name: 'tagma-svelte',
    setup: (build) => {
      build.onLoad({ filter: COMPONENT }, ({ path }) => load(path, (source, graph) => compiler.compile(source, component(graph)).js.code));
      build.onLoad({ filter: MODULE }, ({ path }) =>
        load(
          path,
          (source, graph) =>
            compiler.compileModule(TYPESCRIPT.test(path) ? transpiler.transformSync(source) : source, module(graph)).js.code,
        ),
      );
    },
  };
};

export const graphFiles = ({ root, graph, hosts }: GraphFilesInput): BunPlugin => ({
  name: 'tagma-graph',
  setup: (build) => {
    const real = realpathSync(root);
    build.onResolve({ filter: /.*/u }, ({ path, importer }) => {
      if (importer === undefined || importer === '') return undefined;
      if (hosts.has(path)) return { path, external: true };
      const from = relative(importer.startsWith(`${root}${sep}`) ? root : real, importer).replaceAll('\\', '/');
      const imports = Object.hasOwn(graph.files, from) ? graph.files[from]!.imports : {};
      const resolved = Object.hasOwn(imports, path) ? imports[path] : undefined;
      if (resolved === undefined) throw new Error(`${importer} imports ${path}, which graph.json does not resolve`);
      return resolved === 'host' ? { path, external: true } : { path: join(root, resolved) };
    });
  },
});
