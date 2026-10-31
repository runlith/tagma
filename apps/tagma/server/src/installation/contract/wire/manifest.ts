import { Data, Schema } from 'effect';
import { Digest } from '@runlith/executions/protocol/artifact';
import {
  hostBundle,
  RIPGREP_PART,
  RUNTIME_PART,
  SILERO_PART,
  TYPESCRIPT_PART,
  WHISPER_ABSENCE_PART,
  WHISPER_ENGINE_PART,
} from './layout.js';

export const InstallationRole = Schema.Literals(['runtime', 'cli', 'server', 'migrations', 'surface', 'executions']);
export type InstallationRole = typeof InstallationRole.Type;

export const REQUIRED_ROLES: ReadonlyArray<InstallationRole> = ['runtime', 'cli', 'server', 'migrations', 'surface', 'executions'];

export const SERVER_ENTRY = 'bin/server/http.js';
export const EVIDENCE_MIGRATIONS = 'bin/drizzle';
export const ACTIVITY_MIGRATIONS = 'bin/activity';
export const STORE_MIGRATIONS = 'bin/stores';
export const NATIVE_MODULES = 'node_modules';
export const PACKAGE_FILE = 'package.json';
export const MIGRATIONS = 'drizzle';
export const SKILLS = 'skills';
export const SURFACE = 'surface';
export const DESKTOP = 'desktop';
export const releaseApplication = (root: string, name: string): string => `${root}/${DESKTOP}/${hostBundle(name)}`;
export const EXECUTIONS = 'executions';

export const CLOSURE_LAYOUT: ReadonlyArray<readonly [InstallationRole, string]> = [
  ['runtime', RUNTIME_PART],
  ['server', SKILLS],
  ['server', PACKAGE_FILE],
  ['server', NATIVE_MODULES],
  ['server', RIPGREP_PART],
  ['server', TYPESCRIPT_PART],
  ['migrations', MIGRATIONS],
  ['migrations', EVIDENCE_MIGRATIONS],
  ['migrations', ACTIVITY_MIGRATIONS],
  ['surface', SURFACE],
  ['executions', EXECUTIONS],
];

export const ENGINE_LAYOUT: ReadonlyArray<readonly [InstallationRole, string]> = [
  ['server', WHISPER_ENGINE_PART],
  ['server', SILERO_PART],
];

export const ENGINE_ABSENCE_LAYOUT: ReadonlyArray<readonly [InstallationRole, string]> = [['server', WHISPER_ABSENCE_PART]];

export const InstallationPart = Schema.Struct({
  role: InstallationRole,
  path: Schema.NonEmptyString,
  kind: Schema.Literals(['file', 'link']),
  bytes: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  digest: Digest,
});
export type InstallationPart = typeof InstallationPart.Type;

export const InstallationPlatform = Schema.Struct({
  os: Schema.NonEmptyString,
  arch: Schema.NonEmptyString,
});
export type InstallationPlatform = typeof InstallationPlatform.Type;

export const InstallationIdentity = Schema.Struct({
  digest: Digest,
  build: Schema.NonEmptyString,
  tree: Schema.optional(Schema.NonEmptyString),
});
export type InstallationIdentity = typeof InstallationIdentity.Type;

export const InstallationProvenance = Schema.Struct({ checkout: Schema.NonEmptyString });
export type InstallationProvenance = typeof InstallationProvenance.Type;

export const IRREVERSIBLE_STORES = ['machine-store', 'host-store', 'graph', 'journal'] as const;

export const IrreversibleChange = Schema.Struct({
  store: Schema.Literals(IRREVERSIBLE_STORES),
  release: Schema.NonEmptyString,
});
export type IrreversibleChange = typeof IrreversibleChange.Type;

export const InstallationManifest = Schema.Struct({
  version: Schema.Literal(1),
  identity: InstallationIdentity,
  platform: InstallationPlatform,
  origin: Schema.optional(InstallationProvenance),
  irreversible: Schema.optional(Schema.Array(IrreversibleChange)),
  parts: Schema.Array(InstallationPart).check(Schema.isMinLength(1)),
});
export type InstallationManifest = typeof InstallationManifest.Type;

export class InstallationMissing extends Data.TaggedError('InstallationMissing')<{ readonly root: string }> {}

export class InstallationInvalid extends Data.TaggedError('InstallationInvalid')<{
  readonly root: string;
  readonly reason: 'mismatch' | 'malformed';
  readonly detail?: string | undefined;
  readonly role?: string | undefined;
  readonly path?: string | undefined;
  readonly expected?: string | undefined;
  readonly found?: string | undefined;
}> {}

export class InstallationUnreadable extends Data.TaggedError('InstallationUnreadable')<{
  readonly root: string;
  readonly role: string;
  readonly path: string;
  readonly detail: string;
}> {}

export type InstallationFailure = InstallationMissing | InstallationInvalid | InstallationUnreadable;

export type Installation = {
  readonly root: string;
  readonly manifest: InstallationManifest;
};

export type CurrentInstallation = {
  readonly runsFrom: Installation | undefined;
  readonly handsOut: Installation | undefined;
  readonly unreadable: InstallationFailure | undefined;
};
