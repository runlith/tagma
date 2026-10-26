import { isThreadFile, THREAD_FILE_MAX_BYTES, type ThreadFileMediaType } from '@runlith/agent/transcript/attachments';
import type { ThreadAttachment } from '@runlith/agent/transcript/entries';

export type ChatDraftFile = {
  id: string;
  filename: string;
  mediaType: ThreadFileMediaType;
  file: File;
  size: number;
};

export const CHAT_DRAFT_PDF_ACCEPT = 'application/pdf,.pdf';

export const CHAT_DRAFT_ATTACH_ACCEPT = `image/*,${CHAT_DRAFT_PDF_ACCEPT}`;

export type ChatDraftFileRejection = { reason: 'too-large'; maxBytes: number } | { reason: 'unreadable' };

const UNTYPED: ReadonlySet<string> = new Set(['', 'application/octet-stream']);

export type StagedChatFiles = {
  added: readonly ChatDraftFile[];
  rejection?: ChatDraftFileRejection;
};

export function draftFileMediaType(file: File): ThreadFileMediaType | null {
  if (isThreadFile(file.type)) return file.type;
  return UNTYPED.has(file.type) && /\.pdf$/i.test(file.name) ? 'application/pdf' : null;
}

export async function stageDraftFiles(current: readonly ChatDraftFile[], files: readonly File[]): Promise<StagedChatFiles> {
  const added: ChatDraftFile[] = [];
  let rejection: ChatDraftFileRejection | undefined;
  for (const file of files) {
    const mediaType = draftFileMediaType(file);
    if (mediaType === null) continue;
    if (file.size > THREAD_FILE_MAX_BYTES) {
      rejection = { reason: 'too-large', maxBytes: THREAD_FILE_MAX_BYTES };
      continue;
    }
    const filename = distinctName(file.name.trim() || 'document.pdf', [...current, ...added]);
    const copy = await copied(file, filename, mediaType);
    if (copy === null) {
      rejection = { reason: 'unreadable' };
      continue;
    }
    const id = `draft-file-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    added.push(chatDraftFile(id, filename, mediaType, copy));
  }
  return { added, rejection };
}

export function chatDraftFile(id: string, filename: string, mediaType: ThreadFileMediaType, file: File): ChatDraftFile {
  return { id, filename, mediaType, file, size: file.size };
}

export function chatDraftFileAttachment(file: ChatDraftFile): ThreadAttachment {
  return { mime: file.mediaType, url: '', filename: file.filename };
}

async function copied(file: File, filename: string, mediaType: ThreadFileMediaType): Promise<File | null> {
  try {
    return new File([await file.arrayBuffer()], filename, { type: mediaType, lastModified: file.lastModified });
  } catch {
    return null;
  }
}

function distinctName(name: string, staged: readonly ChatDraftFile[]): string {
  const taken = new Set(staged.map((file) => file.filename));
  if (!taken.has(name)) return name;
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : '';
  let index = 2;
  while (taken.has(`${stem}-${index}${extension}`)) index += 1;
  return `${stem}-${index}${extension}`;
}
