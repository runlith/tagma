import { Context, type Effect, type Stream } from 'effect';
import type { AccountKey } from '@runlith/llm/models/authStatus';
import type { HarnessAccountAddress } from '@runlith/tagma/adapter/provider';
import type { ExecutionRef } from '@runlith/executions/protocol/execution';
import type { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { AccountStatus, AccountRemoved, SignInBegun, SignInCompleted } from '../wire/signIns.js';

export type HarnessLaunch = HarnessAccountAddress & {
  readonly account: AccountKey;
};

export class HarnessAccounts extends Context.Service<
  HarnessAccounts,
  {
    readonly defaultSignedIn: Stream.Stream<string>;
    owns(provider: string, account: string): Effect.Effect<boolean, GateRefusal>;
    launchable(provider: string, account: string): Effect.Effect<boolean, GateRefusal | StoreFailure>;
    launch(provider: string, selected?: string): Effect.Effect<HarnessLaunch | null, GateRefusal | StoreFailure>;
    status(provider: string): Effect.Effect<readonly AccountStatus[], GateRefusal | StoreFailure>;
    begin(provider: string, projectId?: number, account?: string): Effect.Effect<SignInBegun, GateRefusal>;
    complete(provider: string, account?: string): Effect.Effect<SignInCompleted, GateRefusal | StoreFailure>;
    cancel(provider: string, account: string, execution: ExecutionRef): Effect.Effect<void, GateRefusal | StoreFailure>;
    rename(provider: string, account: string, label: string): Effect.Effect<AccountStatus, GateRefusal | StoreFailure>;
    remove(provider: string, account: string): Effect.Effect<AccountRemoved, GateRefusal | StoreFailure>;
  }
>()('tagma/providers/HarnessAccounts') {}
