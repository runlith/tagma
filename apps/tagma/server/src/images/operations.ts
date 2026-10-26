import { extname, isAbsolute } from 'node:path';
import { said } from '../platform/contract/service/presentation.js';
import {
  THREAD_ATTACHMENT_SOURCE_MAX_BYTES,
  THREAD_IMAGE_MEDIA_TYPES,
  type ThreadImageMediaType,
} from '@runlith/agent/transcript/attachments';
import { pictureSize } from '@runlith/llm/models/normalizeModelImage';
import type { ImageInput } from '@runlith/llm/profiles/images';
import type { LLMError } from '@runlith/llm/schema/errors';
import { Effect, FileSystem } from 'effect';
import { body, type OperationPair, pair } from '../platform/contract/service/body.js';
import type { Caller } from '../platform/contract/wire/caller.js';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import { ImageModels } from '../providers/contract/service/images.js';
import { Attachments } from '../threads/contract/service/attachments.js';
import { ImageChoice } from './contract/service/choice.js';
import { IMAGE_OPERATIONS as IMAGES, type ImageOperationId } from './contract/wire/operations.js';

const EXTENSIONS: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

const input = (reason: string) => new GateRefusal('image-input', reason, ['name pictures the image model takes, by a path that stands']);

const placed = (path: string, caller: Caller): string | GateRefusal<'image-input'> => {
  if (isAbsolute(path)) return path;
  return caller.files === null
    ? input(`${path} is relative and this call has no scratch to read it from; name it by its absolute path.`)
    : caller.files.resolve(path);
};

const readInput = Effect.fnUntraced(function* (path: string, caller: Caller) {
  const at = placed(path, caller);
  if (at instanceof GateRefusal) return yield* at;
  const mediaType = EXTENSIONS[extname(at).toLowerCase()];
  if (mediaType === undefined) return yield* input(`${path} is not a picture: name a .png, .jpg, .webp or .gif file.`);
  const files = yield* FileSystem.FileSystem;
  const info = yield* files.stat(at).pipe(Effect.mapError((failure) => input(`${path} cannot be read: ${failure.message}`)));
  if (Number(info.size) > THREAD_ATTACHMENT_SOURCE_MAX_BYTES) {
    return yield* input(`${path} is larger than the ${THREAD_ATTACHMENT_SOURCE_MAX_BYTES / 1024 / 1024} MB a picture may be.`);
  }
  const bytes = yield* files.readFile(at).pipe(Effect.mapError((failure) => input(`${path} cannot be read: ${failure.message}`)));
  return { bytes, mediaType } satisfies ImageInput;
});

const resetWords = (resetsAt: number | undefined): string =>
  resetsAt === undefined ? 'The provider names no time it resets.' : `It resets at ${new Date(resetsAt * 1000).toISOString()}.`;

const refusalOf = (failure: LLMError | GateRefusal) => {
  if (failure._tag === 'GateRefusal') {
    return new GateRefusal('no-image-model', `The image model cannot be called: ${failure.reason}`, failure.unblock);
  }
  const reason = failure.reason;
  if (reason._tag === 'QuotaExceeded') {
    return new GateRefusal('image-limit', `The picture limit of this account is spent. ${resetWords(reason.resetsAt)}`, [
      'wait until the limit resets',
      'sign in to another account that draws',
    ]);
  }
  if (reason._tag === 'RateLimit') {
    return new GateRefusal('image-limit', `The provider asks to draw less often: ${reason.message}`, ['draw again later']);
  }
  if (reason._tag === 'InvalidRequest' && failure.module === 'Images') {
    return new GateRefusal('image-input', reason.message, ['ask within what the image model takes']);
  }
  return new GateRefusal(
    'image-refused',
    `The image model refused: ${failure.message}${failure.detail === undefined ? '' : ` (${failure.detail})`}`,
    ['change the request if the provider named a reason', 'draw again later'],
  );
};

const undecodable = () =>
  new GateRefusal('image-refused', 'The image model answered bytes that do not decode as a picture.', ['draw again']);

