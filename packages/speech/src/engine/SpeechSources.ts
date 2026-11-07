import { Context, type Effect, type Scope, type Stream } from 'effect';
import type { SpeechHost } from '../protocol/adapter.ts';
import type { SpeechPart } from './catalog.ts';

export type SpeechStanding = {
  readonly parts: ReadonlyArray<SpeechPart<SpeechHost>>;
  readonly taken: ReadonlyMap<string, string>;
};

export class SpeechSources extends Context.Service<
  SpeechSources,
  {
    current(): SpeechStanding;
    readonly changes: Stream.Stream<SpeechStanding>;
    hold(revisions: () => ReadonlySet<string>): Effect.Effect<void, never, Scope.Scope>;
  }
>()('speech/SpeechSources') {}
