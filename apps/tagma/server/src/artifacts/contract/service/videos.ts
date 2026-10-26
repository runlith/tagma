import { Context, type Effect, type Stream } from 'effect';
import type { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import type { Video, VideoScale } from '../wire/artifacts.js';
import type { FilmRefusal } from '../wire/operations.js';

export type VideoAsk = { readonly page: string; readonly version?: string | undefined; readonly scale: VideoScale };

export type Exported = { readonly video: Video; readonly path: string | null };

export class Videos extends Context.Service<
  Videos,
  {
    export(ask: VideoAsk): Effect.Effect<Exported, GateRefusal<'artifact-unknown' | 'no-timeline' | 'disk-full' | FilmRefusal>>;
    cancel(job: string): Effect.Effect<void, GateRefusal<'video-unknown'>>;
    follow(page: string): Stream.Stream<readonly Video[]>;
  }
>()('tagma/artifacts/Videos') {}
