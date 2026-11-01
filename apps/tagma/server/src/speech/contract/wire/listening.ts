import { Source } from '@runlith/audio/port/devices';
import { GapCause } from '@runlith/audio/sound/gap';
import { Schema } from 'effect';

export const TurnMode = Schema.Literals(['provider', 'client', 'none']);

export const TrackAsk = Schema.Struct({
  source: Source,
  device: Schema.optional(Schema.String),
  echoCancel: Schema.optional(Schema.Boolean),
});
export type TrackAsk = typeof TrackAsk.Type;

export const TrackPlace = Schema.Literals(['server', 'caller']);
export type TrackPlace = typeof TrackPlace.Type;

export const SENDING_PATH = '/api/speech/send';

export const SENT_FRAME_SAMPLES = 320;

export const SENT_HEADER_BYTES = 4;

export const HeardTrackAsk = Schema.Struct({ ...TrackAsk.fields, at: Schema.optional(TrackPlace) });
export type HeardTrackAsk = typeof HeardTrackAsk.Type;

export const ListeningTrack = Schema.Struct({
  id: Schema.String,
  source: Source,
  label: Schema.String,
  device: Schema.optional(Schema.String),
  echoCancel: Schema.Boolean,
});
export type ListeningTrack = typeof ListeningTrack.Type;

export const RecognizerAsk = Schema.Struct({
  provider: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  turns: Schema.optional(TurnMode),
  languages: Schema.optional(Schema.Array(Schema.String)),
  speakers: Schema.optional(Schema.Union([Schema.Boolean, Schema.Literal('prefer')])),
  account: Schema.optional(Schema.String),
});
export type RecognizerAsk = typeof RecognizerAsk.Type;

export const ModelAsk = Schema.Struct({
  provider: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  account: Schema.optional(Schema.String),
});
export type ModelAsk = typeof ModelAsk.Type;

export const RecognitionPurpose = Schema.Literal('dictation');
export type RecognitionPurpose = typeof RecognitionPurpose.Type;

export const Recognizer = Schema.Struct({
  provider: Schema.String,
  model: Schema.String,
  turns: TurnMode,
  languages: Schema.Array(Schema.String),
  speakers: Schema.Boolean,
  tuning: Schema.Record(Schema.String, Schema.Number),
  account: Schema.optional(Schema.String),
});
export type Recognizer = typeof Recognizer.Type;

export const TrackPhase = Schema.Literals(['connecting', 'live', 'waiting', 'finished', 'ended', 'failed']);
export type TrackPhase = typeof TrackPhase.Type;

export const HEARD = [
  Schema.Struct({
    kind: Schema.Literal('utterance'),
    track: Schema.String,
    segment: Schema.Int,
    seq: Schema.Int,
    revision: Schema.Int,
    closed: Schema.Boolean,
    text: Schema.String,
    hypothesis: Schema.String,
    from: Schema.NullOr(Schema.Number),
    to: Schema.NullOr(Schema.Number),
    speaker: Schema.NullOr(Schema.Int),
  }),
  Schema.Struct({
    kind: Schema.Literal('gap'),
    track: Schema.String,
    from: Schema.Number,
    to: Schema.NullOr(Schema.Number),
    cause: GapCause,
    message: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal('level'),
    track: Schema.String,
    at: Schema.Number,
    rms: Schema.Number,
    peak: Schema.Number,
  }),
  Schema.Struct({
    kind: Schema.Literal('track'),
    track: Schema.String,
    phase: TrackPhase,
    queuedMs: Schema.NullOr(Schema.Number),
    retryInMs: Schema.NullOr(Schema.Number),
    reason: Schema.NullOr(Schema.String),
  }),
] as const;

export const Heard = Schema.Union([...HEARD, Schema.Struct({ kind: Schema.Literal('state'), state: Schema.Literal('live') })]);
export type Heard = typeof Heard.Type;
