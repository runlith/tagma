import type { Snippet } from 'svelte';
import type { ChatContextAttribution, ChatContextSource, ChatContextUsageMetrics } from './contextUsage';
import type { ChatAttachment } from './entries';
import type { DiffHighlight } from './entries/diffPieces';
import type { Attachment } from 'svelte/attachments';
import type { ChatButton, ChatCodeBody, ChatEntryContext, ChatKey, ChatMarkdownBody, ChatTip } from './renderers';
import type { ChatRewind } from './rewind';

export type ChatInterlude = {
  readonly id: string;
  readonly after: () => string | null;
  readonly body: Snippet<[ChatEntryContext]>;
};

export type ChatHero = {
  readonly id: string;
  readonly body: Snippet;
};

export interface ChatRegions {
  readonly interludes: readonly ChatInterlude[];
  readonly pins: readonly ChatPin[];
  readonly heroes: readonly ChatHero[];
}

export type ChatLink =
  | { readonly kind: 'file'; readonly path: string; readonly line?: number | undefined }
  | { readonly kind: 'thread'; readonly threadId: string; readonly projectId?: number | undefined };

export type ChatNavigation = {
  readonly keyboard: boolean;
  readonly files: boolean;
  link(target: ChatLink): Attachment<HTMLElement>;
  linkMenu(target: ChatLink, at: { readonly x: number; readonly y: number }): void;
  imageMenu?(image: ChatAttachment, at: { readonly x: number; readonly y: number }, layer: HTMLElement | null): void;
  entryAddress(entryId: string): string | null;
};

export type ChatSurfaceContext = {
  readonly labels: (source: ChatContextSource) => { readonly provider: string; readonly model: string } | null;
  readonly attribution: () => ChatContextAttribution | undefined;
  readonly warm: () => boolean;
  readonly detail: Snippet<[ChatContextUsageMetrics]>;
};

export type ChatSurfaceRendering = {
  readonly context?: ChatSurfaceContext;
  readonly regions: ChatRegions;
  readonly markdown: Snippet<[ChatMarkdownBody]>;
  readonly code: Snippet<[ChatCodeBody]>;
  readonly button: Snippet<[ChatButton]>;
  readonly key: Snippet<[ChatKey]>;
  readonly tip: (tip: () => ChatTip) => Attachment<HTMLElement>;
  readonly userText?: Snippet<[string]>;
  readonly lineText?: Snippet<[string]>;
  readonly threadName?: (threadId: string, projectId?: number) => string | null;
  readonly copyText: (text: string) => Promise<boolean>;
  readonly copyImage: (image: ChatAttachment) => Promise<boolean>;
  readonly saveImage: (image: ChatAttachment) => Promise<void>;
  readonly highlight?: DiffHighlight;
  readonly rewind?: ChatRewind;
  readonly touch: boolean;
  readonly layered?: (surface: Element) => boolean;
};

export type ChatPinBounds = {
  readonly maxHeight: number | null;
};

export type ChatPin = {
  readonly id: string;
  readonly body: Snippet<[ChatEntryContext, ChatPinBounds]>;
};

export type ChatVerbosePreference = {
  read(): boolean;
  write(value: boolean): void;
};

export type ChatStretchDefault = 'newest' | 'all';

export type ChatStretchPreference = {
  read(): ChatStretchDefault;
  write(value: ChatStretchDefault): void;
};

export type ChatDisclosurePreference = {
  read(): Record<string, Record<string, boolean>>;
  write(threads: Record<string, Record<string, boolean>>): void;
};

export type ChatPreferences = {
  readonly verbose: ChatVerbosePreference;
  readonly stretches: ChatStretchPreference;
  readonly disclosure: ChatDisclosurePreference;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function chatDisclosureOf(stored: unknown): Record<string, Record<string, boolean>> {
  if (!isRecord(stored)) return {};
  for (const rows of Object.values(stored)) {
    if (!isRecord(rows) || Object.values(rows).some((open) => typeof open !== 'boolean')) return {};
  }
  return stored as Record<string, Record<string, boolean>>;
}
