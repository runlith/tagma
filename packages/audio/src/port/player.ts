import { type Effect, Schema } from 'effect';
import type { Format } from '../sound/format.ts';
import type { DeviceRefused } from './refusal.ts';

export const MarkOutcome = Schema.Literals(['played', 'cleared']);
export type MarkOutcome = Schema.Schema.Type<typeof MarkOutcome>;

export type Player = {
  readonly format: Format;
  readonly write: (pcm: Int16Array) => Effect.Effect<void, DeviceRefused>;
  readonly mark: (id: string) => Effect.Effect<Effect.Effect<MarkOutcome>, DeviceRefused>;
  readonly clear: Effect.Effect<void>;
};
