import { Schema } from 'effect';

export const RECORD_ACTIONS = ['start', 'stop'] as const;

export const RECORDING_FPS = 10;

export const RECORDING_FPS_CEILING = 30;

export const Recorded = Schema.Struct({
  path: Schema.String.annotate({ description: 'The MP4 file, H.264.' }),
  bytes: Schema.Int,
  durationMs: Schema.Int,
  width: Schema.Int.annotate({ description: 'The frame width in the file: the stream’s size, which a smaller viewer of the page lowers.' }),
  height: Schema.Int,
  fps: Schema.Int,
});
export type Recorded = typeof Recorded.Type;
