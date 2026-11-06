import type { CompileOptions, ModuleCompileOptions } from 'svelte/compiler';

const COMPILE_FORMAT = 1;

const SHARED = { experimental: { async: false } } as const satisfies CompileOptions;

const runesOf = (dependency: boolean): true | undefined => (dependency ? undefined : true);

export const windowCompileOptions = {
  ...SHARED,
  runes: ({ filename }: { readonly filename: string }) => runesOf(filename.split(/[/\\]/u).includes('node_modules')),
};

export const viewCompileOptions = (path: string, dependency: boolean): CompileOptions => ({
  ...SHARED,
  filename: path,
  runes: runesOf(dependency),
  generate: 'client',
  dev: false,
  css: 'injected',
});

export const viewModuleOptions = (path: string): ModuleCompileOptions => ({ filename: path, generate: 'client', dev: false });

export const compileSignature = (): string =>
  JSON.stringify({ format: COMPILE_FORMAT, shared: SHARED, generate: 'client', css: 'injected' });
