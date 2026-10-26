import { Effect } from 'effect';
import type { Headers } from 'effect/http';
import type { ImageModelSpec } from '../models/description';
import type { HttpExecutor } from '../llm/route/executor';
import { InvalidRequestReason, LLMError } from '../llm/schema/errors';
import type { QuotaObservation } from '../llm/schema/quota';
import type { ProfileSelection } from './contract';

export type ImageInput = { readonly bytes: Uint8Array; readonly mediaType: string };

export type ImageRequest = {
  readonly model: string;
  readonly prompt: string;
  readonly images: readonly ImageInput[];
  readonly transparent: boolean;
};

export type GeneratedImage = { readonly bytes: Uint8Array; readonly mediaType: string };

export type ImageAnswer = {
  readonly images: readonly GeneratedImage[];
  readonly requestId: string | undefined;
  readonly headers: Headers.Headers;
};

export type ImageProfile = {
  generate(selection: ProfileSelection, request: ImageRequest): Effect.Effect<ImageAnswer, LLMError, HttpExecutor>;
  quota(headers: Headers.Headers, observedAt: Date): QuotaObservation | null;
};

const refused = (message: string): LLMError =>
  new LLMError({ module: 'Images', method: 'generate', reason: new InvalidRequestReason({ message }) });

export const imageRequestFault = (spec: ImageModelSpec, request: ImageRequest): string | null => {
  if (request.prompt.trim() === '') return 'The picture needs a prompt.';
  if (request.images.length > spec.inputs) {
    return spec.inputs === 0
      ? `${spec.label} draws from a prompt alone and takes no input images.`
      : `${spec.label} takes at most ${spec.inputs} input images, not ${request.images.length}.`;
  }
  const foreign = request.images.find((image) => !spec.inputTypes.includes(image.mediaType));
  if (foreign !== undefined) return `${spec.label} takes ${spec.inputTypes.join(', ')} images, not ${foreign.mediaType}.`;
  if (request.transparent && !spec.transparent) return `${spec.label} draws no transparent background.`;
  return null;
};

export const checkedImageRequest = (spec: ImageModelSpec, request: ImageRequest): Effect.Effect<void, LLMError> => {
  const fault = imageRequestFault(spec, request);
  return fault === null ? Effect.void : Effect.fail(refused(fault));
};
