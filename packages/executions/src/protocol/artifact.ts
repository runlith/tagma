import { Schema } from 'effect';
import { ProtocolFamily } from './family';
import { NativeRelation } from './capacity';
import { Transport } from './execution';
import { Endpoint } from './endpoint';

export const CommandCapability = Schema.Struct({
  transport: Transport,
  relations: Schema.Array(NativeRelation).check(Schema.isMinLength(1)),
});
export type CommandCapability = typeof CommandCapability.Type;

export const Digest = Schema.String.check(Schema.isPattern(/^sha256:[0-9a-f]{64}$/u)).pipe(Schema.brand('Digest'));
export type Digest = typeof Digest.Type;

export const ArtifactRole = Schema.Literals([
  'runtime',
  'holder',
  'host',
  'platform',
  'carrier',
  'evidence',
  'sampler',
  'terminals',
  'recovery',
  'metadata',
]);
export type ArtifactRole = typeof ArtifactRole.Type;

export const REQUIRED_ROLES: ReadonlyArray<ArtifactRole> = [
  'runtime',
  'holder',
  'host',
  'platform',
  'carrier',
  'evidence',
  'sampler',
  'terminals',
  'recovery',
];

export const ArtifactPart = Schema.Struct({
  role: ArtifactRole,
  path: Schema.NonEmptyString,
  bytes: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  digest: Digest,
});
export type ArtifactPart = typeof ArtifactPart.Type;

export const ArtifactIdentity = Schema.Struct({
  digest: Digest,
  build: Schema.NonEmptyString,
});
export type ArtifactIdentity = typeof ArtifactIdentity.Type;

const WireVersion = Schema.Int.check(Schema.isGreaterThan(0));

export const WireRange = Schema.Struct({
  min: WireVersion,
  max: WireVersion,
}).check(Schema.makeFilter((range) => range.min <= range.max || `min ${range.min} exceeds max ${range.max}`));
export type WireRange = typeof WireRange.Type;

export const highestCommon = (left: WireRange, right: WireRange): number | undefined => {
  const top = Math.min(left.max, right.max);
  return top >= Math.max(left.min, right.min) ? top : undefined;
};

export const rangeText = (range: WireRange): string => (range.min === range.max ? `${range.min}` : `${range.min}–${range.max}`);

const Parts = Schema.Array(ArtifactPart).check(Schema.isMinLength(1));
const Commands = Schema.optional(Schema.Array(CommandCapability).check(Schema.isMinLength(1)));

export const ArtifactPlatform = Schema.Struct({
  os: Schema.NonEmptyString,
  arch: Schema.NonEmptyString,
});
export type ArtifactPlatform = typeof ArtifactPlatform.Type;

export const ArtifactContent = Schema.Struct({
  protocol: ProtocolFamily,
  platform: ArtifactPlatform,
  endpoint: Endpoint,
  wire: WireRange,
  parts: Parts,
  commands: Commands,
});
export type ArtifactContent = typeof ArtifactContent.Type;

export const ArtifactManifest = Schema.Struct({
  identity: ArtifactIdentity,
  ...ArtifactContent.fields,
});
export type ArtifactManifest = typeof ArtifactManifest.Type;

export const ARTIFACT_FILE = 'artifact.json';
export const HOLDER_ENTRY_FILE = 'holder.entry';

export const ArtifactStamp = Schema.Struct({
  identity: ArtifactIdentity,
  protocol: ProtocolFamily,
  wire: WireVersion,
  range: Schema.optional(WireRange),
});
export type ArtifactStamp = typeof ArtifactStamp.Type;

export const stampText = (stamp: ArtifactStamp): string => (stamp.range === undefined ? `${stamp.wire}` : rangeText(stamp.range));

export const identityInput = (manifest: ArtifactContent): string =>
  [
    `protocol ${manifest.protocol}`,
    `platform ${JSON.stringify([manifest.platform.os, manifest.platform.arch])}`,
    `endpoint ${JSON.stringify([manifest.endpoint.transport, manifest.endpoint.path])}`,
    `wire ${manifest.wire.min} ${manifest.wire.max}`,
    ...[...manifest.parts].map((part) => `part ${part.role} ${part.path} ${part.digest}`).sort(),
    ...(manifest.commands ?? []).map((command) => `command ${JSON.stringify([command.transport, [...command.relations].sort()])}`).sort(),
  ].join('\n');

export const containedPath = (path: string): boolean =>
  path.length > 0 &&
  !path.startsWith('/') &&
  // eslint-disable-next-line no-control-regex
  !/[\u0000-\u0020\u007f]/.test(path) &&
  path.split('/').every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
