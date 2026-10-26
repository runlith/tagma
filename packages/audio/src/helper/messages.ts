import { Schema } from 'effect';
import { Device, OutputKind, Permissions, Source } from '../port/devices.ts';
import { MarkOutcome } from '../port/player.ts';
import { Format } from '../sound/format.ts';

export const playbackWindowMs = 1000;

export const ResourceId = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 0xffff_ffff }));

const Nanos = Schema.BigIntFromString;
const type = <T extends string>(name: T) => Schema.Literal(name);

export const HelperRefusal = Schema.Literals(['permission-denied', 'device-missing', 'unsupported', 'helper-mismatch', 'device-failed']);
export type HelperRefusal = Schema.Schema.Type<typeof HelperRefusal>;
export const HelperGapCause = Schema.Literals(['overflow', 'device-change', 'device-lost']);
export const HelperEndReason = Schema.Literals(['drained', 'aborted', 'released', 'device-lost', 'failed']);

export const Hello = Schema.Struct({ type: type('hello'), token: Schema.String, nowNs: Nanos });
export const DeviceList = Schema.Struct({ type: type('devices'), list: Schema.Array(Device), permissions: Permissions });
export const Output = Schema.Struct({ type: type('output'), kind: OutputKind });
export const Ready = Schema.Struct({ type: type('ready'), id: ResourceId, format: Schema.optional(Format) });
export const Refused = Schema.Struct({
  type: type('refused'),
  id: Schema.optional(ResourceId),
  code: HelperRefusal,
  message: Schema.String,
});
export const GapMessage = Schema.Struct({
  type: type('gap'),
  id: ResourceId,
  fromNs: Nanos,
  toNs: Schema.optional(Nanos),
  cause: HelperGapCause,
});
export const End = Schema.Struct({ type: type('end'), id: ResourceId, reason: HelperEndReason });
export const Played = Schema.Struct({
  type: type('played'),
  id: ResourceId,
  ms: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
});
export const Marked = Schema.Struct({ type: type('marked'), id: ResourceId, mark: Schema.String, outcome: MarkOutcome });

export const HelperMessage = Schema.Union([Hello, DeviceList, Output, Ready, Refused, GapMessage, End, Played, Marked]);
export type HelperMessage = Schema.Schema.Type<typeof HelperMessage>;

const idOnly = <T extends string>(name: T) => Schema.Struct({ type: type(name), id: ResourceId });

export const ClientMessage = Schema.Union([
  Schema.Struct({ type: type('devices') }),
  Schema.Struct({ type: type('output') }),
  Schema.Struct({
    type: type('capture'),
    id: ResourceId,
    source: Source,
    device: Schema.optional(Schema.String),
    echoCancel: Schema.Boolean,
  }),
  idOnly('stop'),
  idOnly('abort'),
  Schema.Struct({ type: type('play'), id: ResourceId, format: Format }),
  Schema.Struct({ type: type('mark'), id: ResourceId, mark: Schema.String }),
  idOnly('clear'),
  idOnly('release'),
  idOnly('mute'),
  idOnly('unmute'),
  Schema.Struct({ type: type('quit') }),
]);
export type ClientMessage = Schema.Schema.Type<typeof ClientMessage>;
