import type { Availability } from '@runlith/audio/port/devices';
import type { Format } from '@runlith/audio/sound/format';
import type { Effect, Schema, Scope, Stream } from 'effect';
import type { RecognitionModel, SynthesisModel } from '../wire/capabilities.ts';
import type { FileEvent, Frames, SpeechEvent } from '../wire/events.ts';
import type { Overflow, SpeechFailure } from '../wire/failure.ts';
import type { RecognitionRequest, SynthesisRequest } from '../wire/requests.ts';

export type Connection = {
  readonly format: Format;
  readonly send: (pcm: Int16Array) => Effect.Effect<void, SpeechFailure | Overflow>;
  readonly commit: (commit: number) => Effect.Effect<void, SpeechFailure>;
  readonly finalize: Effect.Effect<void, SpeechFailure>;
  readonly finish: Effect.Effect<void, SpeechFailure>;
  readonly delivered: Effect.Effect<number>;
  readonly events: Stream.Stream<SpeechEvent, SpeechFailure>;
};

export type Clip = {
  readonly format: Format;
  readonly pcm: Int16Array;
};

export type Recorded = {
  readonly mime: string;
  readonly bytes: Stream.Stream<Uint8Array, SpeechFailure>;
  readonly size: number;
  readonly format: Format;
  readonly durationMs: number;
  readonly reference: string;
};

export type Recognizer<Credential, R> = {
  readonly models: ReadonlyArray<RecognitionModel>;
  readonly stream?: (
    model: RecognitionModel,
    request: RecognitionRequest,
    credential: Credential,
  ) => Effect.Effect<Connection, SpeechFailure, Scope.Scope | R>;
  readonly batch?: (
    model: RecognitionModel,
    clip: Clip,
    request: RecognitionRequest,
    credential: Credential,
  ) => Stream.Stream<SpeechEvent, SpeechFailure, R>;
  readonly file?: (
    model: RecognitionModel,
    recorded: Recorded,
    request: RecognitionRequest,
    credential: Credential,
  ) => Stream.Stream<FileEvent, SpeechFailure, R>;
  readonly resume?: (model: RecognitionModel, token: string, credential: Credential) => Stream.Stream<FileEvent, SpeechFailure, R>;
  readonly discard?: (token: string, credential: Credential) => Effect.Effect<void, SpeechFailure, R>;
};

export type Mark = {
  readonly text: string;
  readonly frames: Frames;
};

export type Spoken = { readonly _tag: 'Audio'; readonly pcm: Int16Array } | { readonly _tag: 'Marks'; readonly marks: ReadonlyArray<Mark> };

export type Synthesis = {
  readonly format: Format;
  readonly say: (text: string) => Effect.Effect<void, SpeechFailure>;
  readonly end: Effect.Effect<void, SpeechFailure>;
  readonly audio: Stream.Stream<Spoken, SpeechFailure>;
};

export type Synthesizer<Credential, R> = {
  readonly models: ReadonlyArray<SynthesisModel>;
  readonly open: (
    model: SynthesisModel,
    request: SynthesisRequest,
    credential: Credential,
  ) => Effect.Effect<Synthesis, SpeechFailure, Scope.Scope | R>;
};

export type CredentialForm<Credential> =
  | { readonly _tag: 'none'; readonly value: Credential }
  | { readonly _tag: 'required'; readonly schema: Schema.Codec<Credential, unknown> };

export type SpeechProvider<Credential = unknown, R = never> = {
  readonly id: string;
  readonly label: string;
  readonly credential: CredentialForm<Credential>;
  readonly egress: ReadonlyArray<string>;
  readonly availability: (model: string) => Effect.Effect<Availability>;
  readonly recognizer?: Recognizer<Credential, R> | undefined;
  readonly synthesizer?: Synthesizer<Credential, R> | undefined;
};
