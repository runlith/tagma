import type { CompileOptions, ModuleCompileOptions } from 'svelte/compiler';

const COMPILE_FORMAT = 2;

const SHARED = { experimental: { async: false } } as const satisfies CompileOptions;

const runesOf = (dependency: boolean): true | undefined => (dependency ? undefined : true);

export const windowCompileOptions = {
  ...SHARED,
  runes: ({ filename }: { readonly filename: string }) => runesOf(filename.split(/[/\\]/u).includes('node_modules')),
};

const VIEW_COMPONENT = { ...SHARED, generate: 'client', dev: false, css: 'injected' } as const satisfies CompileOptions;

const VIEW_MODULE = { generate: 'client', dev: false } as const satisfies ModuleCompileOptions;

export const VIEW_BUNDLE = {
  target: 'browser',
  format: 'esm',
  splitting: true,
  minify: true,
  sourcemap: 'linked',
  define: { 'process.env.NODE_ENV': '"production"' },
  naming: { entry: '[name]-[hash].[ext]', chunk: '[name]-[hash].[ext]', asset: '[name]-[hash].[ext]' },
} as const;

export const viewCompileOptions = (path: string, dependency: boolean): CompileOptions => ({
  ...VIEW_COMPONENT,
  filename: path,
  runes: runesOf(dependency),
});

export const viewModuleOptions = (path: string): ModuleCompileOptions => ({ ...VIEW_MODULE, filename: path });

type BuildTools = { readonly svelte: string; readonly bun: string; readonly bundling: string };

export const viewBuildSignature = (tools: BuildTools): string =>
  JSON.stringify({ format: COMPILE_FORMAT, component: VIEW_COMPONENT, module: VIEW_MODULE, bundle: VIEW_BUNDLE, ...tools });
