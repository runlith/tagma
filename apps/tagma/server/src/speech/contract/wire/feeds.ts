import { Schema } from 'effect';
import { Source } from '@runlith/audio/port/devices';
import { feed } from '../../../platform/contract/wire/operation.js';
import { Heard, HeardTrackAsk, Line, RecognitionPurpose, RecognizerAsk, TrackPlace } from './listening.js';
import { SpeakAsk, Synthesized } from './speaking.js';

const projectId = Schema.Int.check(Schema.isGreaterThan(0));

export const LISTENING_FEED = feed('speech.listening.subscribe', {
  input: Schema.Struct({ projectId, listening: Schema.String }),
  event: Heard,
  refusals: ['unknown-listening'],
  callers: 'any',
  admission: 'project',
});

export const TRANSCRIPT_FEED = feed('speech.transcript.subscribe', {
  input: Schema.Struct({
    projectId,
    listening: Schema.String,
    after: Schema.optional(Schema.Int),
    stay: Schema.optional(Schema.Boolean).annotate({
      description: 'Keep the feed open past the confirmed tail of an ended listening, to hear its later marks and corrections.',
    }),
  }),
  event: Line,
  refusals: ['unknown-listening'],
  callers: 'any',
  admission: 'project',
});

export const RECOGNIZE_FEED = feed('speech.recognize', {
  input: Schema.Struct({
    id: Schema.String.check(Schema.isMinLength(1)),
    tracks: Schema.Array(HeardTrackAsk).check(Schema.isMinLength(1), Schema.isMaxLength(4)),
    recognizer: Schema.optional(RecognizerAsk),
    purpose: Schema.optional(RecognitionPurpose),
  }),
  event: Heard,
  refusals: ['no-model', 'capture-refused', 'track-invalid'],
  callers: 'operator',
});

export const InstallProgress = Schema.Struct({
  model: Schema.String,
  received: Schema.Number,
  total: Schema.Number,
  failure: Schema.NullOr(Schema.String),
});
export type InstallProgress = typeof InstallProgress.Type;

export const InstallEvent = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('snapshot'), installs: Schema.Array(InstallProgress) }),
  Schema.Struct({ kind: Schema.Literal('progress'), ...InstallProgress.fields }),
  Schema.Struct({ kind: Schema.Literal('removed'), model: Schema.String }),
]);
export type InstallEvent = typeof InstallEvent.Type;

export const INSTALL_FEED = feed('speech.install.subscribe', {
  input: Schema.Struct({}),
  event: InstallEvent,
  refusals: [],
  callers: 'operator',
});

export const CaptureKind = Schema.Literals(['listening', 'recognition']);
export type CaptureKind = typeof CaptureKind.Type;

export const Capture = Schema.Struct({
  kind: CaptureKind,
  id: Schema.String,
  projectId: Schema.NullOr(Schema.Int),
  sources: Schema.Array(Source),
  at: TrackPlace,
  startedAt: Schema.String,
});
export type Capture = typeof Capture.Type;

export const CapturesEvent = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('snapshot'), captures: Schema.Array(Capture) }),
  Schema.Struct({ kind: Schema.Literal('opened'), capture: Capture }),
  Schema.Struct({ kind: Schema.Literal('ended'), capture: Schema.Struct({ kind: CaptureKind, id: Schema.String }) }),
]);
export type CapturesEvent = typeof CapturesEvent.Type;

export const CAPTURES_FEED = feed('speech.captures.subscribe', {
  input: Schema.Struct({}),
  event: CapturesEvent,
  refusals: [],
  callers: 'operator',
});

export const SYNTHESIS_FEED = feed('speech.synthesize', {
  input: SpeakAsk,
  event: Synthesized,
  refusals: ['no-model', 'speech-failed'],
  callers: 'operator',
});

export const SPEECH_FEEDS = [LISTENING_FEED, TRANSCRIPT_FEED, RECOGNIZE_FEED, INSTALL_FEED, CAPTURES_FEED, SYNTHESIS_FEED] as const;
