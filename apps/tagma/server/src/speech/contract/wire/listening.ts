import { Source } from '@runlith/audio/port/devices';
import { GapCause } from '@runlith/audio/sound/gap';
import { Schema } from 'effect';

export const LISTENING_STATES = ['live', 'completed', 'interrupted'] as const;
export const ListeningState = Schema.Literals(LISTENING_STATES);
export type ListeningState = typeof ListeningState.Type;

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

export const AUDIO_STATES = ['off', 'recording', 'kept', 'expired', 'lost'] as const;
export const AudioState = Schema.Literals(AUDIO_STATES);
export type AudioState = typeof AudioState.Type;

export const AGAIN_STATES = ['queued', 'running', 'failed'] as const;
export const AgainState = Schema.Literals(AGAIN_STATES);
export type AgainState = typeof AgainState.Type;

export const Span = Schema.Struct({
  from: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
  to: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
}).annotate({ description: 'A time range of the call in milliseconds from its start.' });
export type Span = typeof Span.Type;

export const Speaker = Schema.Struct({
  number: Schema.Int,
  name: Schema.NullOr(Schema.String),
});
export type Speaker = typeof Speaker.Type;

export const ListeningAudio = Schema.Struct({
  state: AudioState,
  until: Schema.NullOr(Schema.String),
  bytes: Schema.Int,
});
export type ListeningAudio = typeof ListeningAudio.Type;

export const Follower = Schema.Struct({
  thread: Schema.String,
  projectId: Schema.Int.annotate({ description: 'The project of the following thread, which may differ from the call’s.' }),
  everyMs: Schema.Int,
  failure: Schema.NullOr(Schema.String),
});
export type Follower = typeof Follower.Type;

export const Again = Schema.Struct({
  state: AgainState,
  reason: Schema.NullOr(Schema.String),
});
export type Again = typeof Again.Type;

export const Listening = Schema.Struct({
  id: Schema.String,
  projectId: Schema.Int,
  title: Schema.NullOr(Schema.String),
  startedAt: Schema.String,
  state: ListeningState,
  durationMs: Schema.Number,
  tracks: Schema.Array(ListeningTrack),
  recognizer: Recognizer,
  utterances: Schema.Int,
  givenThrough: Schema.Int.annotate({
    description:
      'The transcript change through which the listening was given to an agent: the `change` of its lines, never a count of utterances.',
  }),
  muted: Schema.Array(Schema.String).annotate({ description: 'The tracks muted now; an ended listening mutes none.' }),
  speakers: Schema.Array(Speaker).annotate({
    description: 'The other side numbered across the whole listening; a new connection of the recognizer numbers anew.',
  }),
  marks: Schema.Int,
  gist: Schema.NullOr(Schema.String),
  audio: ListeningAudio,
  echo: Schema.Boolean.annotate({
    description: 'Whether the microphone was recorded with the echo of the speakers taken out, decided once when the call started.',
  }),
  follower: Schema.NullOr(Follower),
  again: Schema.NullOr(Again),
});
export type Listening = typeof Listening.Type;

export const Piece = Schema.Struct({
  listening: Schema.String,
  projectId: Schema.Int,
  through: Schema.Int,
  span: Schema.NullOr(Span),
  from: Schema.NullOr(Schema.Number),
  to: Schema.NullOr(Schema.Number),
  utterances: Schema.Int,
  lines: Schema.Int,
  title: Schema.String,
});
export type Piece = typeof Piece.Type;

export const PieceText = Schema.Struct({ ...Piece.fields, text: Schema.String });
export type PieceText = typeof PieceText.Type;

export const Unit = Schema.Struct({
  text: Schema.String,
  from: Schema.optional(Schema.Number),
  to: Schema.optional(Schema.Number),
  language: Schema.optional(Schema.String),
});
export type Unit = typeof Unit.Type;

export const UtteranceLine = Schema.Struct({
  kind: Schema.Literal('utterance'),
  change: Schema.Int,
  track: Schema.String,
  segment: Schema.Int,
  seq: Schema.Int,
  revision: Schema.Int,
  closed: Schema.Boolean,
  text: Schema.String,
  from: Schema.NullOr(Schema.Number),
  to: Schema.NullOr(Schema.Number),
  speaker: Schema.NullOr(Schema.Int),
  units: Schema.Array(Unit),
});
export type UtteranceLine = typeof UtteranceLine.Type;

export const GapLine = Schema.Struct({
  kind: Schema.Literal('gap'),
  change: Schema.Int,
  track: Schema.String,
  from: Schema.Number,
  to: Schema.NullOr(Schema.Number),
  cause: GapCause,
  message: Schema.String,
});
export type GapLine = typeof GapLine.Type;

export const OPERATOR = 'operator';

const by = Schema.String.annotate({ description: '`operator`, or the id of the agent thread that wrote it.' });

export const MuteLine = Schema.Struct({
  kind: Schema.Literal('mute'),
  change: Schema.Int,
  born: Schema.Int,
  track: Schema.String,
  from: Schema.Number,
  to: Schema.NullOr(Schema.Number),
  by,
});
export type MuteLine = typeof MuteLine.Type;

export const MarkLine = Schema.Struct({
  kind: Schema.Literal('mark'),
  change: Schema.Int,
  born: Schema.Int.annotate({ description: 'The change the mark was born under; it names the mark to mark_listening.' }),
  at: Schema.Number,
  text: Schema.NullOr(Schema.String),
  by,
  removed: Schema.Boolean,
});
export type MarkLine = typeof MarkLine.Type;

export const Line = Schema.Union([UtteranceLine, GapLine, MuteLine, MarkLine]);
export type Line = typeof Line.Type;

export const Given = Schema.Struct({
  thread: Schema.String,
  projectId: Schema.Int,
  through: Schema.Int,
  span: Schema.NullOr(Span),
  at: Schema.String,
}).annotate({ description: 'A piece that went to a thread: without `span` it reached through the change `through`.' });
export type Given = typeof Given.Type;

export const ListeningDetail = Schema.Struct({
  listening: Listening,
  summary: Schema.NullOr(Schema.String),
  marks: Schema.Array(MarkLine),
  given: Schema.Array(Given),
});
export type ListeningDetail = typeof ListeningDetail.Type;

export const TrackPhase = Schema.Literals(['connecting', 'live', 'waiting', 'finished', 'ended', 'failed']);
export type TrackPhase = typeof TrackPhase.Type;

const HEARD = [
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

export const ListeningEvent = Schema.Union([
  ...HEARD,
  Schema.Struct({ kind: Schema.Literal('state'), state: ListeningState }),
  Schema.Struct({ kind: Schema.Literal('listing'), listening: Listening }),
]);
export type ListeningEvent = typeof ListeningEvent.Type;
