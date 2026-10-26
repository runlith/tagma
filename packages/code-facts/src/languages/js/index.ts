import type { Adapter, Declaration, DeclarationKind, Facet, Metrics, Names, SymbolReader } from '../../adapter';
import { UnsupportedLanguage } from '../../imports';
import { outline, outlineWithSites, topDeclarations } from './declarations';
import { type Embedding, extensionOf, importSites, importSitesOffThread, type Scripts, scriptsWith } from './imports';
import { language } from './language';
import { resolve } from './resolve';
import { usage } from './usage';
import { input, inputDelta, inputs, resolverOf } from './workspace';

export type Shape =
  | { readonly written: 'inline'; readonly members: readonly string[] }
  | { readonly written: 'named'; readonly name: string; readonly qualified: boolean; readonly arguments: number }
  | { readonly written: 'other' };

export type Made = { readonly callee: string; readonly arms: readonly (Made | undefined)[]; readonly pipes: readonly string[] };

export type Query = { readonly of: string; readonly member: string; readonly made?: Made };

export type Union = {
  readonly literals: number;
  readonly references: readonly string[];
  readonly records: number;
  readonly queries: readonly Query[];
  readonly other: number;
};

export type Declared = {
  readonly name: string;
  readonly kind: DeclarationKind;
  readonly line: number;
  readonly extends?: string;
  readonly tag?: string;
  readonly shape?: Shape;
  readonly implements?: readonly string[];
  readonly members?: readonly string[];
  readonly union?: Union;
  readonly generic?: true;
};

export type Binding = { readonly local: string; readonly imported: string; readonly specifier: string; readonly line: number };

export type LiteralPosition = 'compare' | 'argument' | 'property' | 'lookup';

export type TagLiteral = { readonly value: string; readonly line: number; readonly position: LiteralPosition; readonly near: string };

export type Published = { readonly name: string; readonly line: number };

export type Outline = Metrics & {
  readonly exports: readonly Declared[];
  readonly locals: readonly Declared[];
  readonly aliased: readonly Declared[];
  readonly bindings: readonly Binding[];
  readonly literals: readonly TagLiteral[];
  readonly published: readonly Published[];
};

export type PropertyValue =
  | { readonly form: 'call'; readonly callee: string }
  | { readonly form: 'member'; readonly name: string }
  | { readonly form: 'identifier'; readonly name: string }
  | { readonly form: 'undefined' }
  | { readonly form: 'void' }
  | { readonly form: 'other' };

export type CallProperty = {
  readonly key: string;
  readonly value: PropertyValue;
  readonly references: readonly string[];
  readonly calls: readonly CallUse[];
};

export type CallUse = {
  readonly callee: string;
  readonly line: number;
  readonly offset: number;
  readonly kind: 'call' | 'new';
  readonly first?: string;
  readonly firstLiteral?: true;
  readonly keys: readonly string[];
  readonly properties?: readonly CallProperty[];
  readonly secondProperties?: readonly CallProperty[];
  readonly secondSpread?: true;
  readonly owner?: string;
};

export type UsageEntry = {
  readonly key: string;
  readonly line: number;
  readonly keys: readonly string[];
  readonly references: readonly string[];
  readonly calls: readonly CallUse[];
  readonly properties?: readonly CallProperty[];
  readonly spread?: true;
};

export type TopUse = {
  readonly name: string;
  readonly exported: boolean;
  readonly line: number;
  readonly types: readonly string[];
  readonly references: readonly string[];
  readonly calls: readonly CallUse[];
  readonly entries?: readonly UsageEntry[];
};

export type Usage = { readonly calls: readonly CallUse[]; readonly tops: readonly TopUse[] };

export type Js = Adapter & { readonly id: typeof language.id; readonly scripts: Scripts };

const owned = (adapter: Adapter, path: string, what: string): Js => {
  if (adapter.id !== language.id || !('scripts' in adapter))
    throw new UnsupportedLanguage(path, `the ${adapter.id} adapter reads no ${what}`);
  return adapter as Js;
};

export const OUTLINE: Facet<Outline> = {
  id: 'js/outline',
  empty: { lines: 0, importLines: 0, size: 0, body: '', exports: [], locals: [], aliased: [], bindings: [], literals: [], published: [] },
  read: (adapter, text, path) => outline(text, path, owned(adapter, path, 'JavaScript outline').scripts),
  withSites: (adapter, text, path) => outlineWithSites(text, path, owned(adapter, path, 'JavaScript outline').scripts),
};

export const USAGE: Facet<Usage> = {
  id: 'js/usage',
  empty: { calls: [], tops: [] },
  read: (adapter, text, path) => usage(text, path, owned(adapter, path, 'JavaScript usage').scripts),
};

export function jsOf(embeddings: readonly Embedding[]): Js {
  const scripts = scriptsWith(embeddings);
  const extensions = [...language.extensions, ...embeddings.flatMap((embedding) => embedding.extensions)];
  const known = new Set(extensions);
  const metrics = (text: string, path: string): Metrics => {
    const { lines, importLines, size, body } = outline(text, path, scripts);
    return { lines, importLines, size, body };
  };
  const names = (text: string, path: string): Names => {
    const read = topDeclarations(text, path, scripts);
    return {
      declarations: [
        ...read.exports.map(({ name, kind, line }) => ({ name, kind, line, exported: true })),
        ...[...read.locals, ...read.aliased].map(({ name, kind, line }) => ({ name, kind, line, exported: false })),
      ],
      imports: read.bindings.map(({ local, line, specifier, imported }) => ({ name: local, line, from: specifier, imported })),
    };
  };
  const declarations = (text: string, path: string): readonly Declaration[] => names(text, path).declarations;
  let symbols: Promise<SymbolReader> | undefined;
  return {
    id: language.id,
    extensions,
    scripts,
    parses: (path) => known.has(extensionOf(path)),
    imports: (text, path) => importSites(text, path, scripts),
    importsOffThread: (text, path) => importSitesOffThread(text, path, scripts),
    metrics,
    declarations,
    names,
    symbols: () => (symbols ??= import('./symbols').then(({ symbolReader }) => symbolReader(scripts))),
    resolve,
    resolver: resolverOf,
    inputs,
    input,
    inputDelta,
  };
}
