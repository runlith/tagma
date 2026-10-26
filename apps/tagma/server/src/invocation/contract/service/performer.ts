import type { ToolMedia } from '@runlith/agent/tool';
import { Context, type Effect } from 'effect';
import type { Caller } from '../../../platform/contract/wire/caller.js';
import type { OperationId } from '../../../platform/contract/wire/ids.js';
import type { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { Bound } from '../../../platform/contract/service/body.js';
import type { ServedCall } from './admission.js';
import type { CallerWorkspace } from '../../../workspace/contract/service/places.js';
import type { Outcome } from '../wire/headers.js';
import type { OperationChecks } from './operationChecks.js';
import type { OperationCatalog } from './catalog.js';
import type { DynamicOperationFailure } from './refusals.js';

export type InvocationLifetime = OperationChecks | OperationCatalog;

export type CallSite<World> = {
  readonly caller: Caller;
  readonly place: CallerWorkspace['Service'];
  readonly world: World;
};

export type OwnerContext<Owners, World> = (
  caller: Caller,
  place: CallerWorkspace['Service'],
  world: World,
) => Effect.Effect<Context.Context<Owners | InvocationLifetime>, StoreFailure | GateRefusal>;

export type CallNeeds = { readonly media: boolean; readonly text: boolean };

export const ANSWER_ONLY: CallNeeds = { media: false, text: false };

export type Shaped = { readonly answer: unknown; readonly outcome: Extract<Outcome, 'answer' | 'negative'> };

export type Performed = {
  readonly value: unknown;
  readonly answer: unknown;
  readonly shaped: Shaped;
  readonly media: readonly ToolMedia[];
  readonly text: string | undefined;
};

export class OperationPerformer extends Context.Service<
  OperationPerformer,
  {
    readonly performIn: <Owners, World>(
      owners: OwnerContext<Owners, World>,
    ) => <Input, Prepared, Answer, R extends Owners | InvocationLifetime | ServedCall | CallerWorkspace, E>(
      bound: Bound<Input, Prepared, Answer, R, E>,
      input: NoInfer<Input>,
      site: CallSite<World>,
    ) => Effect.Effect<Answer, E | GateRefusal | StoreFailure, Exclude<R, Owners | InvocationLifetime | CallerWorkspace>>;
    readonly performOperatorIn: <Owners, World, Input, Prepared, Answer, E>(
      owners: OwnerContext<Owners, World>,
      bound: Bound<Input, Prepared, Answer, Owners | InvocationLifetime, E>,
      input: NoInfer<Input>,
      world: World,
    ) => Effect.Effect<Answer, E | GateRefusal | StoreFailure>;
    readonly performByIdIn: <Owners, World>(
      owners: OwnerContext<Owners, World>,
    ) => (
      id: OperationId,
      input: unknown,
      site: CallSite<World>,
      needs: CallNeeds,
    ) => Effect.Effect<Performed, DynamicOperationFailure | StoreFailure>;
  }
>()('tagma/invocation/OperationPerformer') {}
