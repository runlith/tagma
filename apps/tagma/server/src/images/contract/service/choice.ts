import { Context, type Effect } from 'effect';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { Unblock } from '../../../platform/contract/wire/refusal.js';
import type { ImageModel } from '../../../providers/contract/service/images.js';

export type ImageChoiceAnswer =
  | { readonly _tag: 'Chosen'; readonly model: ImageModel }
  | { readonly _tag: 'None'; readonly reason: string; readonly unblock: Unblock };

export class ImageChoice extends Context.Service<
  ImageChoice,
  {
    of(projectId: number): Effect.Effect<ImageChoiceAnswer, StoreFailure>;
  }
>()('tagma/images/ImageChoice') {}
