import type { GapCause } from '@runlith/audio/sound/gap';
import type { Finished, Job, Unit } from './events.ts';

export type Span = {
  readonly from: number;
  readonly to: number;
};

export type UtteranceId = {
  readonly track: string;
  readonly segment: number;
  readonly seq: number;
};

export type Utterance = {
  readonly _tag: 'Utterance';
  readonly id: UtteranceId;
  readonly revision: number;
  readonly closed: boolean;
  readonly text: string;
  readonly hypothesis: string;
  readonly units: ReadonlyArray<Unit<Span>>;
  readonly span: Span | undefined;
  readonly speaker: string | undefined;
};

export type Gap = {
  readonly _tag: 'Gap';
  readonly track: string;
  readonly from: number;
  readonly to: number | undefined;
  readonly cause: GapCause;
  readonly message: string;
};

export type Phase = 'connecting' | 'live' | 'waiting';

export type TrackState = {
  readonly _tag: 'State';
  readonly track: string;
  readonly phase: Phase;
  readonly segment: number | undefined;
  readonly retryInMs: number | undefined;
  readonly queuedMs: number;
};

export type Heard = Utterance | Gap | TrackState | Finished;

export type Transcribed = Heard | Job;
