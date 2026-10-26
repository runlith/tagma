export type Granularity = 'token' | 'word' | 'segment';

export type Frames = {
  readonly from: number;
  readonly to: number;
};

export type SourceUnit<Time = Frames> = {
  readonly lane: 'source';
  readonly text: string;
  readonly granularity: Granularity;
  readonly time?: Time | undefined;
  readonly speaker?: string | undefined;
  readonly language?: string | undefined;
  readonly confidence?: number | undefined;
};

export type TranslationUnit = {
  readonly lane: 'translation';
  readonly text: string;
  readonly granularity: Granularity;
  readonly language?: string | undefined;
  readonly origin?: string | undefined;
  readonly speaker?: string | undefined;
};

export type Unit<Time = Frames> = SourceUnit<Time> | TranslationUnit;

export type Turn = string;

export type Partial = { readonly _tag: 'Partial'; readonly turn: Turn; readonly text: string };
export type Final = { readonly _tag: 'Final'; readonly turn: Turn; readonly units: ReadonlyArray<Unit> };
export type TurnEnd = { readonly _tag: 'TurnEnd'; readonly turn: Turn };
export type TurnFailed = { readonly _tag: 'TurnFailed'; readonly turn: Turn; readonly message: string };
export type SpeechStart = { readonly _tag: 'SpeechStart'; readonly turn: Turn; readonly at: number };
export type SpeechEnd = { readonly _tag: 'SpeechEnd'; readonly turn: Turn; readonly at: number };
export type Committed = { readonly _tag: 'Committed'; readonly turn: Turn; readonly commit: number };
export type Finalized = { readonly _tag: 'Finalized' };
export type Finished = { readonly _tag: 'Finished' };

export type SpeechEvent = Partial | Final | TurnEnd | TurnFailed | SpeechStart | SpeechEnd | Committed | Finalized | Finished;

export type Job = { readonly _tag: 'Job'; readonly token: string };

export type FileEvent = SpeechEvent | Job;

const finalized: Finalized = { _tag: 'Finalized' };
const finished: Finished = { _tag: 'Finished' };

export const SpeechEvent = {
  partial: (turn: Turn, text: string): Partial => ({ _tag: 'Partial', turn, text }),
  final: (turn: Turn, units: ReadonlyArray<Unit>): Final => ({ _tag: 'Final', turn, units }),
  turnEnd: (turn: Turn): TurnEnd => ({ _tag: 'TurnEnd', turn }),
  turnFailed: (turn: Turn, message: string): TurnFailed => ({ _tag: 'TurnFailed', turn, message }),
  speechStart: (turn: Turn, at: number): SpeechStart => ({ _tag: 'SpeechStart', turn, at }),
  speechEnd: (turn: Turn, at: number): SpeechEnd => ({ _tag: 'SpeechEnd', turn, at }),
  committed: (turn: Turn, commit: number): Committed => ({ _tag: 'Committed', turn, commit }),
  finalized,
  finished,
};
