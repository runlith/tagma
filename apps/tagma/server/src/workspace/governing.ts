import { Effect } from 'effect';
import type { StoreFailure } from '../platform/contract/service/store.js';
import type { SettingKey } from '../platform/contract/wire/setting.js';
import type { Settings } from '../settings/contract/service/values.js';
import type { PlaceUnread } from './contract/service/checkoutPaths.js';

export type Governing = (at: string) => Effect.Effect<number, PlaceUnread>;

export type Locating = (at: string) => Effect.Effect<{ readonly projectId: number } | null, PlaceUnread>;

export const governingProject = (locate: Locating | null, home: number): Governing =>
  locate === null ? () => Effect.succeed(home) : (at) => Effect.map(locate(at), (place) => place?.projectId ?? home);

export type HeldSetting<A> = { readonly projectId: number; readonly value: () => A };

export const settingAt =
  <A>(settings: Settings['Service'], governing: Governing, key: SettingKey<A>, held?: HeldSetting<A>) =>
  (at: string): Effect.Effect<A, PlaceUnread | StoreFailure> =>
    Effect.flatMap(governing(at), (projectId) =>
      projectId === held?.projectId ? Effect.succeed(held.value()) : settings.value(key, projectId),
    );

export const checkoutSettingAt =
  <A>(settings: Settings['Service'], locate: Locating | null, key: SettingKey<A>, held: HeldSetting<A>, outside: A) =>
  (at: string): Effect.Effect<A, PlaceUnread | StoreFailure> =>
    locate === null
      ? Effect.sync(held.value)
      : Effect.flatMap(locate(at), (place) =>
          place === null
            ? Effect.succeed(outside)
            : place.projectId === held.projectId
              ? Effect.succeed(held.value())
              : settings.value(key, place.projectId),
        );
