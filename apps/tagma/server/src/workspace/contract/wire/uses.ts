import { Data, Schema } from 'effect';
import { NamespaceId } from '@runlith/files/namespace';
import { ResourceAddress } from '@runlith/files/resource';
import { UseId } from './ids.js';
import { RootBinding, RootFootprint, type RootResolutionFailure } from './roots.js';

export const UseConsumer = Schema.Struct({
  kind: Schema.NonEmptyString,
  id: Schema.NonEmptyString,
});
export type UseConsumer = typeof UseConsumer.Type;

export const UseHolder = Schema.Struct({
  useId: UseId,
  consumer: UseConsumer,
});
export type UseHolder = typeof UseHolder.Type;

export const UseMode = Schema.Literals(['shared', 'disruptive']);
export type UseMode = typeof UseMode.Type;

export const RootUse = Schema.Struct({
  useId: UseId,
  resource: ResourceAddress,
  consumer: UseConsumer,
  mode: UseMode,
  state: Schema.Literals(['held', 'released']),
  roots: Schema.Array(RootBinding),
});
export type RootUse = typeof RootUse.Type;

export const RootUseInput = Schema.Struct({
  footprint: RootFootprint,
  consumer: UseConsumer,
  mode: UseMode,
});
export type RootUseInput = typeof RootUseInput.Type;

export const RootUseSettlementInput = Schema.Struct({
  useId: UseId,
  consumer: UseConsumer,
  outcome: Schema.Literals(['unapplied', 'completed', 'uncertain', 'abandoned']),
});
export type RootUseSettlementInput = typeof RootUseSettlementInput.Type;

export class RootUseMissing extends Data.TaggedError('RootUseMissing')<{
  readonly useId: UseId;
  readonly message: string;
}> {}

export class RootUseRefused extends Data.TaggedError('RootUseRefused')<{
  readonly namespaceId: NamespaceId;
  readonly path: string;
  readonly uses: readonly RootUse[];
  readonly message: string;
}> {}

export class RootUseLost extends Data.TaggedError('RootUseLost')<{
  readonly useId: UseId;
  readonly message: string;
}> {}

export type RootUseFailure = RootResolutionFailure | RootUseMissing | RootUseRefused | RootUseLost;
