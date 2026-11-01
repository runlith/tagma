import { readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  attachedDocumentText,
  attachedFileText,
  isThreadDocument,
  isThreadFile,
  keptPictureText,
  missingFileText,
  missingPictureText,
  type ThreadAttachmentMediaType,
  type ThreadAttachmentRef,
  threadAttachmentExtension,
  threadAttachmentMediaTypeOfId,
  threadDocumentTitle,
} from '@runlith/agent/transcript/attachments';
import { Context, Effect, FileSystem, type PlatformError } from 'effect';
import { ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import type { StoredThreadAttachment } from '@runlith/agent/thread/attachmentStorage';
import { Message, type ContentPart, type MediaPart, type ToolResultPart } from '@runlith/llm/schema/messages';
import type { ToolContent } from '@runlith/llm/schema/tool-content';
import { uuidv7 } from 'uuidv7';
import type { Unit } from '../../platform/contract/service/units.js';
import type { AttachmentLocation } from '../contract/service/attachments.js';
import { ThreadAttachmentMissing } from '../contract/service/failure.js';
import type { LayerSources } from '../journal/base.js';

export type AttachmentBytes = { readonly bytes: Uint8Array; readonly mediaType: ThreadAttachmentMediaType; readonly name?: string };

export class AttachmentFiles extends Context.Service<
  AttachmentFiles,
  {
    keep(
      threadId: string,
      kept: { readonly mediaType: ThreadAttachmentMediaType; readonly bytes: Uint8Array; readonly name?: string },
    ): Effect.Effect<StoredThreadAttachment, ThreadStorageFailed>;
    drop(threadId: string, dropped: { readonly bytes: Uint8Array; readonly name?: string }): Effect.Effect<string, ThreadStorageFailed>;
    resolve(
      threadId: string,
      ownerId: string,
      refs: readonly ThreadAttachmentRef[],
      unit?: Unit<'machine'>,
    ): Effect.Effect<readonly StoredThreadAttachment[], ThreadStorageFailed>;
    addressed(
      threadId: string,
      refs: readonly ThreadAttachmentRef[],
    ): Effect.Effect<readonly StoredThreadAttachment[], ThreadStorageFailed>;
    located(threadId: string, attachmentId: string): Effect.Effect<AttachmentLocation | null, ThreadStorageFailed>;
    hydrate(threadId: string, messages: readonly Message[]): Effect.Effect<Message[], ThreadStorageFailed>;
    sizes(threadId: string, urls: readonly string[]): Effect.Effect<ReadonlyMap<string, number>, ThreadStorageFailed>;
    read(threadId: string, attachmentId: string): Effect.Effect<AttachmentBytes, ThreadStorageFailed>;
    copyForThread(sourceThreadId: string, targetThreadId: string): Effect.Effect<void, ThreadStorageFailed>;
    deleteThread(threadId: string): Effect.Effect<void, ThreadStorageFailed>;
  }
>()('tagma/threads/AttachmentFiles') {}

export type ThreadAttachmentStore = AttachmentFiles['Service'];

const failed = (call: string) => (cause: unknown) => new ThreadStorageFailed({ call, cause });

export const makeThreadAttachments = Effect.fnUntraced(function* ({
  root,
  sources = () => Effect.succeed([]),
}: {
  readonly root: string;
  readonly sources?: LayerSources;
}) {
  const files = yield* FileSystem.FileSystem;
  const directory = (threadId: string) =>
    Effect.try({
      try: () => join(root, threadDirectory(threadId)),
      catch: (cause) => (cause instanceof ThreadAttachmentMissing ? cause : new ThreadAttachmentMissing(threadId)),
    });
  const pathOf = Effect.fnUntraced(function* (threadId: string, attachmentId: string, name?: string) {
    const path = yield* directory(threadId);
    return name === undefined ? join(path, attachmentId) : join(path, attachmentId.slice(0, attachmentId.lastIndexOf('.')), name);
  });

  const locateFile = Effect.fn('AttachmentFiles.locateFile')(function* (
    threadId: string,
    attachmentId: string,
  ): Effect.fn.Return<AttachmentLocation | null, PlatformError.PlatformError | ThreadAttachmentMissing> {
    const mediaType = threadAttachmentMediaTypeOfId(attachmentId);
    if (mediaType === null) return null;
    if (!isThreadFile(mediaType)) return { mediaType, path: yield* pathOf(threadId, attachmentId) };
    const folder = dirname(yield* pathOf(threadId, attachmentId, '_'));
    const names = yield* files.readDirectory(folder).pipe(
      Effect.catchReasons('PlatformError', {
        NotFound: () => Effect.succeed([]),
        BadResource: () => Effect.succeed([]),
      }),
    );
    const name = names.length === 1 ? names[0] : undefined;
    return name === undefined ? null : { mediaType, path: join(folder, name), name };
  });

  const held = Effect.fnUntraced(function* (threadId: string, attachmentId: string) {
    const found = yield* locateFile(threadId, attachmentId);
    if (found === null || found.name !== undefined) return found;
    return (yield* files.exists(found.path)) ? found : null;
  });

  const standing = Effect.fn('AttachmentFiles.standing')(function* (threadId: string, attachmentId: string, unit?: Unit<'machine'>) {
    const own = yield* held(threadId, attachmentId);
    if (own !== null) return own;
    for (const source of yield* sources(threadId, unit).pipe(Effect.mapError((cause) => failed('sources')(cause)))) {
      const inherited = yield* held(source, attachmentId);
      if (inherited !== null) return inherited;
    }
    return null;
  });

  const readBytes = Effect.fn('AttachmentFiles.readBytes')(function* (threadId: string, attachmentId: string) {
    const held = (yield* standing(threadId, attachmentId)) ?? (yield* locateFile(threadId, attachmentId));
    if (held === null) return yield* new ThreadAttachmentMissing(attachmentId);
    const bytes = yield* files.readFile(held.path).pipe(
      Effect.catchReasons('PlatformError', {
        NotFound: () => Effect.fail(new ThreadAttachmentMissing(attachmentId)),
        BadResource: () => Effect.fail(new ThreadAttachmentMissing(attachmentId)),
      }),
    );
    return { bytes, mediaType: held.mediaType, name: held.name };
  });

  const origin = Effect.fnUntraced(function* (addressed: AttachmentAddress, threadId: string) {
    const source = addressed.threadId === threadId ? null : yield* standing(addressed.threadId, addressed.id);
    return source ?? (yield* locateFile(threadId, addressed.id));
  });

  const lowered = Effect.fnUntraced(function* (
    threadId: string,
    addressed: AttachmentAddress,
    part: MediaPart,
  ): Effect.fn.Return<ContentPart[], PlatformError.PlatformError | ThreadAttachmentMissing | ThreadStorageFailed> {
    const mediaType = threadAttachmentMediaTypeOfId(addressed.id);
    if (mediaType !== null && isThreadFile(mediaType)) {
      const held = yield* origin(addressed, threadId);
      return [
        {
          type: 'text',
          text: held?.name === undefined ? missingFileText(part.filename ?? addressed.id) : attachedFileText(held.name, held.path),
        },
      ];
    }
    const attachment = yield* readBytes(threadId, addressed.id).pipe(
      Effect.catchTag('ThreadAttachmentMissing', (failure) =>
        mediaType !== null && !isThreadDocument(mediaType) ? Effect.succeed(null) : Effect.fail(failure),
      ),
    );
    if (attachment === null) return [{ type: 'text', text: missingPictureText(part.filename ?? addressed.id) }];
    if (isThreadDocument(attachment.mediaType)) return [{ type: 'text', text: attachedDocumentText(decoder.decode(attachment.bytes)) }];
    const held = yield* origin(addressed, threadId);
    return [
      { ...part, data: attachment.bytes, mediaType: attachment.mediaType },
      ...(held === null ? [] : [{ type: 'text' as const, text: keptPictureText(held.path) }]),
    ];
  });

  const pictures = Effect.fnUntraced(function* (threadId: string, parts: readonly ToolContent[]) {
    const carried: ToolContent[] = [];
    for (const part of parts) {
      const id = part.type === 'file' ? attachmentIdOfUrl(part.uri) : null;
      if (part.type !== 'file' || id === null) {
        carried.push(part);
        continue;
      }
      const attachment = yield* readBytes(threadId, id).pipe(Effect.catchTag('ThreadAttachmentMissing', () => Effect.succeed(null)));
      carried.push(
        attachment === null
          ? { type: 'text', text: missingPictureText(part.name ?? id) }
          : { ...part, uri: `data:${attachment.mediaType};base64,${base64Of(attachment.bytes)}` },
      );
    }
    return carried;
  });

  return AttachmentFiles.of({
    keep: Effect.fn('AttachmentFiles.keep')(
      function* (threadId, kept) {
        const id = `${uuidv7()}.${threadAttachmentExtension(kept.mediaType)}`;
        const name = isThreadFile(kept.mediaType) ? fileName(kept.name) : undefined;
        const path = yield* pathOf(threadId, id, name);
        yield* files.makeDirectory(dirname(path), { recursive: true });
        yield* files.writeFile(path, kept.bytes);
        return stored(threadId, id, kept.mediaType, {
          name,
          text: isThreadDocument(kept.mediaType) ? decoder.decode(kept.bytes) : undefined,
        });
      },
      Effect.mapError(failed('keep')),
    ),
    drop: Effect.fn('AttachmentFiles.drop')(
      function* (threadId, dropped) {
        const path = join(yield* directory(threadId), DROPS, uuidv7(), droppedName(dropped.name));
        yield* files.makeDirectory(dirname(path), { recursive: true });
        yield* files.writeFile(path, dropped.bytes);
        return path;
      },
      Effect.mapError(failed('drop')),
    ),
    resolve: Effect.fn('AttachmentFiles.resolve')(
      function* (threadId, _ownerId, refs, unit) {
        const resolved: StoredThreadAttachment[] = [];
        for (const ref of refs) {
          const held = yield* standing(threadId, ref.id, unit);
          if (held === null) return yield* new ThreadAttachmentMissing(ref.id);
          const text = isThreadDocument(held.mediaType) ? decoder.decode(yield* files.readFile(held.path)) : undefined;
          resolved.push(stored(threadId, ref.id, held.mediaType, { name: held.name, text }));
        }
        return resolved;
      },
      Effect.mapError(failed('resolve')),
    ),
    addressed: Effect.fn('AttachmentFiles.addressed')(
      function* (threadId, refs) {
        const addressed: StoredThreadAttachment[] = [];
        for (const ref of refs) {
          const mediaType = threadAttachmentMediaTypeOfId(ref.id);
          if (mediaType === null) continue;
          const name = isThreadFile(mediaType) ? (yield* locateFile(threadId, ref.id))?.name : undefined;
          addressed.push(stored(threadId, ref.id, mediaType, { name }));
        }
        return addressed;
      },
      Effect.mapError(failed('addressed')),
    ),
    located: (threadId, attachmentId) => Effect.mapError(standing(threadId, attachmentId), failed('located')),
    hydrate: Effect.fn('AttachmentFiles.hydrate')(
      function* (threadId, messages) {
        const hydrated: Message[] = [];
        for (const message of messages) {
          if (message.role === 'user') {
            const content: ContentPart[] = [];
            for (const part of message.content) {
              const addressed = part.type === 'media' && typeof part.data === 'string' ? attachmentAddress(part.data) : null;
              if (part.type !== 'media' || addressed === null) content.push(part);
              else content.push(...(yield* lowered(threadId, addressed, part)));
            }
            hydrated.push(Message.make({ ...message, content }));
            continue;
          }
          if (!message.content.some(heldPictures)) {
            hydrated.push(message);
            continue;
          }
          const content: ContentPart[] = [];
          for (const part of message.content)
            content.push(
              heldPictures(part) ? { ...part, result: { type: 'content', value: yield* pictures(threadId, part.result.value) } } : part,
            );
          hydrated.push(Message.make({ ...message, content }));
        }
        return hydrated;
      },
      Effect.mapError(failed('hydrate')),
    ),
    sizes: Effect.fn('AttachmentFiles.sizes')(
      function* (threadId, urls) {
        const sized = new Map<string, number>();
        for (const url of new Set(urls)) {
          const id = attachmentIdOfUrl(url);
          if (id === null) continue;
          const found = yield* standing(threadId, id);
          if (found === null) continue;
          const held = yield* files.stat(found.path).pipe(Effect.catchReason('PlatformError', 'NotFound', () => Effect.succeed(null)));
          if (held !== null) sized.set(url, Number(held.size));
        }
        return sized;
      },
      Effect.mapError(failed('sizes')),
    ),
    read: (threadId, attachmentId) => Effect.mapError(readBytes(threadId, attachmentId), failed('read')),
    copyForThread: Effect.fn('AttachmentFiles.copyForThread')(
      function* (sourceThreadId, targetThreadId) {
        const source = yield* directory(sourceThreadId);
        const entries = yield* Effect.tryPromise({
          try: () => readdir(source, { withFileTypes: true }),
          catch: failed('copyForThread'),
        }).pipe(
          Effect.catchIf(
            (failure) => absent(failure.cause),
            () => Effect.succeed([]),
          ),
        );
        if (entries.length === 0) return;
        const target = yield* directory(targetThreadId);
        yield* files.makeDirectory(target, { recursive: true });
        for (const entry of entries) {
          if (entry.isFile() && threadAttachmentMediaTypeOfId(entry.name)) {
            yield* files.link(join(source, entry.name), join(target, entry.name));
            continue;
          }
          if (!entry.isDirectory() || !FOLDER.test(entry.name)) continue;
          yield* files.makeDirectory(join(target, entry.name));
          const nested = yield* Effect.tryPromise({
            try: () => readdir(join(source, entry.name), { withFileTypes: true }),
            catch: failed('copyForThread'),
          });
          for (const file of nested)
            if (file.isFile()) yield* files.link(join(source, entry.name, file.name), join(target, entry.name, file.name));
        }
      },
      Effect.mapError((cause) => (cause instanceof ThreadStorageFailed ? cause : failed('copyForThread')(cause))),
    ),
    deleteThread: Effect.fn('AttachmentFiles.deleteThread')(
      function* (threadId) {
        yield* files.remove(yield* directory(threadId), { recursive: true, force: true });
      },
      Effect.mapError(failed('deleteThread')),
    ),
  });
});

const THREAD_ID = /^[0-9a-zA-Z-]{1,64}$/;
const FOLDER = /^[0-9a-f-]{36}$/;
const decoder = new TextDecoder();

function stored(
  threadId: string,
  id: string,
  mediaType: ThreadAttachmentMediaType,
  held: { readonly name?: string; readonly text?: string },
): StoredThreadAttachment {
  const filename = held.name ?? (held.text === undefined ? null : threadDocumentTitle(held.text));
  return { id, mediaType, url: attachmentUrl(threadId, id), filename: filename ?? undefined, text: held.text };
}

const NAME_BYTES = 200;
const UNSAFE = /[\u0000-\u001f\u007f<>:"|?*]/g;

const DROPS = 'drops';
const EXTENSION = /\.[^.\s]{1,16}$/;

function cleanName(given: string | undefined): string {
  const last = (given ?? '').normalize('NFC').split(/[/\\]/).at(-1) ?? '';
  return last.replace(UNSAFE, '_').trim().replace(/^\.+/, '');
}

function bounded(text: string, bytes: number): string {
  let kept = '';
  for (const character of text) {
    if (Buffer.byteLength(kept + character) > bytes) break;
    kept += character;
  }
  return kept.trim();
}

function fileName(given: string | undefined): string {
  return `${
    bounded(
      cleanName(given)
        .replace(/\.pdf$/i, '')
        .trim(),
      NAME_BYTES,
    ) || 'document'
  }.pdf`;
}

function droppedName(given: string | undefined): string {
  const name = cleanName(given);
  const extension = EXTENSION.exec(name)?.[0] ?? '';
  const stem = bounded(name.slice(0, name.length - extension.length), NAME_BYTES - Buffer.byteLength(extension));
  return `${stem || 'file'}${extension}`;
}

function threadDirectory(threadId: string): string {
  if (!THREAD_ID.test(threadId)) throw new ThreadAttachmentMissing(threadId);
  return threadId;
}

const attachmentUrl = (threadId: string, attachmentId: string): string => `/api/threads/${threadId}/attachments/${attachmentId}`;
const ATTACHMENT_URL = /^\/api\/threads\/([0-9a-zA-Z-]{1,64})\/attachments\/(.+)$/;
type AttachmentAddress = { readonly threadId: string; readonly id: string };

function attachmentAddress(url: string): AttachmentAddress | null {
  const matched = ATTACHMENT_URL.exec(url);
  const id = matched?.[2];
  return matched && id && threadAttachmentMediaTypeOfId(id) ? { threadId: matched[1]!, id } : null;
}

const attachmentIdOfUrl = (url: string): string | null => attachmentAddress(url)?.id ?? null;

function absent(cause: unknown): boolean {
  const code = (cause as NodeJS.ErrnoException).code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

const base64Of = (bytes: Uint8Array): string => Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
type PictureResult = ToolResultPart & { readonly result: { readonly type: 'content'; readonly value: readonly ToolContent[] } };
const heldPictures = (part: ContentPart): part is PictureResult =>
  part.type === 'tool-result' &&
  part.result.type === 'content' &&
  part.result.value.some((item) => item.type === 'file' && attachmentIdOfUrl(item.uri) !== null);
