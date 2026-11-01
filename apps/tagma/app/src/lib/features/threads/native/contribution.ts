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
import { Point } from '@runlith/layer/Point';
import type { Shown } from '@runlith/layer/svelte/payload';
import type { Gated } from '$lib/wire/access.js';
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

export interface ComposerPartDeclaration extends Shown<ComposerPart>, Gated<Shown<ComposerPart>['payload']> {
  readonly id: string;
}

export interface FeedPartDeclaration extends Shown<FeedPart>, Gated<Shown<FeedPart>['payload']> {
  readonly id: string;
}

export const ThreadCommands = Point.define<CommandDeclaration>()('ThreadCommands', { tier: 'app', key: (command) => command.name });

export const ThreadTools = Point.define<ToolKind>()('ThreadTools', { tier: 'app', key: (tool) => tool.name });

export const ThreadKinds = Point.define<KindDeclaration>()('ThreadKinds', {
  tier: 'app',
  key: (kind) => `${kind.key}:${kind.facets.join(',')}`,
  claims: (kind) => kind.facets.map((facet) => `Entry kind "${kind.key}" facet "${facet}"`),
});

export const ComposerParts = Point.define<ComposerPartDeclaration>()('ComposerParts', { tier: 'app', key: (part) => part.id });

export const FeedParts = Point.define<FeedPartDeclaration>()('FeedParts', { tier: 'app', key: (part) => part.id });