const measured = (bytes: Uint8Array) =>
  Effect.tryPromise({ try: () => pictureSize(bytes), catch: undecodable }).pipe(
    Effect.flatMap((size) => (size === null ? Effect.fail(undecodable()) : Effect.succeed(size))),
  );

const unkept = (failure: { readonly message: string }) =>
  new GateRefusal('image-refused', `The picture was drawn but could not be kept in the thread: ${failure.message}`, ['draw again']);

const pictureType = (mediaType: string): ThreadImageMediaType | GateRefusal<'image-refused'> =>
  THREAD_IMAGE_MEDIA_TYPES.find((type) => type === mediaType) ??
  new GateRefusal('image-refused', `The image model answered a ${mediaType} picture, which a thread does not keep.`, ['draw again']);

export const IMAGE_PAIRS: { readonly [K in ImageOperationId]: OperationPair<(typeof IMAGES)[K]> } = {
  generate_image: pair(
    IMAGES.generate_image,
    body(IMAGES.generate_image, {
      execute: Effect.fnUntraced(function* (asked, _prepared, caller) {
        const actor = caller.actor;
        if (actor.kind !== 'thread') {
          return yield* new GateRefusal('no-image-model', 'Pictures are drawn for a thread.', ['call from a thread']);
        }
        const choice = yield* (yield* ImageChoice).of(actor.projectId);
        if (choice._tag === 'None') return yield* new GateRefusal('no-image-model', choice.reason, choice.unblock);
        const { model } = choice;
        const images = yield* Effect.forEach(asked.images ?? [], (path) => readInput(path, caller));
        const drawn = yield* (yield* ImageModels)
          .draw(
            { provider: model.provider, model: model.model, ownerId: actor.principalId },
            { model: model.model, prompt: asked.prompt, images, transparent: asked.transparent === true },
          )
          .pipe(Effect.mapError(refusalOf));
        const picture = drawn.images[0];
        if (picture === undefined) return yield* new GateRefusal('image-refused', 'The image model answered no picture.', ['draw again']);
        const mediaType = pictureType(picture.mediaType);
        if (mediaType instanceof GateRefusal) return yield* mediaType;
        const size = yield* measured(picture.bytes);
        const attachments = yield* Attachments;
        const { kept, located } = yield* Effect.gen(function* () {
          const kept = yield* attachments.keep(actor.threadId, actor.projectId, { mediaType, bytes: picture.bytes });
          return { kept, located: yield* attachments.locate(actor.threadId, actor.projectId, kept.id) };
        }).pipe(Effect.mapError(unkept));
        if (located === null) return yield* unkept({ message: `the file of ${kept.id} is not found after it was written` });
        return {
          status: 'drawn' as const,
          path: located.path,
          url: kept.url,
          mediaType,
          width: size.width,
          height: size.height,
          model: model.spec.label,
          prompt: asked.prompt,
        };
      }),
      media: (answer) =>
        answer.status !== 'drawn'
          ? Effect.succeed([])
          : Effect.flatMap(FileSystem.FileSystem, (files) => files.readFile(String(answer.path))).pipe(
              Effect.map((bytes) => [{ bytes, mediaType: String(answer.mediaType), label: String(answer.path) }]),
              Effect.orDie,
            ),
      display: (answer) =>
        answer.status !== 'drawn'
          ? { form: 'none' }
          : {
              form: 'none',
              title: String(answer.prompt),
              facts: [{ label: String(answer.model) }],
              images: [
                {
                  url: String(answer.url),
                  mediaType: String(answer.mediaType),
                  width: Number(answer.width),
                  height: Number(answer.height),
                  label: String(answer.path),
                },
              ],
            },
      voice: said((answer) =>
        answer.status !== 'drawn'
          ? JSON.stringify(answer)
          : `Drew a ${answer.width}×${answer.height} picture with ${answer.model}, kept at ${answer.path}. The operator already sees it in the thread, so do not show or describe it again. To change it, pass that path in images; to put it in the project, copy the file there, never move it.`,
      ),
    }),
  ),
};
