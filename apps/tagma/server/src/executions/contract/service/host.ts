import { Context, Data, type Effect } from 'effect';
import type { Digest } from '@runlith/executions/protocol/artifact';
import type { HostLifetime } from '@runlith/executions/protocol/boot';
import type { HostMemory } from '@runlith/executions/protocol/runtime';
import type { ProcessWitness } from '@runlith/executions/protocol/evidence';
import type { HostConnection } from '../../host/connection.js';
import type { TerminalGeometry } from '@runlith/executions/protocol/record';
import type { MigrationChain } from '../../../platform/contract/service/store.js';
import type { HostBoot } from '../../host/boot.js';

export type OfferSource =
  | { readonly _tag: 'Checkout'; readonly path: string; readonly build: string }
  | { readonly _tag: 'Closure'; readonly path: string };

export class HostPreparationRefused extends Data.TaggedError('HostPreparationRefused')<{ readonly detail: string }> {}

export type HostOffer =
  | { readonly _tag: 'Offered'; readonly digest: Digest; readonly detail: string }
  | { readonly _tag: 'Unoffered'; readonly detail: string };

export type HostPlacement =
  | { readonly _tag: 'Vacant'; readonly detail: string }
  | { readonly _tag: 'Standing'; readonly digest: Digest; readonly detail: string }
  | { readonly _tag: 'Placed'; readonly digest: Digest; readonly bundle: boolean; readonly detail: string };

export type YieldAsk = { readonly _tag: 'Asked' } | { readonly _tag: 'Gone' } | { readonly _tag: 'Unasked'; readonly detail: string };

export class LogicYield extends Context.Service<
  LogicYield,
  {
    readonly ask: (logic: ProcessWitness) => Effect.Effect<YieldAsk>;
  }
>()('tagma/executions/LogicYield') {}

export type ClaimHolding =
  | { readonly _tag: 'Holders'; readonly pids: ReadonlyArray<number> }
  | { readonly _tag: 'Unread'; readonly detail: string };

export class ClaimHolders extends Context.Service<
  ClaimHolders,
  {
    readonly of: (claim: string) => Effect.Effect<ClaimHolding>;
  }
>()('tagma/executions/ClaimHolders') {}

export type HostStanding = {
  readonly boot: HostBoot;
  readonly custodian: boolean;
  readonly detail: string;
  readonly geometry: TerminalGeometry;
  readonly notice: string | null;
  readonly stays?: string;
};

export class HostManagement extends Context.Service<
  HostManagement,
  {
    readonly standing: Effect.Effect<HostStanding>;
    readonly connection: HostConnection;
  }
>()('tagma/executions/HostManagement') {}

export class HostOffering extends Context.Service<
  HostOffering,
  {
    readonly source: OfferSource | undefined;
    readonly placed?: HostPlacement;
    readonly replacing?: boolean;
    readonly hostEnded?: (executions: number | undefined, detail: string) => Effect.Effect<void>;
    readonly migrations: MigrationChain<'machine'>;
    readonly programVersion: string;
    readonly lifetime?: HostLifetime;
    readonly takenAfter?: Effect.Effect<void>;
  }
>()('tagma/executions/HostOffering') {}

export class ExecutionHost extends Context.Service<
  ExecutionHost,
  {
    readonly ledger: () => Effect.Effect<HostMemory | undefined>;
    readonly offersCommands: () => Effect.Effect<boolean>;
  }
>()('tagma/executions/ExecutionHost') {}
