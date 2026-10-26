import { Context, type Effect, type Scope } from 'effect';
import type * as ProcessVitals from '@runlith/performance/ProcessVitals';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { SettingKey } from '../../../platform/contract/wire/setting.js';

export const PERFORMANCE_DATABASE = 'performance.sqlite';

export class PerformancePlace extends Context.Service<
  PerformancePlace,
  {
    readonly instanceId: string;
    readonly databasePath: string;
    readonly units: ReadonlySet<string>;
    readonly profileWindowMs?: () => number;
    readonly spanFloorMicros?: () => number;
    readonly memoryCeiling?: ProcessVitals.MemoryCeiling;
  }
>()('tagma/performance/PerformancePlace') {}

export class LiveSettings extends Context.Service<
  LiveSettings,
  {
    live<A>(key: SettingKey<A>): Effect.Effect<() => A, StoreFailure, Scope.Scope>;
  }
>()('tagma/performance/LiveSettings') {}
