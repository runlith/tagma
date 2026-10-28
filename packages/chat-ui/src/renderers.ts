import { getContext, setContext } from 'svelte';
import type { Component, Snippet } from 'svelte';
import type { Attachment } from 'svelte/attachments';
import type { DiffHighlight } from './entries/diffPieces';
import type { EntryKinds } from './EntryKinds.svelte';
import type { ChatAttachment, ChatEntry, ChatEntryKind } from './entries';
import type { ChatRewind } from './rewind';
import type { ChatNavigation, ChatRegions } from './surface';

export type ChatEntryOf<K extends ChatEntryKind> = Extract<ChatEntry, { kind: K }>;

export type ChatEntryContext = {
  readonly verbose: boolean;
  readonly revision: number;
  expanded(key: string, fallback?: boolean): boolean;
  setExpanded(key: string, value: boolean): void;
  stretchDefault(key: string, newest: boolean): boolean;
  hold(key: string): void;
  release(key: string): void;
  readonly held: readonly string[];
  copied(key: string): boolean;
  copy(key: string, text: string): void;
  copyImage(key: string, image: ChatAttachment): void;
  saveImage(image: ChatAttachment): void;
  readyAnswerPick(entryId: string): number | undefined;
  openImage(image: ChatAttachment): void;
  readAttachment?(url: string, signal: AbortSignal): Promise<string>;
};

export type ChatTextSize = 'body' | 'ui' | 'small';

export type ChatMarkdownBody = {
  text: string;
  cacheKey: string;
  streaming?: boolean;
  size?: ChatTextSize;
  class?: string;
};

export type ChatCodeBody = {
  text: string;
  cacheKey: string;
  language?: string;
  firstLine?: number;
};

export type ChatControl = 'attach' | 'submit' | 'stop' | 'confirm' | 'cancel' | 'mode';

export type ChatButtonChoice = {
  readonly label: string;
  readonly icon: Component<{ class?: string }>;
  readonly key?: string;
  onSelect(): void;
};

export type ChatChord = { readonly code: string; readonly mod?: boolean; readonly alt?: boolean; readonly shift?: boolean };

export type ChatKey = ChatChord & { readonly size: 'sm' | 'md' };

export type ChatKeyHint = { readonly keys: string; readonly words: string };

export type ChatTip = { readonly text: string; readonly chord?: ChatChord };

export type ChatButton = {
  control: ChatControl;
  destructive?: boolean;
  quiet?: boolean;
  type: 'button' | 'submit';
  disabled?: boolean;
  label: string;
  title?: string;
  hints?: readonly ChatKeyHint[];
  onclick?(): void;
  icon?: Snippet;
  leading?: Snippet;
  choices?: readonly ChatButtonChoice[];
  choicesLabel?: string;
  choiceFocus?(): HTMLElement | null;
};

export type ChatToolStatusHold = 'status' | 'marked';

export type ChatToolStatus = {
  readonly held: (entry: ChatEntryOf<'tool'>) => ChatToolStatusHold | null;
  readonly dot?: (entry: ChatEntryOf<'tool'>) => string | null;
  readonly mark: Snippet<[ChatEntryOf<'tool'>]>;
  readonly status: Snippet<[ChatEntryOf<'tool'>]>;
  readonly detail: Snippet<[ChatEntryOf<'tool'>]>;
};

export type ChatActivityIdentity = {
  title?: string;
  threads: readonly { id: string; title: string; projectId?: number }[];
};

export type ChatRendering = {
  readonly kinds: EntryKinds;
  readonly regions: ChatRegions;
  readonly context: ChatEntryContext;
  readonly markdown: Snippet<[ChatMarkdownBody]>;
  readonly code: Snippet<[ChatCodeBody]>;
  readonly highlight?: DiffHighlight;
  readonly button: Snippet<[ChatButton]>;
  readonly key: Snippet<[ChatKey]>;
  readonly tip: (tip: () => ChatTip) => Attachment<HTMLElement>;
  readonly userText?: Snippet<[string]>;
  readonly lineText?: Snippet<[string]>;
  readonly threadName?: (threadId: string, projectId?: number) => string | null;
  readonly navigation: ChatNavigation;
  readonly loadEntry: (entryId: string) => void;
  readonly forgetTurn: (turnKey: string) => void;
  readonly resendTurn: (turnKey: string) => void;
  readonly rewind?: ChatRewind;
  readonly opensRun: (entryId: string) => boolean;
  readonly touch: boolean;
};

export type ChatMessageMetaExtra = {
  text: string;
  rows?: readonly { label: string; value: string }[];
};

export function chatToolStanding(entry: ChatEntry): boolean {
  if (entry.kind !== 'tool') return false;
  const reference = entry.display?.reference;
  return reference?.kind === 'command' && reference.standing;
}

const CONTEXT = Symbol.for('runlith.chat-ui.rendering');

export function provideChatRendering(rendering: ChatRendering): void {
  setContext(CONTEXT, rendering);
}

export function useChatRendering(): ChatRendering {
  const rendering = getContext<ChatRendering | undefined>(CONTEXT);
  if (!rendering) throw new Error('Chat rendering context is not available.');
  return rendering;
}
