import { Context, type Stream } from 'effect';
import type { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import type { RenderRefusal } from '../wire/operations.js';
import type { Timeline } from '../wire/timeline.js';

export type FrameImage = { readonly format: 'png' } | { readonly format: 'jpeg'; readonly quality: number };

export type Footage = {
  readonly html: string;
  readonly timeline: Timeline;
  readonly frames: readonly number[];
  readonly scale: number;
  readonly image: FrameImage;
  readonly targets: number;
};

export type Shot = { readonly k: number; readonly bytes: Uint8Array };

export class Render extends Context.Service<
  Render,
  {
    frames(footage: Footage): Stream.Stream<Shot, GateRefusal<RenderRefusal>>;
  }
>()('tagma/artifacts/Render') {}
