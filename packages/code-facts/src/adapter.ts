import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { type ImportReads, type ImportSite, type ParsedImport, readOf, UnsupportedLanguage, type UnsupportedSource } from './imports';
import type { Tree } from './tree';

export type Language = {
  readonly id: string;
  readonly extensions: readonly string[];
};

export type Resolution = { readonly to: string } | { readonly unlisted: string };

export type Traced = {
  readonly resolution: Resolution | null;
  readonly absent: readonly string[];
  readonly packages: readonly string[];
  readonly inputs: readonly string[];
  readonly watches?: readonly string[];
};

export type DependencyScope = 'runtime' | 'development';

export type Manifest = {
  readonly name: string;
  readonly dir: string;
  readonly dependency: (name: string) => DependencyScope | undefined;
  readonly entry: (path: string) => boolean;
};

export type Resolver = {
  readonly manifest: string;
  readonly resolve: (specifier: string, from?: string) => Resolution | null;
  readonly traced: (specifier: string, from?: string) => Traced;
  readonly over: (tree: Tree, specifier: string, from?: string) => Resolution | null;
  readonly manifests: () => readonly Manifest[];
  readonly stale?: (inputs: Iterable<string>) => UnsupportedSource | undefined;
};

export type Context = Readonly<Record<string, unknown>>;

export type DeclarationKind = 'class' | 'function' | 'variable' | 'type' | 'interface' | 'enum' | 'namespace';

export type Declaration = { readonly name: string; readonly kind: DeclarationKind; readonly line: number; readonly exported: boolean };

export type Imported = { readonly name: string; readonly line: number; readonly from: string; readonly imported: string };

export type Names = { readonly declarations: readonly Declaration[]; readonly imports: readonly Imported[] };

export type SymbolSpace = 'type' | 'value' | 'namespace';
export type SymbolMeaning = SymbolSpace | 'all';
export type SymbolDefinition = {
  readonly name: string;
  readonly line: number;
  readonly column: number;
  readonly spaces: readonly SymbolSpace[];
};
export type SymbolImport = { readonly from: string; readonly name: string; readonly meaning: SymbolMeaning };
export type SymbolTarget = { readonly definitions: readonly SymbolDefinition[]; readonly imported?: SymbolImport };
export type SymbolReference = SymbolTarget & {
  readonly name: string;
  readonly line: number;
  readonly column: number;
  readonly meaning: SymbolMeaning;
};
export type SymbolExport = SymbolTarget & {
  readonly name: string;
  readonly line: number;
};
export type SymbolForward = { readonly from: string; readonly line: number };
export type SymbolSpelling = { readonly name: string; readonly owner: string; readonly line: number };
export type Symbols = {
  readonly references: readonly SymbolReference[];
  readonly exports: readonly SymbolExport[];
  readonly forwards: readonly SymbolForward[];
  readonly names: readonly SymbolSpelling[];
  readonly uses: readonly string[];
  readonly imports: readonly string[];
};
export type SymbolPlacing = {
  readonly text: string;
  readonly path: string;
  readonly lines?: readonly number[];
  readonly names: readonly string[];
  readonly files: readonly string[];
  readonly tree: Tree;
  readonly capture?: number;
};
export type SymbolReader = {
  readonly read: (text: string, path: string, lines?: readonly number[]) => Symbols;
  readonly place: (input: SymbolPlacing) => readonly string[];
  readonly resolve: (specifier: string, from: string, tree: Tree) => Resolution | null;
};

export type Metrics = { readonly lines: number; readonly importLines: number; readonly size: number; readonly body: string };

export type Adapter = Language & {
  readonly parses: (path: string) => boolean;
  readonly imports: (text: string, path: string) => readonly ImportSite[];
  readonly importsOffThread?: (text: string, path: string) => Promise<readonly ImportSite[]>;
  readonly metrics: (text: string, path: string) => Metrics;
  readonly declarations?: (text: string, path: string) => readonly Declaration[];
  readonly names?: (text: string, path: string) => Names;
  readonly symbols?: () => Promise<SymbolReader>;
  readonly resolve: (specifier: string, from: string, tree: Tree) => Resolution | null;
  readonly resolver?: (tree: Tree, from: string, context: Context) => Resolver | null;
  readonly inputs?: (from: string) => readonly string[];
  readonly input?: (path: string, tree: Tree) => ResolverInput | undefined;
  readonly inputDelta?: (before: ResolverInput, after: ResolverInput) => InputDelta | undefined;
};

export type InputDelta = {
  readonly narrowed: readonly string[];
  readonly refreshed: readonly string[];
};

export type InputBindings = {
  readonly scope: string;
  readonly entries: Readonly<Record<string, string>>;
};

export type ResolverInput =
  | { readonly kind: 'config' }
  | { readonly kind: 'installed'; readonly stamp: string | null }
  | {
      readonly kind: 'manifest';
      readonly dir: string;
      readonly name: string | undefined;
      readonly stamp?: string;
      readonly bindings?: InputBindings;
    };

export type Adapters = readonly Adapter[];

export type Facet<T> = {
  readonly id: string;
  readonly empty: T;
  readonly read: (adapter: Adapter, text: string, path: string) => T;
  readonly withSites?: (adapter: Adapter, text: string, path: string) => { readonly value: T; readonly sites: readonly ImportSite[] };
};

export const METRICS: Facet<Metrics> = {
  id: 'metrics',
  empty: { lines: 0, importLines: 0, size: 0, body: '' },
  read: (adapter, text, path) => adapter.metrics(text, path),
};

export const DECLARATIONS: Facet<readonly Declaration[]> = {
  id: 'declarations',
  empty: [],
  read: (adapter, text, path) => {
    if (adapter.declarations === undefined) throw new UnsupportedLanguage(path, `the ${adapter.id} adapter reads no declarations`);
    return adapter.declarations(text, path);
  },
};

export const NAMES: Facet<Names> = {
  id: 'names',
  empty: { declarations: [], imports: [] },
  read: (adapter, text, path) => {
    if (adapter.names === undefined) throw new UnsupportedLanguage(path, `the ${adapter.id} adapter reads no names`);
    return adapter.names(text, path);
  },
};

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, held]) => held !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries.map(([key, held]) => `${JSON.stringify(key)}:${canonical(held)}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

export const contextDigest = (context: Context): string => createHash('sha256').update(canonical(context)).digest('hex');

export const adapterOf = (adapters: Adapters, path: string): Adapter => {
  const found = adapters.find((adapter) => adapter.parses(path));
  if (found !== undefined) return found;
  const extension = posix.extname(path);
  throw new UnsupportedLanguage(path, `no parser here reads ${extension === '' ? 'a name with no extension' : extension}`);
};

export const parseImports = (adapters: Adapters, text: string, path: string, reads: ImportReads): readonly ParsedImport[] =>
  readOf(adapterOf(adapters, path).imports(text, path), reads);

export const parseFacet = <T>(adapters: Adapters, facet: Facet<T>, text: string, path: string): T =>
  facet.read(adapterOf(adapters, path), text, path);
