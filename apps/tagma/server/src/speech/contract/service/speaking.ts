import { Context, type Effect, type Scope, type Stream } from 'effect';
import type { SpeakAsk, Synthesized, Voiced } from '../wire/speaking.js';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { GateRefusal } from '../../../platform/contract/wire/refusal.js';

export type VoiceAsk = {
  readonly provider?: string | undefined;
  readonly model?: string | undefined;
  readonly voice?: string | undefined;
  readonly language?: string | undefined;
  readonly account?: string | undefined;
};

export type SpeakRefusal = 'no-model' | 'player-refused' | 'speech-failed';

export type Utterer = Voiced & {
  readonly say: (text: string) => Effect.Effect<void, GateRefusal<'speech-failed'>>;
  readonly end: Effect.Effect<void, GateRefusal<'speech-failed'>>;
  readonly played: Effect.Effect<void, GateRefusal<'speech-failed' | 'player-refused'>>;
};

export class Speaking extends Context.Service<
  Speaking,
  {
    open(ask: VoiceAsk): Effect.Effect<Utterer, GateRefusal<SpeakRefusal> | StoreFailure, Scope.Scope>;
    speak(ask: VoiceAsk & { readonly text: string }): Effect.Effect<Voiced, GateRefusal<SpeakRefusal> | StoreFailure>;
    audio(ask: SpeakAsk): Stream.Stream<Synthesized, GateRefusal<'no-model' | 'speech-failed'> | StoreFailure>;
    readonly stop: Effect.Effect<number>;
  }
>()('tagma/speech/Speaking') {}
