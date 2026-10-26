import { Context, type Effect, type Layer } from 'effect';
import type { SignInMethod } from '@runlith/llm/oauth/vendor';
import type { HttpClient } from 'effect/http';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import type {
  AccountRemoved,
  AccountStatus,
  ConsoleKeyRemoved,
  ConsoleKeySaved,
  ConsoleKeys,
  SignInBegun,
  SignInCompleted,
  SignInStatus,
} from '../wire/signIns.js';

type Refused = GateRefusal | StoreFailure;

export class SignIns extends Context.Service<
  SignIns,
  {
    status(): Effect.Effect<SignInStatus, Refused>;
    begin(provider: string, projectId?: number, account?: string, method?: SignInMethod): Effect.Effect<SignInBegun, Refused>;
    complete(provider: string, account?: string, code?: string): Effect.Effect<SignInCompleted, Refused>;
    remove(provider: string, account: string): Effect.Effect<AccountRemoved, Refused>;
    rename(provider: string, account: string, label: string): Effect.Effect<AccountStatus, Refused>;
    keepCredential(provider: string, credential: unknown): Effect.Effect<AccountStatus, Refused>;
    saveConsoleKey(provider: string, key: string, replaces?: string): Effect.Effect<ConsoleKeySaved, Refused>;
    removeConsoleKey(provider: string, account: string): Effect.Effect<ConsoleKeyRemoved, Refused>;
    consoleKeys(): Effect.Effect<ConsoleKeys, Refused>;
  }
>()('tagma/providers/SignIns') {}

export class VendorWires extends Context.Service<VendorWires, { readonly wire: Layer.Layer<HttpClient.HttpClient> }>()(
  'tagma/providers/VendorWires',
) {}
