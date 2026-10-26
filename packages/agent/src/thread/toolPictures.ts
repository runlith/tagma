import { Effect } from 'effect';
import { MODEL_IMAGE_MEDIA_TYPES, type ModelImageRejection, normalizeModelImage } from '@runlith/llm/models/normalizeModelImage';
import { AgentHostFailed } from '../agent/AgentFailure';
import type { AgentPictureKeeper } from '../agent/ToolOutput';
import { THREAD_ATTACHMENT_SOURCE_MAX_BYTES } from '../transcript/attachments';
import type { ThreadAttachmentStorage } from './attachmentStorage';
import type { ThreadToolOutputFaces, ThreadTx } from './ThreadPorts';

export function pictureKeepingVault(vault: ThreadToolOutputFaces, attachments: ThreadAttachmentStorage<ThreadTx>): ThreadToolOutputFaces {
  return {
    settleOpen: (threadId, inputs) => vault.settleOpen(threadId, inputs),
    scope: (context) => {
      const scope = vault.scope(context);
      return {
        tools: scope.tools,
        project: (given) => scope.project(given),
        projectMessages: (messages) => scope.projectMessages(messages),
        retainInterrupted: (given) => scope.retainInterrupted(given),
        retainOpen: (given) => scope.retainOpen(given),
        commitReferenced: (messages, entries, tx) => scope.commitReferenced(messages, entries, tx),
        dispose: () => scope.dispose(),
        keepPicture: pictureKeeper(attachments, context.threadId),
      };
    },
  };
}

function pictureKeeper(attachments: ThreadAttachmentStorage<ThreadTx>, threadId: string): AgentPictureKeeper {
  return Effect.fnUntraced(function* (picture) {
    const declared = picture.mediaType.toLowerCase();
    const mediaType = MODEL_IMAGE_MEDIA_TYPES.find((type) => type === declared);
    if (mediaType === undefined) {
      return { refused: `${picture.mediaType} is not a picture type a model takes (${MODEL_IMAGE_MEDIA_TYPES.join(', ')})` };
    }
    const normalized = yield* Effect.tryPromise({
      try: (signal) => normalizeModelImage({ mediaType, bytes: picture.bytes, maxSourceBytes: THREAD_ATTACHMENT_SOURCE_MAX_BYTES }, signal),
      catch: (cause) => new AgentHostFailed({ port: 'toolOutputs', cause }),
    });
    if (normalized.status === 'rejected') return { refused: rejectionWords(normalized.rejection, mediaType) };
    const image = normalized.image;
    const stored = yield* attachments
      .keep(threadId, { mediaType: image.mediaType, bytes: image.bytes, width: image.width, height: image.height })
      .pipe(Effect.mapError((cause) => new AgentHostFailed({ port: 'toolOutputs', cause })));
    return {
      kept: {
        location: stored.url,
        mediaType: image.mediaType,
        width: image.width,
        height: image.height,
        sourceWidth: image.sourceWidth,
        sourceHeight: image.sourceHeight,
      },
    };
  });
}

function rejectionWords(rejection: ModelImageRejection, mediaType: string): string {
  switch (rejection.reason) {
    case 'empty':
      return 'the file is empty';
    case 'too-large':
      return `it is larger than the ${megabytes(rejection.maxSourceBytes)} a picture may be`;
    case 'undecodable':
      return 'its bytes do not decode as a picture';
    case 'type-mismatch':
      return `its bytes are not the ${mediaType} its type names`;
    case 'irreducible':
      return `it cannot be brought under ${rejection.maxWidth}×${rejection.maxHeight} and ${megabytes(rejection.maxBase64Bytes)}`;
  }
}

function megabytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}
