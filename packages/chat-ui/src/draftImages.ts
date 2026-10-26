import {
  THREAD_IMAGE_MEDIA_TYPES,
  THREAD_ATTACHMENT_SOURCE_MAX_BYTES,
  type ThreadImageMediaType,
} from '@runlith/agent/transcript/attachments';
import type { ThreadAttachment } from '@runlith/agent/transcript/entries';
import { canvasBlob, decodedPicture } from './pictures';

export type ChatDraftImage = {
  id: string;
  filename: string;
  mediaType: ThreadImageMediaType;
  dataUrl: string;
  file: File;
  size: number;
};

export const CHAT_DRAFT_IMAGE_ACCEPT = 'image/*';

export type ChatDraftImageRejection = { reason: 'not-images' } | { reason: 'too-large'; maxBytes: number } | { reason: 'unreadable' };

export type StagedChatImages = {
  added: readonly ChatDraftImage[];
  rejection?: ChatDraftImageRejection;
};

type CarriedImage = { file: File; mediaType: ThreadImageMediaType };

const CANVAS_MAX_PIXELS = 4096 * 4096;
const REDRAW_ATTEMPTS = 3;
const JPEG_QUALITIES = [0.92, 0.85, 0.75, 0.6] as const;
const PHOTO_TYPES: ReadonlySet<string> = new Set(['image/jpeg', 'image/heic', 'image/heif']);

export async function stageDraftImages(current: readonly ChatDraftImage[], files: readonly File[]): Promise<StagedChatImages> {
  const imageFiles = files.filter((file) => file.type.startsWith('image/'));
  if (imageFiles.length === 0) {
    return files.length > 0 ? { added: [], rejection: { reason: 'not-images' } } : { added: [] };
  }

  const added: ChatDraftImage[] = [];
  let rejection: ChatDraftImageRejection | undefined;
  for (const file of imageFiles) {
    const carried = await carriedImage(file);
    if ('reason' in carried) {
      rejection = carried;
      continue;
    }
    try {
      added.push(await draftImage(carried, [...current, ...added]));
    } catch {
      rejection = { reason: 'unreadable' };
    }
  }

  return { added, rejection };
}

export function chatDraftImageAttachment(image: ChatDraftImage): ThreadAttachment {
  return { mime: image.mediaType, url: image.dataUrl, filename: image.filename };
}

export function chatDraftImageMediaType(type: string): ThreadImageMediaType | null {
  return THREAD_IMAGE_MEDIA_TYPES.find((mediaType) => mediaType === type) ?? null;
}

export function chatDraftImageFilename(mediaType: ThreadImageMediaType, index: number): string {
  return `image-${index}.${imageExtension(mediaType)}`;
}

async function carriedImage(file: File): Promise<CarriedImage | ChatDraftImageRejection> {
  const mediaType = chatDraftImageMediaType(file.type);
  if (mediaType && file.size <= THREAD_ATTACHMENT_SOURCE_MAX_BYTES) {
    const copy = await copied(file);
    return copy ? { file: copy, mediaType } : { reason: 'unreadable' };
  }
  const redrawn = await redraw(file);
  if (redrawn) return redrawn;
  return mediaType ? { reason: 'too-large', maxBytes: THREAD_ATTACHMENT_SOURCE_MAX_BYTES } : { reason: 'unreadable' };
}

async function copied(file: File): Promise<File | null> {
  try {
    return new File([await file.arrayBuffer()], file.name, { type: file.type, lastModified: file.lastModified });
  } catch {
    return null;
  }
}

async function redraw(file: File): Promise<CarriedImage | null> {
  const picture = await decodedPicture(file);
  if (!picture) return null;
  const context = document.createElement('canvas').getContext('2d');
  if (!context) return null;
  const { canvas } = context;
  let scale = Math.min(1, Math.sqrt(CANVAS_MAX_PIXELS / (picture.naturalWidth * picture.naturalHeight)));
  for (let attempt = 0; attempt < REDRAW_ATTEMPTS; attempt += 1, scale *= 0.75) {
    canvas.width = Math.max(1, Math.floor(picture.naturalWidth * scale));
    canvas.height = Math.max(1, Math.floor(picture.naturalHeight * scale));
    if (losslessMayFit(file, scale)) {
      context.drawImage(picture, 0, 0, canvas.width, canvas.height);
      const png = await encoded(canvas, 'image/png');
      if (png) return { file: renamed(file, png, 'image/png'), mediaType: 'image/png' };
    }
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(picture, 0, 0, canvas.width, canvas.height);
    for (const quality of JPEG_QUALITIES) {
      const jpeg = await encoded(canvas, 'image/jpeg', quality);
      if (jpeg) return { file: renamed(file, jpeg, 'image/jpeg'), mediaType: 'image/jpeg' };
    }
  }
  return null;
}

function losslessMayFit(file: File, scale: number): boolean {
  if (PHOTO_TYPES.has(file.type)) return false;
  return file.type !== 'image/png' || file.size * scale * scale <= THREAD_ATTACHMENT_SOURCE_MAX_BYTES;
}

async function encoded(canvas: HTMLCanvasElement, type: ThreadImageMediaType, quality?: number): Promise<Blob | null> {
  const blob = await canvasBlob(canvas, type, quality);
  return blob !== null && blob.size <= THREAD_ATTACHMENT_SOURCE_MAX_BYTES ? blob : null;
}

function renamed(source: File, blob: Blob, mediaType: ThreadImageMediaType): File {
  const name = source.name.trim();
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name || 'image';
  return new File([blob], `${stem}.${imageExtension(mediaType)}`, { type: mediaType });
}

export async function chatDraftImage(id: string, filename: string, mediaType: ThreadImageMediaType, file: File): Promise<ChatDraftImage> {
  return { id, filename, mediaType, dataUrl: await readDataUrl(file), file, size: file.size };
}

function draftImage(carried: CarriedImage, staged: readonly ChatDraftImage[]): Promise<ChatDraftImage> {
  const name = carried.file.name.trim() || chatDraftImageFilename(carried.mediaType, staged.length + 1);
  const id = `draft-img-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return chatDraftImage(id, distinctName(name, staged), carried.mediaType, carried.file);
}

function distinctName(name: string, staged: readonly ChatDraftImage[]): string {
  const taken = new Set(staged.map((image) => image.filename));
  if (!taken.has(name)) return name;
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : '';
  let index = 2;
  while (taken.has(`${stem}-${index}${extension}`)) index += 1;
  return `${stem}-${index}${extension}`;
}

function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

function imageExtension(mediaType: ThreadImageMediaType): string {
  switch (mediaType) {
    case 'image/png':
      return 'png';
    case 'image/jpeg':
      return 'jpg';
    case 'image/gif':
      return 'gif';
    case 'image/webp':
      return 'webp';
  }
}
