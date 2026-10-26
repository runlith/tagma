import { Context, type Effect } from 'effect';
import type { SettableScope } from '../../../platform/contract/wire/setting.js';

export type SettingChanged = {
  readonly key: string;
  readonly scope: SettableScope;
  readonly projectId: number | null;
};

export class SettingChanges extends Context.Service<
  SettingChanges,
  {
    publish(event: SettingChanged): Effect.Effect<void>;
    subscribe(subscriber: (event: SettingChanged) => Effect.Effect<void>): () => void;
  }
>()('tagma/settings/SettingChanges') {}
