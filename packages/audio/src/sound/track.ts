import { type Effect, Schema, type Stream } from 'effect';
import type { Chunk } from './chunk.ts';
import type { Format } from './format.ts';
import type { Gap } from './gap.ts';

export const EndReason = Schema.Literals(['drained', 'aborted', 'released', 'device-lost', 'failed', 'helper-lost', 'sender-lost']);
export type EndReason = Schema.Schema.Type<typeof EndReason>;

export type Ended = {
  readonly _tag: 'Ended';
  readonly reason: EndReason;
};

export type Sound = Chunk | Gap | Ended;

export type Track = {
  readonly format: Format;
  readonly chunks: Stream.Stream<Sound>;
  readonly end: Effect.Effect<void>;
};

export const ended = (reason: EndReason): Ended => ({ _tag: 'Ended', reason });
