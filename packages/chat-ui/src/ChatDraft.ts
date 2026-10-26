import type { Effect } from 'effect';
import type { ThreadAttachment } from '@runlith/agent/transcript/entries';
import type { ThreadAttachmentRef } from '@runlith/agent/transcript/attachments';
import type { ChatNotice } from './notice';

export type ChatTurnOpening = {
  text: string;
  previews?: readonly ThreadAttachment[];
};

export type ChatTakenWords = {
  readonly text: string;
  readonly attachments: readonly ThreadAttachment[];
};

export type ChatComposedTurn =
  | { status: 'composed'; attachments?: readonly ThreadAttachmentRef[] }
  | { status: 'failed'; notice: ChatNotice };

export interface ChatDraft<TDraft> {
  readonly key: string;
  readonly current: TDraft;
  clear(): void;
  setText(value: string): void;

  filled(draft: TDraft): boolean;
  attached(draft: TDraft): boolean;
  textOf(draft: TDraft): string;
  clone(draft: TDraft): TDraft;

  opening(draft: TDraft): ChatTurnOpening;

  compose(threadId: string, draft: TDraft): Effect.Effect<ChatComposedTurn>;

  accepted(threadId: string, draft: TDraft): Effect.Effect<ChatNotice | null>;

  handBack(key: string, draft: TDraft): void;

  takeBack(key: string, words: readonly ChatTakenWords[]): Effect.Effect<ChatNotice | null>;

  setAside(inputId: string, draft: TDraft): void;
}
