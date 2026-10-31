import { Data } from 'effect';
import type { Component, Snippet } from 'svelte';
import type { ComposerContributions } from '@runlith/chat-ui/ComposerContributions.svelte';
import type { ComposerSlashCommand } from '@runlith/chat-ui/composer';
import {
  type BuiltinKind,
  type BuiltinKindName,
  type EntryKinds,
  facetsOf,
  keyOfKind,
  type ProductKind,
  type ToolKind,
} from '@runlith/chat-ui/EntryKinds.svelte';
import type { FeedRegions } from '@runlith/chat-ui/FeedRegions.svelte';
import type { PromptHandle } from '@runlith/chat-ui/PromptHandle.svelte';
import { clashOf } from '@runlith/roster/RegistryClash';
import type { Worktrees } from '$lib/features/worktrees/BoardState.svelte.js';
import type { ThreadBirth } from '../birth/ThreadBirth.svelte.js';
import type { ChatHold } from '../ChatHold.svelte.js';
import type { ThreadDraft } from '../Draft.svelte.js';
import type { ModelPanelState } from '../ModelPanelState.svelte.js';
import type { ShownThread } from '../ShownThread.js';
import type { ThreadViews } from '../thread/ThreadViews.js';
import type { ThreadWrites } from '../ThreadWrites.js';
import type { ComposerFeeds } from './ComposerFeeds.svelte.js';
import type { SkillCatalog } from './SkillCatalog.svelte.js';
import type { RenderingPorts } from './RenderingPorts.svelte.js';
import type { TranscriptReading } from './TranscriptReading.svelte.js';

export class DeclarationMissing extends Data.TaggedError('DeclarationMissing')<{
  readonly message: string;
  readonly file: string;
  readonly name: string;
}> {}

export type SlotSurface = {
  readonly sheets: boolean;
  readonly lead: Snippet | undefined;
  readonly prompt: PromptHandle;
  readonly element: HTMLElement | null;
  readonly visible: boolean;
};

export type SlotOwners = {
  readonly shown: ShownThread;
  readonly chat: ChatHold;
  readonly draft: ThreadDraft;
  readonly feeds: ComposerFeeds;
  readonly skills: SkillCatalog;
  readonly birth: ThreadBirth;
  readonly places: Worktrees;
  readonly panel: ModelPanelState;
  readonly views: ThreadViews;
  readonly writes: ThreadWrites;
};

export type CommandDeclaration = {
  readonly name: string;
  make(owners: SlotOwners): ComposerSlashCommand;
};

export type KindDeclaration = {
  readonly key: string;
  readonly facets: readonly string[];
  register(kinds: EntryKinds, contributor: string): () => void;
};

export function productKindDeclaration<P>(kind: ProductKind<P>): KindDeclaration {
  return { key: keyOfKind(kind), facets: facetsOf(kind), register: (kinds, contributor) => kinds.register(contributor, kind) };
}

export function builtinKindDeclaration<K extends BuiltinKindName>(kind: BuiltinKind<K>): KindDeclaration {
  return { key: keyOfKind(kind), facets: facetsOf(kind), register: (kinds, contributor) => kinds.register(contributor, kind) };
}

export type ComposerPart = SlotOwners & {
  readonly contributor: string;
  readonly composer: ComposerContributions;
  readonly surface: SlotSurface;
  readonly rendering: RenderingPorts;
};

export type FeedPart = SlotOwners & {
  readonly contributor: string;
  readonly kinds: EntryKinds;
  readonly regions: FeedRegions;
  readonly transcript: TranscriptReading;
};

export type Declared<T> = { readonly contributor: string; readonly item: T };

export type Declarations = {
  readonly commands: readonly Declared<CommandDeclaration>[];
  readonly tools: readonly Declared<ToolKind>[];
  readonly kinds: readonly Declared<KindDeclaration>[];
  readonly composer: readonly Declared<Component<ComposerPart>>[];
  readonly feed: readonly Declared<Component<FeedPart>>[];
};

export type DeclaringModules = Readonly<Record<string, Readonly<Record<string, unknown>>>>;

export type DeclarationSources = {
  readonly commands: DeclaringModules;
  readonly tools: DeclaringModules;
  readonly kinds: DeclaringModules;
  readonly composer: DeclaringModules;
  readonly feed: DeclaringModules;
};

export function declaredIn<T>(modules: DeclaringModules, name: string): readonly Declared<T>[] {
  return Object.keys(modules)
    .sort()
    .flatMap((file) => {
      const list = modules[file]![name];
      if (!Array.isArray(list)) {
        throw new DeclarationMissing({ message: `"${file}" does not export the list "${name}".`, file, name });
      }
      return (list as readonly T[]).map((item) => ({ contributor: file, item }));
    });
}

function partsIn<P extends Record<string, unknown>>(modules: DeclaringModules): readonly Declared<Component<P>>[] {
  return Object.keys(modules)
    .sort()
    .map((file) => {
      const part = modules[file]!.default;
      if (typeof part !== 'function') {
        throw new DeclarationMissing({ message: `"${file}" does not export a component as default.`, file, name: 'default' });
      }
      return { contributor: file, item: part as Component<P> };
    });
}

export function distinct<T>(declared: readonly Declared<T>[], subjects: (item: T) => readonly string[]): void {
  const holders = new Map<string, string>();
  for (const { contributor, item } of declared) {
    for (const subject of subjects(item)) {
      const holder = holders.get(subject);
      if (holder !== undefined) throw clashOf(subject, holder, contributor);
      holders.set(subject, contributor);
    }
  }
}

export function declare(sources: DeclarationSources): Declarations {
  const commands = declaredIn<CommandDeclaration>(sources.commands, 'commands');
  const tools = declaredIn<ToolKind>(sources.tools, 'tools');
  const kinds = declaredIn<KindDeclaration>(sources.kinds, 'kinds');
  distinct(commands, (command) => [`Command "${command.name}"`]);
  distinct(tools, (tool) => [`Tool "${tool.name}"`]);
  distinct(kinds, (kind) => kind.facets.map((facet) => `Entry kind "${kind.key}" facet "${facet}"`));
  return {
    commands,
    tools,
    kinds,
    composer: partsIn<ComposerPart>(sources.composer),
    feed: partsIn<FeedPart>(sources.feed),
  };
}
