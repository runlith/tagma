import { Schema } from 'effect';
import { ExecutionTargetRef } from './execution';

export const Principal = Schema.NonEmptyString.pipe(Schema.brand('Principal'));
export type Principal = typeof Principal.Type;

export const BindingId = Schema.NonEmptyString.pipe(Schema.brand('BindingId'));
export type BindingId = typeof BindingId.Type;

export const CustodyRevision = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
export type CustodyRevision = typeof CustodyRevision.Type;

export const CustodyState = Schema.Struct({
  revision: CustodyRevision,
  holder: Principal,
  origin: Principal,
  target: ExecutionTargetRef,
});
export type CustodyState = typeof CustodyState.Type;
