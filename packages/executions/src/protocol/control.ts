import { Schema } from 'effect';
import { CustodyRevision, CustodyState, Principal } from './custody';
import { ExecutionRef, HostRequestRef } from './execution';
import { Refusal, UncertainEffect } from './host';
import { InputFrontier } from './input';

export const CustodyTransfer = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal('Transfer'),
    holder: Principal,
  }),
]).pipe(Schema.toTaggedUnion('_tag'));
export type CustodyTransfer = typeof CustodyTransfer.Type;

export const CustodyRequest = Schema.Struct({
  operation: HostRequestRef,
  execution: ExecutionRef,
  expected: CustodyRevision,
  act: CustodyTransfer,
});
export type CustodyRequest = typeof CustodyRequest.Type;

export const CustodyReceipt = Schema.Struct({
  operation: HostRequestRef,
  execution: ExecutionRef,
  custody: CustodyState,
  frontier: InputFrontier,
});
export type CustodyReceipt = typeof CustodyReceipt.Type;

export const CustodyAnswer = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal('Accepted'), receipt: CustodyReceipt }),
  Schema.Struct({ _tag: Schema.Literal('Standing'), receipt: CustodyReceipt, custody: CustodyState }),
  Schema.Struct({
    _tag: Schema.Literal('RevisionStale'),
    execution: ExecutionRef,
    expected: CustodyRevision,
    custody: CustodyState,
  }),
  Schema.Struct({ _tag: Schema.Literal('Refused'), operation: HostRequestRef, refusal: Refusal }),
  Schema.Struct({ _tag: Schema.Literal('Uncertain'), effect: UncertainEffect }),
]).pipe(Schema.toTaggedUnion('_tag'));
export type CustodyAnswer = typeof CustodyAnswer.Type;
