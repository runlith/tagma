import { Context, type Effect, type Stream } from 'effect';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import type { Heard, HeardTrackAsk, RecognitionPurpose, RecognizerAsk } from '../wire/listening.js';

export type HearAsk = {
  readonly id: string;
  readonly purpose?: RecognitionPurpose | undefined;
  readonly tracks: readonly HeardTrackAsk[];
  readonly recognizer?: RecognizerAsk | undefined;
};

export type StartRefusal = 'no-model' | 'capture-refused' | 'track-invalid';

export type Refused<Code extends string> = GateRefusal<Code> | StoreFailure;

export type Sent = 'finished' | 'lost';

export class Recognitions extends Context.Service<
  Recognitions,
  {
    recognize(ask: HearAsk): Stream.Stream<Heard, Refused<StartRefusal>>;
    finish(id: string): Effect.Effect<void, Refused<'unknown-recognition'>>;
    send<E>(id: string, track: string, frames: Stream.Stream<Uint8Array, E>): Effect.Effect<Sent, GateRefusal<'sender-refused'> | E>;
  }
>()('tagma/speech/Recognitions') {}
