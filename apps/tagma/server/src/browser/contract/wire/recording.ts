import { Schema } from 'effect';

export const RECORD_ACTIONS = ['start', 'stop'] as const;

export const RECORDING_FPS = 10;

export const RECORDING_FPS_CEILING = 30;

export const RECORDING_ENDINGS = ['stopped', 'run-ended', 'session-ended'] as const;

export const Ending = Schema.Struct({
  cause: Schema.Literals(RECORDING_ENDINGS).annotate({
    description: '`session-ended`: the page closed or the browser lost its session.',
  }),
  by: Schema.NullOr(Schema.String).annotate({
    description: 'The thread that stopped it or whose run ended; null for the operator, an outside caller or an ended session.',
  }),
});
export type Ending = typeof Ending.Type;

export const Recorded = Schema.Struct({
  path: Schema.String.annotate({ description: 'The MP4 file, H.264.' }),
  bytes: Schema.Int,
  durationMs: Schema.Int,
  width: Schema.Int.annotate({ description: 'The frame width in the file: the stream’s size, which a smaller viewer of the page lowers.' }),
  height: Schema.Int,
  fps: Schema.Int,
  ending: Ending,
});
export type Recorded = typeof Recorded.Type;
