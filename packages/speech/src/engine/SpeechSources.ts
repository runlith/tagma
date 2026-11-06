import { Context, type Stream } from 'effect';
import type { HttpClient } from 'effect/http';
import type { DuplexTransport } from '../protocol/transport.ts';
import type { SpeechPart } from './catalog.ts';

export type SpeechHost = DuplexTransport | HttpClient.HttpClient;

export class SpeechSources extends Context.Service<
  SpeechSources,
  {
    readonly parts: Stream.Stream<ReadonlyArray<SpeechPart<SpeechHost>>>;
  }
>()('speech/SpeechSources') {}
