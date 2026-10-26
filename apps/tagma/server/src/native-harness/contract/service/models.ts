import { Context, type Effect } from 'effect';
import type { HarnessFailure } from '../../../threads/contract/service/failure.js';
import type { FavoriteModels, ModelDefaults, ModelDefaultsWrite, ThreadModelSettings } from '../wire/modelSelection.js';
import type { ModelPreference } from '../../../threads/contract/wire/birth.js';
import type { NativeThreadSnapshot } from '../../../threads/contract/service/state.js';

export class ModelPreferences extends Context.Service<
  ModelPreferences,
  {
    modelDefaults(): Effect.Effect<ModelDefaults, HarnessFailure>;
    setModelDefaults(selection: ModelDefaultsWrite): Effect.Effect<ModelPreference, HarnessFailure>;
    favoriteModels(): Effect.Effect<FavoriteModels, HarnessFailure>;
    setFavoriteModels(favorites: FavoriteModels): Effect.Effect<FavoriteModels, HarnessFailure>;
    setModelSettings(
      threadId: string,
      projectId: number,
      settings: ThreadModelSettings,
    ): Effect.Effect<NativeThreadSnapshot, HarnessFailure>;
  }
>()('tagma/native-harness/ModelPreferences') {}
