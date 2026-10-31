import type { Snippet } from 'svelte';
import { coreKind, makeThreadEntryReader, type ThreadEntryKind, type ThreadEntryReader } from '@runlith/agent/transcript/kinds';
import type { ActivityEntry, ChatStepFact } from './activity';
import type { ChatEntry, ChatEntryKind, ProductEntry, ProductId } from './entries';
import type { ChatActivityIdentity, ChatEntryContext, ChatEntryOf, ChatMessageMetaExtra, ChatToolStatus } from './renderers';
import type { RowSizing } from './rowEstimate';
import { TOOL_VIEW_ROW_PX, UNDERIVED_PX } from './rowEstimate';
import { clashOf } from '@runlith/roster/RegistryClash';

export type EntryRenderer<E extends ChatEntry = ChatEntry> = Snippet<[E, ChatEntryContext]>;

export type ProductTraits = {
  readonly verboseOnly?: true;
  readonly hidden?: true;
};

export type EntryTraits = ProductTraits & {
  readonly meta?: true;
  readonly rail?: true;
};

type Behaviour<E extends ChatEntry, T extends ProductTraits> = {
  readonly classify?: (entry: E) => T;
  readonly estimate?: (entry: E, view: RowSizing) => number;
  readonly render?: EntryRenderer<E>;
  readonly keepAlive?: true;
  readonly identity?: (entry: E) => ChatActivityIdentity | undefined;
  readonly facts?: (entry: E) => readonly ChatStepFact[];
  readonly messageMeta?: (entry: E) => ChatMessageMetaExtra | null;
};

export type ToolView = EntryRenderer<ChatEntryOf<'tool'>>;

type ToolBehaviour = {
  readonly actions?: Snippet<[ChatEntryOf<'tool'>]>;
  readonly status?: ChatToolStatus;
  readonly view?: (entry: ChatEntryOf<'tool'>) => ToolView | undefined;
};

export type BuiltinKindName = Exclude<ChatEntryKind, 'product'>;

export type BuiltinDefault<K extends BuiltinKindName> = { readonly kind: K } & Behaviour<ChatEntryOf<K>, EntryTraits>;

export type BuiltinKind<K extends BuiltinKindName> = BuiltinDefault<K> & (K extends 'tool' ? ToolBehaviour : unknown);

export type ProductKind<P> = { readonly id: ProductId<P> } & Behaviour<ProductEntry<P>, ProductTraits>;

export type ToolKind = {
  readonly name: string;
  readonly render?: EntryRenderer<ChatEntryOf<'tool'>>;
  readonly renders?: (entry: ChatEntryOf<'tool'>) => boolean;
  readonly view?: ToolView;
  readonly open?: boolean;
  readonly keepAlive?: true;
  readonly modelText?: (output: unknown) => string | null;
};

export function productKind<P>(id: ProductId<P>, rest: Behaviour<ProductEntry<P>, ProductTraits> = {}): ProductKind<P> {
  return { id, ...rest };
}

const NO_TRAITS: EntryTraits = {};

type Stored = Behaviour<ChatEntry, EntryTraits> & ToolBehaviour;

type Facet = { readonly contributor: string; readonly value: unknown };

export const NO_FACTS: readonly ChatStepFact[] = Object.freeze([]);

const keyOfEntry = (entry: ChatEntry): string => (entry.kind === 'product' ? `product:${entry.product}` : entry.kind);

export const keyOfKind = (kind: { readonly kind: string } | { readonly id: { readonly product: string } }): string =>
  'id' in kind ? `product:${kind.id.product}` : kind.kind;

export const facetsOf = (kind: object): readonly string[] =>
  Object.entries(kind)
    .filter(([name, value]) => name !== 'kind' && name !== 'id' && value !== undefined)
    .map(([name]) => name);

export type EntryKinds = {
  registerWire(contributor: string, kind: ThreadEntryKind): () => void;
  wire(): ThreadEntryReader;
  register<K extends BuiltinKindName>(contributor: string, kind: BuiltinKind<K>): () => void;
  register<P>(contributor: string, kind: ProductKind<P>): () => void;
  registerDefault<K extends BuiltinKindName>(contributor: string, kind: BuiltinDefault<K>): () => void;
  registerTool(contributor: string, tool: ToolKind): () => void;
  tool(name: string): ToolKind | undefined;
  stamp(): number;
  classify(entry: ChatEntry): EntryTraits;
  isMeta(entry: ChatEntry): entry is ActivityEntry;
  isRail(entry: ChatEntry): entry is ActivityEntry;
  estimate(entry: ChatEntry, view: RowSizing): number;
  renderer(entry: ChatEntry): EntryRenderer | undefined;
  toolRenders(entry: ChatEntryOf<'tool'>): boolean;
  toolOpen(name: string): boolean | undefined;
  toolModelText(name: string, output: unknown): string | null;
  keepsAlive(entry: ChatEntry): boolean;
  identity(entry: ChatEntry): ChatActivityIdentity | undefined;
  facts(entry: ChatEntry): readonly ChatStepFact[];
  messageMeta(entry: ChatEntry): ChatMessageMetaExtra | null;
  toolActions(entry: ChatEntryOf<'tool'>): Snippet<[ChatEntryOf<'tool'>]> | undefined;
  toolStatus(entry: ChatEntryOf<'tool'>): ChatToolStatus | undefined;
  toolView(entry: ChatEntryOf<'tool'>): ToolView | undefined;
};

