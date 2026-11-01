import { isThreadFile, type ThreadAttachmentRef } from '@runlith/agent/transcript/attachments';
import type { ThreadAttachment } from '@runlith/agent/transcript/entries';
import type { ChatEntryHandlers } from '@runlith/chat-ui/entries';
import type { Door } from '$lib/wire/Door.js';
import type { ThreadsRepo } from '../Repo.js';

export type AttachmentUpload = { status: 'uploaded'; attachment: ThreadAttachmentRef } | { status: 'failed'; message: string };

export const attachmentAddress = (door: Door, url: string, projectId: number): string => door.address(url, { project: String(projectId) });

export const attachmentHandlers = (door: Door, projectId: number): ChatEntryHandlers => ({
  attachmentUrl: (url) => attachmentAddress(door, url, projectId),
  readAttachment: async (url, signal) => (await door.bytes(url, { signal })).text(),
});

export class ThreadUploads {
  constructor(
    private readonly threads: ThreadsRepo,
    private readonly door: Door,
    private readonly projectId: number,
  ) {}

  async upload(sessionId: string, file: File): Promise<AttachmentUpload> {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const attachment = await this.threads.upload.run(
        { id: sessionId, projectId: this.projectId, mediaType: file.type, bytes, name: file.name === '' ? undefined : file.name },
        { throwOnError: true },
      );
      if (!attachment) throw new Error('The upload was cancelled.');
      return { status: 'uploaded', attachment: { id: attachment.id } };
    } catch (error) {
      return { status: 'failed', message: error instanceof Error ? error.message : String(error) };
    }
  }

  attachmentFile(attachment: ThreadAttachment): Promise<File> {
    return attachmentFile(this.door, this.projectId, attachment);
  }
}

export async function attachmentFile(door: Door, projectId: number, attachment: ThreadAttachment): Promise<File> {
  const kept = await door.bytes(attachmentAddress(door, attachment.url, projectId));
  return new File([kept], attachment.filename ?? (isThreadFile(attachment.mime) ? 'document.pdf' : 'image'), { type: attachment.mime });
}
