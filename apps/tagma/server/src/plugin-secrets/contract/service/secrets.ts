import { Context, type Effect } from 'effect';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import type { PluginSecretSet, SecretChangeRefusal, SecretReadRefusal, SecretRemoveRefusal, SecretRow } from '../wire/rows.js';

export type SecretTarget = { readonly projectId: number; readonly plugin: string; readonly name: string };

export class PluginSecrets extends Context.Service<
  PluginSecrets,
  {
    read(projectId: number): Effect.Effect<readonly PluginSecretSet[], StoreFailure | GateRefusal<SecretReadRefusal>>;
    set(target: SecretTarget, value: string): Effect.Effect<SecretRow, StoreFailure | GateRefusal<SecretChangeRefusal>>;
    remove(target: SecretTarget): Effect.Effect<SecretRow, StoreFailure | GateRefusal<SecretRemoveRefusal>>;
  }
>()('tagma/plugin-secrets/PluginSecrets') {}
