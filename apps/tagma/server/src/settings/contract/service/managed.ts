import { Context, type Effect, type Scope } from 'effect';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { WriteUnit } from '../../../platform/contract/service/units.js';
import type { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import type { SettableScope, SettingKey } from '../../../platform/contract/wire/setting.js';
import type { SettingLandRefusal } from './values.js';

export type ManagedWriteInput<A> = {
  readonly key: SettingKey<A>;
  readonly scope: SettableScope;
  readonly projectId: number | null;
  readonly value?: unknown;
  readonly declined: boolean;
  readonly declinedGiven?: boolean;
  readonly pinned?: boolean;
  readonly kept?: boolean;
  readonly resolved: A;
};

export type ManagedWriteRefusal = SettingLandRefusal | 'setting-conflict' | 'setting-managed' | 'setting-unapplied' | 'setting-value';

export type ManagedWriter<A> = (input: ManagedWriteInput<A>) => Effect.Effect<void, StoreFailure | GateRefusal<ManagedWriteRefusal>>;

export type SettingWritten = { readonly announce: Effect.Effect<void> };

export class ManagedWrite extends Context.Service<
  ManagedWrite,
  {
    register<A>(key: SettingKey<A>, writer: ManagedWriter<A>): Effect.Effect<void, never, Scope.Scope>;
    write<A>(unit: WriteUnit<'graph'>, input: ManagedWriteInput<A>): Effect.Effect<SettingWritten, StoreFailure>;
  }
>()('tagma/settings/ManagedWrite') {}
