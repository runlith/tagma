import { fileURLToPath } from 'node:url';
import sveltePackage from 'svelte/package.json' with { type: 'json' };
import { svelte2tsx } from 'svelte2tsx';
import ts from 'typescript';

const SHIMS = ['svelte2tsx/svelte-shims-v4.d.ts', 'svelte2tsx/svelte-jsx-v4.d.ts'];

export type SvelteProgramInput = {
  readonly options: ts.CompilerOptions;
  readonly rootNames: readonly string[];
  readonly resolve: (
    specifier: string,
    containing: string,
    compiler: ts.CompilerOptions,
    host: ts.CompilerHost,
  ) => ts.ResolvedModuleWithFailedLookupLocations | string;
  readonly adapt?: (host: ts.CompilerHost) => void;
  readonly refuse?: (file: string, error: unknown) => never;
};

export type SvelteProgram = {
  readonly program: ts.Program;
  readonly mappings: ReadonlyMap<string, string>;
};

export const svelteProgram = ({ options, rootNames, resolve, adapt, refuse }: SvelteProgramInput): SvelteProgram => {
  const host = ts.createCompilerHost(options);
  adapt?.(host);
  const mappings = new Map<string, string>();
  const sourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (file, language, onError, create) => {
    if (!file.endsWith('.svelte')) return sourceFile(file, language, onError, create);
    const source = ts.sys.readFile(file);
    if (source === undefined) return undefined;
    try {
      const { code, map } = svelte2tsx(source, {
        filename: file,
        isTsFile: /<script[^>]*\blang\s*=\s*["']ts["']/u.test(source),
        mode: 'ts',
        version: sveltePackage.version,
        emitOnTemplateError: false,
      });
      mappings.set(file, (map as unknown as { readonly mappings: string }).mappings);
      return ts.createSourceFile(file, code, language, true, ts.ScriptKind.TSX);
    } catch (error) {
      if (refuse === undefined) throw error;
      return refuse(file, error);
    }
  };
  host.resolveModuleNameLiterals = (literals, containing, _redirected, compiler) =>
    literals.map((literal) => {
      const resolved = resolve(literal.text, containing, compiler, host);
      return typeof resolved === 'string'
        ? { resolvedModule: { resolvedFileName: resolved, extension: ts.Extension.Tsx, isExternalLibraryImport: false } }
        : resolved;
    });
  const shims = SHIMS.map((shim) => fileURLToPath(import.meta.resolve(shim)));
  return { program: ts.createProgram({ rootNames: [...rootNames, ...shims], options, host }), mappings };
};
