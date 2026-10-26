import type { ImageModelSpec } from '@runlith/llm/models/description';
import type { ImageAnswer, ImageRequest } from '@runlith/llm/profiles/images';
import type { TokenStoreFault } from '@runlith/llm/oauth/storeFailure';
import type { LLMError } from '@runlith/llm/schema/errors';
import { Context, type Effect } from 'effect';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import type { NotInstalled } from './registry.js';

export type ImageModel = {
  readonly provider: string;
  readonly providerLabel: string;
  readonly model: string;
  readonly spec: ImageModelSpec;
};

export type ImageCall = {
  readonly provider: string;
  readonly model: string;
  readonly ownerId: string;
};

export type Drawn = ImageAnswer & { readonly account: string | null };

export class ImageModels extends Context.Service<
  ImageModels,
  {
    declared(): readonly ImageModel[];
    signed(): Effect.Effect<readonly ImageModel[], StoreFailure | TokenStoreFault | NotInstalled>;
    draw(call: ImageCall, request: ImageRequest): Effect.Effect<Drawn, LLMError | NotInstalled | GateRefusal<'provider-failed'>>;
  }
>()('tagma/providers/ImageModels') {}
