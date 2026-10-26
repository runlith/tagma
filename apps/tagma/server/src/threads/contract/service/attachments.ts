import { Context, type Effect } from 'effect';
import type { StoredThreadAttachment } from '@runlith/agent/thread/attachmentStorage';
import type { ThreadAttachmentMediaType, ThreadImageMediaType } from '@runlith/agent/transcript/attachments';
import type { HarnessFailure } from './failure.js';

export type AttachmentLocation = {
  readonly mediaType: ThreadAttachmentMediaType;
  readonly path: string;
  readonly name?: string;
};

export class Attachments extends Context.Service<
  Attachments,
  {
    upload(
      threadId: string,
      projectId: number,
      input: { mediaType: ThreadAttachmentMediaType; bytes: Uint8Array; name?: string },
    ): Effect.Effect<StoredThreadAttachment, HarnessFailure>;
    keep(
      threadId: string,
      projectId: number,
      input: { mediaType: ThreadImageMediaType; bytes: Uint8Array },
    ): Effect.Effect<StoredThreadAttachment, HarnessFailure>;
    drop(threadId: string, projectId: number, input: { bytes: Uint8Array; name?: string }): Effect.Effect<string, HarnessFailure>;
    read(
      threadId: string,
      projectId: number,
      attachmentId: string,
    ): Effect.Effect<{ bytes: Uint8Array; mediaType: ThreadAttachmentMediaType; name?: string }, HarnessFailure>;
    locate(threadId: string, projectId: number, attachmentId: string): Effect.Effect<AttachmentLocation | null, HarnessFailure>;
  }
>()('tagma/threads/Attachments') {}
