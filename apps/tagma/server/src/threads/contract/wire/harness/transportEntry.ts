import { Schema } from 'effect';

export const TRANSPORT_ENTRY = 'transport';

export const transportRoadSchema = Schema.Literals(['native', 'acp', 'terminal']);
export type TransportRoad = typeof transportRoadSchema.Type;
export const isTransportRoad = Schema.is(transportRoadSchema);

export const TransportEntry = Schema.Struct({
  type: Schema.Literal(TRANSPORT_ENTRY),
  id: Schema.NonEmptyString,
  from: Schema.NullOr(transportRoadSchema),
  to: transportRoadSchema,
  occurredAt: Schema.String,
});
export type TransportEntry = typeof TransportEntry.Type;

export const isTransportEntry = Schema.is(TransportEntry);
