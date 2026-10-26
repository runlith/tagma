import { Schema } from 'effect';
import { endpoint } from '../../../platform/contract/wire/operation.js';

export const DEVICE_COOKIE = '__Host-tagma-device';

export const DEVICE_TERM_DAYS = 180;

export const PAIRING_MINUTES = 5;

export const DEVICE_REVOKED_CLOSE = 4401;

export const PAIRING_ENDPOINT = endpoint('access.pair', { method: 'POST', path: '/api/access/pair' });

export const ACCESS_REFUSALS = ['device-unpaired', 'device-revoked', 'origin-refused'] as const;
export type AccessRefusal = (typeof ACCESS_REFUSALS)[number];

export const PAIRING_REFUSALS = ['pairing-refused', 'pairing-throttled', 'origin-refused', 'remote-off'] as const;
export type PairingRefusal = (typeof PAIRING_REFUSALS)[number];

export const ACCESS_PROBLEMS = [
  'not-installed',
  'signed-out',
  'https-off',
  'needs-operator',
  'port-taken',
  'origin-taken',
  'funnel-on',
  'listener-failed',
  'refused',
] as const;
export type AccessProblem = (typeof ACCESS_PROBLEMS)[number];

export const Blocked = Schema.Struct({
  _tag: Schema.Literal('blocked'),
  problem: Schema.Literals(ACCESS_PROBLEMS),
  detail: Schema.String,
  command: Schema.NullOr(Schema.String),
  link: Schema.NullOr(Schema.String),
});
export type Blocked = typeof Blocked.Type;

export const AccessState = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal('off') }),
  Schema.Struct({ _tag: Schema.Literal('setting-up') }),
  Schema.Struct({ _tag: Schema.Literal('certificate'), origin: Schema.String }),
  Schema.Struct({ _tag: Schema.Literal('ready'), origin: Schema.String }),
  Blocked,
]).pipe(Schema.toTaggedUnion('_tag'));
export type AccessState = typeof AccessState.Type;

export const Device = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  pairedAt: Schema.String,
  lastSeenAt: Schema.NullOr(Schema.String),
});
export type Device = typeof Device.Type;

export const Pairing = Schema.Struct({
  code: Schema.String,
  expiresAt: Schema.String,
  url: Schema.String,
});
export type Pairing = typeof Pairing.Type;

export const PairingInput = Schema.Struct({ code: Schema.String });

export const PairedAnswer = Schema.Struct({ device: Device, machine: Schema.String });
export type PairedAnswer = typeof PairedAnswer.Type;
