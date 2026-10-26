export const THREAD_ATTACHMENT_SOURCE_MAX_BYTES = 20 * 1024 * 1024;

export const THREAD_IMAGE_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;
export type ThreadImageMediaType = (typeof THREAD_IMAGE_MEDIA_TYPES)[number];

export const THREAD_DOCUMENT_MEDIA_TYPES = ['text/markdown'] as const;
export type ThreadDocumentMediaType = (typeof THREAD_DOCUMENT_MEDIA_TYPES)[number];

export const THREAD_DOCUMENT_MAX_BYTES = 2 * 1024 * 1024;

export const THREAD_FILE_MEDIA_TYPES = ['application/pdf'] as const;
export type ThreadFileMediaType = (typeof THREAD_FILE_MEDIA_TYPES)[number];

export const THREAD_FILE_MAX_BYTES = 64 * 1024 * 1024;

export const THREAD_ATTACHMENT_MEDIA_TYPES = [
  ...THREAD_IMAGE_MEDIA_TYPES,
  ...THREAD_DOCUMENT_MEDIA_TYPES,
  ...THREAD_FILE_MEDIA_TYPES,
] as const;
export type ThreadAttachmentMediaType = (typeof THREAD_ATTACHMENT_MEDIA_TYPES)[number];

export const isThreadDocument = (mediaType: string): mediaType is ThreadDocumentMediaType =>
  THREAD_DOCUMENT_MEDIA_TYPES.some((document) => document === mediaType);

export const isThreadFile = (mediaType: string): mediaType is ThreadFileMediaType =>
  THREAD_FILE_MEDIA_TYPES.some((file) => file === mediaType);

export const isThreadPicture = (mediaType: string): mediaType is ThreadImageMediaType =>
  THREAD_IMAGE_MEDIA_TYPES.some((picture) => picture === mediaType);

const EXTENSIONS: Readonly<Record<ThreadAttachmentMediaType, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'text/markdown': 'md',
  'application/pdf': 'pdf',
};

export const threadAttachmentExtension = (mediaType: ThreadAttachmentMediaType): string => EXTENSIONS[mediaType];

const ATTACHMENT_ID = /^[0-9a-f-]{36}\.(png|jpg|gif|webp|md|pdf)$/;

export const threadAttachmentMediaTypeOfId = (attachmentId: string): ThreadAttachmentMediaType | null => {
  if (!ATTACHMENT_ID.test(attachmentId)) return null;
  const extension = attachmentId.slice(attachmentId.lastIndexOf('.') + 1);
  return THREAD_ATTACHMENT_MEDIA_TYPES.find((candidate) => EXTENSIONS[candidate] === extension) ?? null;
};

export const threadAttachmentIsPicture = (attachmentId: string): boolean => {
  const mediaType = threadAttachmentMediaTypeOfId(attachmentId);
  return mediaType !== null && isThreadPicture(mediaType);
};

export const attachedDocumentText = (text: string): string => `Attached document:\n\n${text}`;

export const keptPictureText = (path: string): string => `[This picture is kept at ${path}]`;

export const missingPictureText = (label: string): string => `[Picture ${label} is no longer stored.]`;

export const attachedFileText = (name: string, path: string): string =>
  `[Attached PDF ${name}, kept at ${path}. Read the file to see its contents.]`;

export const missingFileText = (name: string): string => `[Attached PDF ${name} is no longer stored.]`;

export const threadDocumentTitle = (text: string): string | null => {
  const first = text.split('\n', 1)[0]?.trim() ?? '';
  const title = first.startsWith('# ') ? first.slice(2).trim() : '';
  return title === '' ? null : title;
};

export type ThreadAttachmentRef = {
  id: string;
};
