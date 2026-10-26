import type { ChatAttachment } from '@runlith/chat-ui/entries';

const EXTENSIONS: Readonly<Record<string, readonly string[]>> = {
  'image/png': ['png'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/gif': ['gif'],
  'image/webp': ['webp'],
  'image/avif': ['avif'],
  'image/bmp': ['bmp'],
  'image/svg+xml': ['svg'],
  'image/heic': ['heic'],
};

export function imageFileName(image: ChatAttachment, served: string): string {
  const mime = (served === '' ? image.mime : served).toLowerCase();
  const known = EXTENSIONS[mime];
  const name = image.filename?.trim() || 'Image';
  if (known === undefined) return name;
  const dot = name.lastIndexOf('.');
  const ending = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  return known.includes(ending) ? name : `${name}.${known[0]}`;
}
