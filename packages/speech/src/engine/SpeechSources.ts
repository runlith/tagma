import { Context, type Stream } from 'effect';
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
  }
>()('speech/SpeechSources') {}
