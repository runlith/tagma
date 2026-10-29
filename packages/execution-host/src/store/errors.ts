import type { MigratorInitError, EffectDrizzleQueryError } from 'drizzle-orm/effect-core/errors';
import { Data } from 'effect';
import type { SqlError } from 'effect/sql/SqlError';
import type { CustodianEpoch, HostCustody, HostCustodyRevision } from '@runlith/executions/protocol/registration';
import type { CleanupObligation } from '@runlith/executions/protocol/host';
import type { HostRequestRef, Incarnation } from '@runlith/executions/protocol/execution';

export class StoreLost extends Data.TaggedError('StoreLost')<{
  readonly reason: string;
  readonly cleanup: CleanupObligation;
}> {}

export class IncarnationRefused extends Data.TaggedError('IncarnationRefused')<{
  readonly named: Incarnation;
  readonly current: Incarnation;
}> {}

export class OperationConflict extends Data.TaggedError('OperationConflict')<{
  readonly operation: string;
}> {}

export class RevisionConflict extends Data.TaggedError('RevisionConflict')<{
  readonly execution: string;
  readonly expected: number;
}> {}

export class CustodyConflict extends Data.TaggedError('CustodyConflict')<{
  readonly expected: HostCustodyRevision;
  readonly standing: HostCustody;
}> {}

export class CustodyRefused extends Data.TaggedError('CustodyRefused')<{
  readonly revision: HostCustodyRevision;
  readonly epoch: CustodianEpoch;
}> {}

export class CustodyLost extends Data.TaggedError('CustodyLost')<{
  readonly operation: HostRequestRef;
  readonly reason: string;
}> {}

export class StoredExecutionMissing extends Data.TaggedError('StoredExecutionMissing')<{
  readonly execution: string;
}> {}

export class StoreUnreadable extends Data.TaggedError('StoreUnreadable')<{
  readonly record: string;
  readonly key: string;
  readonly reason: string;
}> {}

export class StoreAhead extends Data.TaggedError('StoreAhead')<{
  readonly detail: string;
}> {
  override get message(): string {
    return this.detail;
  }
}

export type StoreFailure = EffectDrizzleQueryError | SqlError;

export type StoreOpenFailure = StoreFailure | MigratorInitError | StoreAhead;
