export type ExportKind = 'function' | 'class' | 'const' | 'type' | 'interface' | 'enum' | 'namespace' | 'default';

export type Exported = { readonly name: string; readonly kind: ExportKind; readonly line: number };

export type Binding = { readonly local: string; readonly imported: string };

export type Import = { readonly specifier: string; readonly bindings: readonly Binding[] };

export type Forward = {
  readonly specifier: string;
  readonly names: readonly { readonly imported: string; readonly exported: string }[] | 'all';
};

export type Load = { readonly specifier: string; readonly pattern: boolean };

export type Use = readonly [local: string, member: string, kind: 'v' | 't' | 'm'];

export type ShapeKind = 'object' | 'union' | 'literals';

export type Shape = {
  readonly kind: ShapeKind;
  readonly name: string;
  readonly line: number;
  readonly size: number;
  readonly exported: boolean;
  readonly key: string;
  readonly label: string;
  readonly text?: string;
};

export type Facts = {
  readonly exports: readonly Exported[];
  readonly imports: readonly Import[];
  readonly forwards: readonly Forward[];
  readonly loads: readonly Load[];
  readonly uses: readonly Use[];
  readonly shapes: readonly Shape[];
};

export const EMPTY_FACTS: Facts = { exports: [], imports: [], forwards: [], loads: [], uses: [], shapes: [] };

export const SOURCE = /\.(?:[cm]?[jt]s|[jt]sx|svelte)$/;
