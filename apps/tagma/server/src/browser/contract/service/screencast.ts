import { Context, type Effect, type Stream } from 'effect';
import type { PageId } from '../wire/ids.js';
import type { Budget, Chosen, InputEvent, ScreencastEvent } from '../wire/screencast.js';
import type { Drive } from './automation.js';

export class Screencast extends Context.Service<
  Screencast,
  {
    watch(page: PageId, budget: Budget): Stream.Stream<ScreencastEvent, Drive>;
    input(
      page: PageId,
      viewer: string,
      seq: number,
      events: readonly InputEvent[],
    ): Effect.Effect<{ readonly copied: string | null }, Drive<'viewer-unknown'>>;
    choose(page: PageId, files: readonly Chosen[]): Effect.Effect<number, Drive<'no-chooser'>>;
  }
>()('tagma/browser/Screencast') {}
