export type TurnMode = 'provider' | 'client' | 'none';

export type Timestamps = 'word' | 'segment' | 'none';

export type Languages = {
  readonly codes: ReadonlyArray<string>;
  readonly hints: number;
  readonly detect: boolean;
};

export type Translation = {
  readonly targets: ReadonlyArray<string>;
  readonly twoWay: boolean;
};

export type Prompting = {
  readonly prompt: boolean;
  readonly terms: boolean;
};

export type Limits = {
  readonly sessionMs?: number | undefined;
  readonly clipMs?: number | undefined;
  readonly clipBytes?: number | undefined;
};

export type Knob = {
  readonly id: string;
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly initial: number;
  readonly modes: ReadonlyArray<TurnMode>;
};

type Recognizing = {
  readonly timestamps: Timestamps;
  readonly speakers: boolean;
  readonly confidence: boolean;
  readonly languages: Languages;
  readonly translation?: Translation | undefined;
  readonly prompting: Prompting;
};

type Sampled = Recognizing & {
  readonly rates: ReadonlyArray<number>;
  readonly limits: Limits;
  readonly tuning: ReadonlyArray<Knob>;
};

export type StreamRecognition = Sampled & {
  readonly kind: 'stream';
  readonly partials: boolean;
  readonly turns: ReadonlyArray<TurnMode>;
  readonly finalize: boolean;
};

export type BatchRecognition = Sampled & {
  readonly kind: 'batch';
};

export type FileLimits = {
  readonly fileMs?: number | undefined;
};

export type FileRecognition = Recognizing & {
  readonly kind: 'file';
  readonly containers: ReadonlyArray<string>;
  readonly limits: FileLimits;
};

export type LiveRecognition = StreamRecognition | BatchRecognition;

export type RecognitionCapabilities = LiveRecognition | FileRecognition;

export type RecognitionKind = RecognitionCapabilities['kind'];

export const LIVE: ReadonlyArray<RecognitionKind> = ['stream', 'batch'];

export const RECORDED: ReadonlyArray<RecognitionKind> = ['file', 'batch'];

export type Voice = {
  readonly id: string;
  readonly label: string;
  readonly languages: ReadonlyArray<string>;
};

export type SynthesisLimits = {
  readonly characters?: number | undefined;
  readonly audioMs?: number | undefined;
  readonly streams?: number | undefined;
};

export type SynthesisCapabilities = {
  readonly text: 'stream' | 'whole';
  readonly rates: ReadonlyArray<number>;
  readonly voices: ReadonlyArray<Voice>;
  readonly languages: ReadonlyArray<string>;
  readonly needsLanguage: boolean;
  readonly timestamps: boolean;
  readonly limits: SynthesisLimits;
};

export type RecognitionModel<Capabilities extends RecognitionCapabilities = RecognitionCapabilities> = {
  readonly id: string;
  readonly label: string;
  readonly recognition: Capabilities;
};

export type SynthesisModel = {
  readonly id: string;
  readonly label: string;
  readonly synthesis: SynthesisCapabilities;
};
