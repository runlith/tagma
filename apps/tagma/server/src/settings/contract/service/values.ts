import { Context, type Effect, type Scope, type Stream } from 'effect';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { GateRefusal, OpenRefusal } from '../../../platform/contract/wire/refusal.js';
import type { SessionRef } from '../../../platform/contract/wire/session.js';
import type { SettableScope, SettingKey, SettingLayersOf, SettingScope } from '../../../platform/contract/wire/setting.js';
import type { SettingRejection } from '../wire/catalog.js';

export type Resolved<A> = {
  readonly value: A;
  readonly from: SettingScope;
  readonly writer?: SessionRef;
  readonly layers: SettingLayersOf<A>;
  readonly rejections: readonly SettingRejection[];
};

export type SettingWriteInput = {
  readonly scope?: SettableScope;
  readonly projectId?: number;
  readonly key: string;
  readonly value?: unknown;
  readonly declined?: boolean;
};

export type SettingLandRefusal = OpenRefusal;

export type SettingWriteRefusal =
  | SettingLandRefusal
  | 'setting-conflict'
  | 'unknown-setting'
  | 'setting-managed'
  | 'setting-unapplied'
  | 'setting-scope'
  | 'setting-value';

export class Settings extends Context.Service<
  Settings,
  {
    read<A>(key: SettingKey<A>, projectId?: number): Effect.Effect<Resolved<A>, StoreFailure>;
    value<A>(key: SettingKey<A>, projectId?: number): Effect.Effect<A, StoreFailure>;
    chain(projectId?: number): Effect.Effect<<A>(key: SettingKey<A>) => A, StoreFailure>;
    live<A>(key: SettingKey<A>): Effect.Effect<() => A, StoreFailure, Scope.Scope>;
    held<A>(key: SettingKey<A>, projectId: number): Effect.Effect<() => A, StoreFailure>;
    changes<A>(key: SettingKey<A>): Effect.Effect<Stream.Stream<A>, StoreFailure, Scope.Scope>;
    write(input: SettingWriteInput): Effect.Effect<void, StoreFailure | GateRefusal<SettingWriteRefusal>>;
    amend<A, Code extends string>(
      key: SettingKey<A>,
      scope: SettableScope,
      projectId: number | undefined,
      change: (current: A) => Effect.Effect<A, GateRefusal<Code>>,
    ): Effect.Effect<void, StoreFailure | GateRefusal<Code | SettingLandRefusal | 'setting-scope' | 'setting-value'>>;
  }
>()('tagma/settings/Settings') {}
