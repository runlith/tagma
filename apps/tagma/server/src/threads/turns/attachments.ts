import { Effect } from 'effect';
import {
  isThreadDocument,
  isThreadFile,
  THREAD_ATTACHMENT_SOURCE_MAX_BYTES,
  THREAD_DOCUMENT_MAX_BYTES,
  THREAD_FILE_MAX_BYTES,
  threadDocumentTitle,
} from '@runlith/agent/transcript/attachments';
import { type ModelImageRejection, normalizeModelImage } from '@runlith/llm/models/normalizeModelImage';
import type { ThreadRecords } from '../../thread-record/contract/service/records.js';
import { gated } from '../projectGate.js';
import { DROPPED_FILE_MAX_BYTES, DROPPED_FILE_TOO_LARGE } from '../contract/wire/drops.js';
import { Attachments } from '../contract/service/attachments.js';
import { attachmentRejected } from '../refusals.js';
import type { ThreadAttachmentStore } from '../resources/attachments.js';

export function attachments(records: ThreadRecords['Service'], store: ThreadAttachmentStore): Attachments['Service'] {
  return Attachments.of({
    upload: (threadId, projectId, input) =>
      gated(records, threadId, projectId, () =>
        Effect.gen(function* () {
          const mediaType = input.mediaType;
          if (isThreadDocument(mediaType)) {
            const refused = documentRefusal(input.bytes);
            if (refused !== null) return yield* Effect.fail(attachmentRejected(refused));
            return yield* store.keep(threadId, { mediaType, bytes: input.bytes });
          }
          if (isThreadFile(mediaType)) {
            const refused = pdfRefusal(input.bytes);
            if (refused !== null) return yield* Effect.fail(attachmentRejected(refused));
            return yield* store.keep(threadId, {
              mediaType,
              bytes: input.bytes,
              name: input.name,
            });
          }
          const normalized = yield* Effect.promise(() =>
            normalizeModelImage({
              mediaType,
              bytes: input.bytes,
              maxSourceBytes: THREAD_ATTACHMENT_SOURCE_MAX_BYTES,
            }),
          );
          if (normalized.status === 'rejected') {
            return yield* Effect.fail(attachmentRejected(refusal(normalized.rejection)));
          }
          return yield* store.keep(threadId, {
            mediaType: normalized.image.mediaType,
            bytes: normalized.image.bytes,
          });
        }),
      ),

    keep: (threadId, projectId, input) => gated(records, threadId, projectId, () => store.keep(threadId, input)),

    drop: (threadId, projectId, input) =>
      gated(records, threadId, projectId, () =>
        input.bytes.byteLength > DROPPED_FILE_MAX_BYTES
          ? Effect.fail(attachmentRejected(DROPPED_FILE_TOO_LARGE))
          : store.drop(threadId, input),
      ),

    read: (threadId, projectId, attachmentId) => gated(records, threadId, projectId, () => store.read(threadId, attachmentId)),

    locate: (threadId, projectId, attachmentId) => gated(records, threadId, projectId, () => store.located(threadId, attachmentId)),
  });
}

const strict = new TextDecoder('utf-8', { fatal: true });

function documentRefusal(bytes: Uint8Array): string | null {
  if (bytes.byteLength > THREAD_DOCUMENT_MAX_BYTES) return `A document can be up to ${THREAD_DOCUMENT_MAX_BYTES / 1024 / 1024} MB.`;
  let text: string;
  try {
    text = strict.decode(bytes);
  } catch {
    return 'A document is UTF-8 text.';
  }
  return threadDocumentTitle(text) === null ? 'A document opens with its title as a `# ` heading line.' : null;
}

const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d];
const PDF_HEADER_REACH = 1024;

function pdfRefusal(bytes: Uint8Array): string | null {
  if (bytes.byteLength === 0) return 'That file is empty.';
  if (bytes.byteLength > THREAD_FILE_MAX_BYTES) return `A PDF can be up to ${THREAD_FILE_MAX_BYTES / 1024 / 1024} MB.`;
  const reach = Math.min(bytes.byteLength, PDF_HEADER_REACH) - PDF_SIGNATURE.length;
  for (let at = 0; at <= reach; at += 1) {
    if (PDF_SIGNATURE.every((byte, index) => bytes[at + index] === byte)) return null;
  }
  return 'The bytes are not a PDF.';
}

function refusal(rejection: ModelImageRejection): string {
  switch (rejection.reason) {
    case 'empty':
      return 'That file is empty.';
    case 'too-large':
      return `An image can be up to ${rejection.maxSourceBytes / 1024 / 1024} MB.`;
    case 'undecodable':
      return 'That image could not be decoded.';
    case 'type-mismatch':
      return 'The bytes do not match the image type they were sent as.';
    case 'irreducible':
      return `That image could not be reduced below ${rejection.maxWidth}x${rejection.maxHeight} and ${rejection.maxBase64Bytes / 1024 / 1024} MB of base64.`;
  }
}
