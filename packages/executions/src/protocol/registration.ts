import { Schema } from 'effect';
import { ArtifactStamp } from './artifact';
import { Endpoint } from './endpoint';
import { ProcessWitness } from './evidence';
import { Incarnation, InstallationId } from './execution';
import { ProtocolFamily } from './family';

export const REGISTRATION_FILE = 'registration.json';
export const PERFORMANCE_FILE = 'performance.sqlite';

export const Role = Schema.Literals(['custodian', 'recovery']);
export type Role = typeof Role.Type;

export const ConnectionId = Schema.NonEmptyString.pipe(Schema.brand('ConnectionId'));
export type ConnectionId = typeof ConnectionId.Type;

export const CustodianEpoch = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER));
export type CustodianEpoch = typeof CustodianEpoch.Type;

export const HostCustodyRevision = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER));
export type HostCustodyRevision = typeof HostCustodyRevision.Type;

export const CustodyHolder = Schema.Struct({
  connection: ConnectionId,
  incarnation: Incarnation,
});
export type CustodyHolder = typeof CustodyHolder.Type;

export const HostCustody = Schema.Struct({
  revision: HostCustodyRevision,
  epoch: CustodianEpoch,
  holder: Schema.optional(CustodyHolder),
});
export type HostCustody = typeof HostCustody.Type;

export const AdmissionPhase = Schema.Literals(['open', 'fenced', 'stopping', 'closed']);
export type AdmissionPhase = typeof AdmissionPhase.Type;

const reach: Record<AdmissionPhase, number> = { open: 0, fenced: 1, stopping: 2, closed: 3 };
export const narrower = (phase: AdmissionPhase, next: AdmissionPhase): AdmissionPhase => (reach[next] > reach[phase] ? next : phase);

export const closing = (phase: AdmissionPhase): boolean => reach[phase] >= reach.stopping;

export const CredentialReferences = Schema.Struct({
  custodian: Schema.NonEmptyString,
  recovery: Schema.NonEmptyString,
});
export type CredentialReferences = typeof CredentialReferences.Type;

export const RegistrationIdentity = Schema.Struct({
  installation: InstallationId,
  protocol: ProtocolFamily,
  endpoint: Endpoint,
  credentials: CredentialReferences,
});
export type RegistrationIdentity = typeof RegistrationIdentity.Type;

export const Registration = Schema.Struct({
  version: Schema.Literal(1),
  state: Schema.NonEmptyString,
  ...RegistrationIdentity.fields,
  artifact: Schema.optional(ArtifactStamp),
  logic: Schema.optional(ProcessWitness),
});
export type Registration = typeof Registration.Type;

export const sameIdentity = (a: RegistrationIdentity, b: RegistrationIdentity): boolean =>
  a.installation === b.installation &&
  a.protocol === b.protocol &&
  a.endpoint.transport === b.endpoint.transport &&
  a.endpoint.path === b.endpoint.path &&
  a.credentials.custodian === b.credentials.custodian &&
  a.credentials.recovery === b.credentials.recovery;
