import { Context, type Effect } from 'effect';
import type { PageId } from '../wire/ids.js';
import type { Glance } from '../wire/page.js';
import type { Recorded } from '../wire/recording.js';
import type { Drive } from './automation.js';
import type { Clips } from './clips.js';

export type Started = { readonly page: Glance; readonly path: string; readonly fps: number };

export class Recordings extends Context.Service<
  Recordings,
  {
    start(page: PageId, fps: number, thread: string | null): Effect.Effect<Started, Drive<'recording-running' | 'recording-failed'>, Clips>;
    stop(
      page: PageId,
      thread: string | null,
    ): Effect.Effect<Recorded & { readonly page: Glance }, Drive<'no-recording' | 'recording-failed'>>;
  }
>()('tagma/browser/Recordings') {}