export function createEntryKinds(): EntryKinds {
  let revision = $state(0);
  let bumps = 0;
  const wireKinds = new Map<string, { readonly contributor: string; readonly kind: ThreadEntryKind }>();
  let wire: ThreadEntryReader | null = null;
  const held = new Map<string, Map<string, Facet>>();
  const defaults = new Map<string, Map<string, Facet>>();
  const tools = new Map<string, { readonly contributor: string; readonly tool: ToolKind }>();

  const bump = (): void => {
    revision = ++bumps;
  };

  const add = (into: Map<string, Map<string, Facet>>, contributor: string, key: string, kind: object): (() => void) => {
    const facets = facetsOf(kind).map((name): [string, Facet] => [name, { contributor, value: (kind as Record<string, unknown>)[name] }]);
    const standing = into.get(key);
    for (const [name] of facets) {
      const clash = standing?.get(name);
      if (clash !== undefined) throw clashOf(`Entry kind "${key}" facet "${name}"`, clash.contributor, contributor);
    }
    const target = standing ?? new Map<string, Facet>();
    into.set(key, target);
    for (const [name, facet] of facets) target.set(name, facet);
    bump();
    return () => {
      for (const [name, facet] of facets) if (target.get(name) === facet) target.delete(name);
      if (target.size === 0 && into.get(key) === target) into.delete(key);
      bump();
    };
  };

  const field = <F extends keyof Stored>(entry: ChatEntry, name: F): Stored[F] | undefined => {
    revision;
    const key = keyOfEntry(entry);
    return (held.get(key)?.get(name)?.value ?? defaults.get(key)?.get(name)?.value) as Stored[F] | undefined;
  };

  const tool = (name: string): ToolKind | undefined => {
    revision;
    return tools.get(name)?.tool;
  };

  const taken = (named: ToolKind | undefined, entry: ChatEntryOf<'tool'>): named is ToolKind =>
    named !== undefined && (named.renders?.(entry) ?? true);

  const toolView = (entry: ChatEntryOf<'tool'>): ToolView | undefined => {
    const named = tool(entry.toolName);
    return (taken(named, entry) ? named.view : undefined) ?? field(entry, 'view')?.(entry);
  };

  const toolRender = (entry: ChatEntryOf<'tool'>): EntryRenderer<ChatEntryOf<'tool'>> | undefined => {
    const named = tool(entry.toolName);
    return taken(named, entry) ? named.render : undefined;
  };

  const classify = (entry: ChatEntry): EntryTraits => {
    if (entry.kind === 'tool' && toolView(entry) !== undefined) return NO_TRAITS;
    return field(entry, 'classify')?.(entry) ?? NO_TRAITS;
  };

  return {
    registerWire(contributor, kind) {
      const standing = wireKinds.get(kind.type);
      if (standing !== undefined) throw clashOf(`Wire entry kind "${kind.type}"`, standing.contributor, contributor);
      if (coreKind(kind.type)) throw clashOf(`Wire entry kind "${kind.type}"`, 'agent core', contributor);
      const entry = { contributor, kind };
      wireKinds.set(kind.type, entry);
      wire = null;
      return () => {
        if (wireKinds.get(kind.type) !== entry) return;
        wireKinds.delete(kind.type);
        wire = null;
      };
    },
    wire: () => (wire ??= makeThreadEntryReader({ products: Array.from(wireKinds.values(), (held) => held.kind) })),
    register: (contributor: string, kind: BuiltinKind<BuiltinKindName> | ProductKind<unknown>) =>
      add(held, contributor, keyOfKind(kind), kind),
    registerDefault: <K extends BuiltinKindName>(contributor: string, kind: BuiltinDefault<K>) =>
      add(defaults, contributor, kind.kind, kind),
    registerTool: (contributor, definition) => {
      const standing = tools.get(definition.name);
      if (standing !== undefined) throw clashOf(`Tool "${definition.name}"`, standing.contributor, contributor);
      const entry = { contributor, tool: definition };
      tools.set(definition.name, entry);
      bump();
      return () => {
        if (tools.get(definition.name) !== entry) return;
        tools.delete(definition.name);
        bump();
      };
    },
    tool,
    stamp: () => revision,
    classify,
    isMeta: (entry): entry is ActivityEntry => classify(entry).meta === true,
    isRail: (entry): entry is ActivityEntry => classify(entry).rail === true,
    estimate: (entry, view) => {
      if (entry.kind === 'tool' && toolView(entry) !== undefined) return TOOL_VIEW_ROW_PX;
      return field(entry, 'estimate')?.(entry, view) ?? UNDERIVED_PX;
    },
    renderer(entry) {
      if (entry.kind === 'tool') return (toolRender(entry) as EntryRenderer | undefined) ?? field(entry, 'render');
      return field(entry, 'render');
    },
    toolRenders: (entry) => toolRender(entry) !== undefined,
    toolOpen: (name) => tool(name)?.open,
    toolModelText(name, output) {
      if (output === undefined || output === null) return null;
      return tool(name)?.modelText?.(output) ?? null;
    },
    keepsAlive: (entry) => (entry.kind === 'tool' && tool(entry.toolName)?.keepAlive === true) || field(entry, 'keepAlive') === true,
    identity: (entry) => field(entry, 'identity')?.(entry),
    facts: (entry) => field(entry, 'facts')?.(entry) ?? NO_FACTS,
    messageMeta: (entry) => field(entry, 'messageMeta')?.(entry) ?? null,
    toolActions: (entry) => field(entry, 'actions'),
    toolStatus: (entry) => field(entry, 'status'),
    toolView,
  };
}
