import { Context, type Effect } from 'effect';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { WriteUnit } from '../../../platform/contract/service/units.js';
import type { WriteSet } from '../../../platform/contract/service/writes.js';
import type { SettingKey } from '../../../platform/contract/wire/setting.js';

export type SettingLanding = {
  within<A, E>(
    unit: WriteUnit<'graph'>,
    key: SettingKey<unknown>,
    projectId: number | null,
    landing: Effect.Effect<A, E>,
  ): Effect.Effect<A, E | StoreFailure>;
  committed(announce: Effect.Effect<void>): Effect.Effect<void>;
};

export class SettingReaction extends Context.Service<
  SettingReaction,
  {
    readonly reach: WriteSet;
    open(): SettingLanding;
  }
>()('tagma/settings/SettingReaction') {}
