import { Context, type Stream } from 'effect';
import type { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import type { VideoScale } from '../wire/artifacts.js';
import type { FilmRefusal } from '../wire/operations.js';
import type { Timeline } from '../wire/timeline.js';

export const VIDEO_BITS_PER_PIXEL = 0.15;

export type Reel = {
  readonly html: string;
  readonly timeline: Timeline;
  readonly scale: VideoScale;
  readonly targets: number;
  readonly file: string;
};

export class Film extends Context.Service<
  Film,
  {
    shoot(reel: Reel): Stream.Stream<number, GateRefusal<FilmRefusal>>;
  }
>()('tagma/artifacts/Film') {}
