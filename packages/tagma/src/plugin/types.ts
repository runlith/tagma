import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { messageOf } from './bundling.js';
import { BuildFailed } from './failure.js';

const SDK_FILE = fileURLToPath(import.meta.url);

const UI_DOOR = '@runlith/tagma/ui';

const SVELTE = /^svelte(?:\/|$)/u;

const AMBIENT = 'tagma-svelte.d.ts';

const ASSETS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'ico', 'svg', 'woff', 'woff2', 'ttf', 'otf'];

const AMBIENT_TEXT = [
  "declare module '*.svelte' {",
  "  import type { Component } from 'svelte';",
  '  const component: Component<any, any, any>;',
  '  export default component;',
  '}',
  ...ASSETS.map((extension) => `declare module '*.${extension}' { const url: string; export default url; }`),
  '',
].join('\n');

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

type Segment = readonly [column: number, line: number, originalColumn: number];

const decoded = (mappings: string): readonly (readonly Segment[])[] => {
  let source = 0;
  let originalLine = 0;
  let originalColumn = 0;
  return mappings.split(';').map((line) => {
    let column = 0;
    return line === ''
      ? []
      : line.split(',').flatMap((chunk): Segment[] => {
          const values: number[] = [];
          let value = 0;
          let shift = 0;
          for (const char of chunk) {
            const digit = BASE64.indexOf(char);
            value += (digit & 31) << shift;
            if (digit & 32) shift += 5;
            else {
              values.push(value & 1 ? -(value >> 1) : value >> 1);
              value = 0;
              shift = 0;
            }
          }
          column += values[0] ?? 0;
          if (values.length < 4) return [];
          source += values[1]!;
          originalLine += values[2]!;
          originalColumn += values[3]!;
          return [[column, originalLine, originalColumn]];
        });
  });
};

type Mapped = { readonly mappings: readonly (readonly Segment[])[] };

const inside = (directory: string, file: string): boolean => {
  const path = relative(directory, file).split(/[/\\]/u);
  return path[0] !== '..' && !isAbsolute(path.join('/')) && !path.includes('node_modules');
};

const wording = (diagnostic: ts.Diagnostic): string => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');

export const typeCheck = async (directory: string): Promise<void> => {
  const path = join(directory, 'tsconfig.json');
  const read = ts.readConfigFile(path, ts.sys.readFile);
  if (read.error !== undefined) throw new BuildFailed('types', wording(read.error));
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, directory, undefined, path);
  const svelteRoots = ts.sys.readDirectory(directory, ['.svelte'], ['**/node_modules', '**/dist'], ['**/*.svelte']);
  const options: ts.CompilerOptions = {
    ...parsed.options,
    noEmit: true,
    allowNonTsExtensions: true,
    noUncheckedSideEffectImports: false,
  };
  const own: ts.CompilerOptions = { moduleResolution: ts.ModuleResolutionKind.Bundler };
  const ambient = join(directory, AMBIENT);
  const { program, mappings } =
    svelteRoots.length === 0
      ? { program: ts.createProgram({ rootNames: parsed.fileNames, options }), mappings: new Map<string, string>() }
      : (await import('./svelteProgram.js')).svelteProgram({
          options,
          rootNames: [...parsed.fileNames, ...svelteRoots, ambient],
          adapt: (host) => {
            const files = host.getSourceFile.bind(host);
            const exists = host.fileExists.bind(host);
            const read = host.readFile.bind(host);
            host.fileExists = (file) => file === ambient || exists(file);
            host.readFile = (file) => (file === ambient ? AMBIENT_TEXT : read(file));
            host.getSourceFile = (file, language, onError, shouldCreate) =>
              file === ambient
                ? ts.createSourceFile(file, AMBIENT_TEXT, language, true, ts.ScriptKind.TS)
                : files(file, language, onError, shouldCreate);
            host.resolveTypeReferenceDirectiveReferences = (references, containing, redirected, compiler) =>
              references.map((reference) => {
                const name = typeof reference === 'string' ? reference : reference.fileName;
                return name === 'svelte'
                  ? ts.resolveTypeReferenceDirective(name, SDK_FILE, { ...compiler, ...own }, host, redirected)
                  : ts.resolveTypeReferenceDirective(name, containing, compiler, host, redirected);
              });
          },
          resolve: (specifier, containing, compiler, host) => {
            if (specifier === UI_DOOR || SVELTE.test(specifier))
              return ts.resolveModuleName(specifier, SDK_FILE, { ...compiler, ...own }, host);
            if (!specifier.endsWith('.svelte')) return ts.resolveModuleName(specifier, containing, compiler, host);
            const target = specifier.startsWith('.') || isAbsolute(specifier) ? resolve(dirname(containing), specifier) : null;
            if (target !== null && inside(directory, target) && ts.sys.fileExists(target)) return target;
            return target === null ? { resolvedModule: undefined } : ts.resolveModuleName(specifier, containing, compiler, host);
          },
          refuse: (file, error) => {
            if ((error as { readonly name?: unknown }).name !== 'CompileError') throw error;
            throw new BuildFailed('views', `${relative(directory, file)}: ${messageOf(error)}`);
          },
        });
  const maps = new Map<string, Mapped>([...mappings].map(([file, text]) => [file, { mappings: decoded(text) }]));
  const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
  if (diagnostics.length === 0) return;
  const lines = diagnostics.map((diagnostic) => {
    const mapped = diagnostic.file === undefined ? undefined : maps.get(diagnostic.file.fileName);
    if (diagnostic.file === undefined || diagnostic.start === undefined || mapped === undefined)
      return ts
        .formatDiagnostics([diagnostic], {
          getCanonicalFileName: (name) => name,
          getCurrentDirectory: () => directory,
          getNewLine: () => '\n',
        })
        .trimEnd();
    const at = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
    const segment = [...(mapped.mappings[at.line] ?? [])].reverse().find(([column]) => column <= at.character);
    const place = segment === undefined ? '' : `(${segment[1] + 1},${segment[2] + 1})`;
    return `${relative(directory, diagnostic.file.fileName)}${place}: error TS${diagnostic.code}: ${wording(diagnostic)}`;
  });
  throw new BuildFailed('types', lines.join('\n'));
};
