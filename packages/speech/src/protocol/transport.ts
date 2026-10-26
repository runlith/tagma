import { Context, type Effect, type Scope, type Stream } from 'effect';
import type { SpeechFailure } from '../wire/failure.ts';

export type Message = string | Uint8Array;

export type DuplexRequest = {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly protocols: ReadonlyArray<string>;
};

export type DuplexLink = {
  readonly send: (message: Message) => Effect.Effect<void, SpeechFailure>;
  readonly buffered: Effect.Effect<number>;
  readonly messages: Stream.Stream<Message, SpeechFailure>;
  readonly close: Effect.Effect<void>;
};

export class DuplexTransport extends Context.Service<
  DuplexTransport,
  {
    readonly open: (request: DuplexRequest) => Effect.Effect<DuplexLink, SpeechFailure, Scope.Scope>;
  }
>()('speech/DuplexTransport') {}
