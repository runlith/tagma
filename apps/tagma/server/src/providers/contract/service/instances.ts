import type { SettingInstance, SettingRow } from '@runlith/tagma/adapter/provider';
import type { CredentialFileFault } from '@runlith/credential-file/failure';
import { Context, type Effect } from 'effect';
import type { GateRefusal } from '../../../platform/contract/wire/refusal.js';

export type InstanceSnapshot = {
  readonly instances: ReadonlyMap<string, readonly SettingInstance[]>;
  readonly secrets: Readonly<Record<string, SettingRow>>;
};

export class AdapterInstances extends Context.Service<
  AdapterInstances,
  {
    read(): Effect.Effect<InstanceSnapshot, CredentialFileFault>;
    save(
      adapter: string,
      instance: SettingInstance,
      secrets: SettingRow,
    ): Effect.Effect<SettingInstance, CredentialFileFault | GateRefusal>;
    remove(adapter: string, id: string): Effect.Effect<void, CredentialFileFault>;
  }
>()('tagma/providers/AdapterInstances') {}
