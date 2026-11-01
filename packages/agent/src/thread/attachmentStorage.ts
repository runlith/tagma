import type { Effect } from 'effect';
import type { ThreadPortFailure } from './ThreadBorder';
import type { Message } from '@runlith/llm/schema/messages';
import type { ThreadAttachmentMediaType, ThreadAttachmentRef } from '../transcript/attachments';

export type StoredThreadAttachment = {
  id: string;
  mediaType: ThreadAttachmentMediaType;
  url: string;
  filename?: string;
  text?: string;
};

export type ThreadKeptImage = {
  readonly mediaType: ThreadAttachmentMediaType;
  readonly bytes: Uint8Array;
  readonly width: number;
  readonly height: number;
};

export interface ThreadAttachmentStorage<TTx> {
  keep(threadId: string, image: ThreadKeptImage): Effect.Effect<StoredThreadAttachment, ThreadPortFailure>;

  resolve(
    threadId: string,
    ownerId: string,
    refs: readonly ThreadAttachmentRef[],
    tx?: TTx,
  ): Effect.Effect<readonly StoredThreadAttachment[], ThreadPortFailure>;

  addressed(threadId: string, refs: readonly ThreadAttachmentRef[]): Effect.Effect<readonly StoredThreadAttachment[], ThreadPortFailure>;

  hydrate(threadId: string, messages: readonly Message[]): Effect.Effect<Message[], ThreadPortFailure>;

  sizes(threadId: string, urls: readonly string[]): Effect.Effect<ReadonlyMap<string, number>, ThreadPortFailure>;
}
