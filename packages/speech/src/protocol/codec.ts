import type { Format } from '@runlith/audio/sound/format';
import type { Result } from 'effect';
import type { SpeechEvent } from '../wire/events.ts';
import type { SpeechFailure } from '../wire/failure.ts';
import type { Mark } from './adapter.ts';
import type { DuplexRequest, Message } from './transport.ts';

export type Act<State> = {
  readonly state: State;
  readonly send: ReadonlyArray<Message>;
  readonly events: ReadonlyArray<SpeechEvent>;
};

export type Keepalive = {
  readonly everyMs: number;
  readonly message: Message;
};

export type SpeechProtocol<State, Frame> = {
  readonly format: Format;
  readonly request: DuplexRequest;
  readonly init: ReadonlyArray<Message>;
  readonly initial: State;
  readonly decode: (message: Message) => Result.Result<Frame, SpeechFailure>;
  readonly step: (state: State, frame: Frame) => Result.Result<Act<State>, SpeechFailure>;
  readonly ready: (state: State) => boolean;
  readonly audio: (pcm: Int16Array) => Message;
  readonly commit?: ((state: State, commit: number) => Act<State>) | undefined;
  readonly finalize?: ((state: State) => Act<State>) | undefined;
  readonly finish: (state: State, sent: number) => Act<State>;
  readonly keepalive?: Keepalive | undefined;
};

export type SynthesisAct<State> = {
  readonly state: State;
  readonly send: ReadonlyArray<Message>;
  readonly audio: ReadonlyArray<Uint8Array>;
  readonly marks: ReadonlyArray<Mark>;
  readonly done: boolean;
};

export type SynthesisProtocol<State, Frame> = {
  readonly format: Format;
  readonly request: DuplexRequest;
  readonly init: ReadonlyArray<Message>;
  readonly initial: State;
  readonly decode: (message: Message) => Result.Result<Frame, SpeechFailure>;
  readonly step: (state: State, frame: Frame) => Result.Result<SynthesisAct<State>, SpeechFailure>;
  readonly ready: (state: State) => boolean;
  readonly say: (state: State, text: string) => SynthesisAct<State>;
  readonly end: (state: State) => SynthesisAct<State>;
  readonly keepalive?: Keepalive | undefined;
};
