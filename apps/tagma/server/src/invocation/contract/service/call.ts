import type { Context } from 'effect';
import type { Caller } from '../../../platform/contract/wire/caller.js';
import type { OperationChecks } from './operationChecks.js';
import type { OperationCatalog } from './catalog.js';

export type LifetimeServices<R> = Context.Context<R | OperationChecks | OperationCatalog>;

export type Call<R> = {
  readonly caller: Caller;
  readonly lifetimes: LifetimeServices<R>;
};
