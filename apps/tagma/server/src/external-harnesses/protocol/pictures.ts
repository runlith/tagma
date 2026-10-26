import { Effect } from 'effect';
import type { ContentBlock } from '@runlith/acp/content';
import type { ThreadInboxItem } from '@runlith/agent/thread/storage/inbox';
import {
  attachedDocumentText,
  attachedFileText,
  isThreadDocument,
  isThreadFile,
  isThreadPicture,
  keptPictureText,
  missingFileText,
  missingPictureText,
  threadAttachmentMediaTypeOfId,
} from '@runlith/agent/transcript/attachments';
import type { Attachments } from '../../threads/contract/service/attachments.js';
import type { HarnessFailure } from '../../threads/contract/service/failure.js';
import { inputWords } from '../adapter/input.js';

export const itemBlocks = (
  attachments: Attachments['Service'],
  threadId: string,
  project: Effect.Effect<number, HarnessFailure>,
  item: ThreadInboxItem,
  words: string,
  taken: boolean,
): Effect.Effect<readonly ContentBlock[], HarnessFailure> => {
  const text: ContentBlock = { type: 'text', text: inputWords(item.id, words) };
  const refs = item.kind === 'turn' || item.kind === 'signal' ? (item.body.attachments ?? []) : [];
  if (refs.length === 0) return Effect.succeed([text]);
  const kinds = refs.flatMap((ref) => {
    const mediaType = threadAttachmentMediaTypeOfId(ref.id);
    return mediaType === null ? [] : [{ id: ref.id, mediaType }];
  });
  const documents = kinds.filter((ref) => isThreadDocument(ref.mediaType));
  const files = kinds.filter((ref) => isThreadFile(ref.mediaType));
  const pictures = kinds.filter((ref) => isThreadPicture(ref.mediaType));
  return Effect.flatMap(project, (projectId) =>
    Effect.gen(function* () {
      const read = yield* Effect.forEach(documents, (ref) => attachments.read(threadId, projectId, ref.id));
      const filed = yield* Effect.forEach(files, (ref) =>
        Effect.map(attachments.locate(threadId, projectId, ref.id), (held): ContentBlock => ({
          type: 'text',
          text: held?.name === undefined ? missingFileText(ref.id) : attachedFileText(held.name, held.path),
        })),
      );
      const located = yield* Effect.forEach(pictures, (ref) =>
        Effect.map(attachments.locate(threadId, projectId, ref.id), (held) => ({ id: ref.id, path: held?.path ?? null })),
      );
      const shown = taken
        ? yield* Effect.forEach(located, ({ id, path }) =>
            path === null
              ? Effect.succeed<ContentBlock[]>([{ type: 'text', text: missingPictureText(id) }])
              : Effect.map(attachments.read(threadId, projectId, id), (held): ContentBlock[] => [
                  { type: 'image', data: Buffer.from(held.bytes).toString('base64'), mimeType: held.mediaType },
                  { type: 'text', text: keptPictureText(path) },
                ]),
          )
        : [];
      const kept = located.flatMap((picture) => (picture.path === null ? [] : [picture.path]));
      return [
        text,
        ...read.map((attachment): ContentBlock => ({ type: 'text', text: attachedDocumentText(decoder.decode(attachment.bytes)) })),
        ...filed,
        ...shown.flat(),
        ...(taken || located.length === 0 ? [] : [{ type: 'text' as const, text: unsentText(located.length, kept) }]),
      ];
    }),
  );
};

const unsentText = (count: number, paths: readonly string[]): string =>
  `[${count === 1 ? 'A picture was' : `${count} pictures were`} not sent: this agent declares no image prompts.${
    paths.length === 0 ? '' : ` ${paths.length === 1 ? 'It is' : 'They are'} kept at ${paths.join(', ')}.`
  }]`;

const decoder = new TextDecoder();
