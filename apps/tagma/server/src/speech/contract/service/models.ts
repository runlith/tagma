import { Context, Data, type Effect, type Stream } from 'effect';
import type { InstallEvent } from '../wire/feeds.js';

export type LocalModel = {
  readonly id: string;
  readonly label: string;
  readonly size: number;
  readonly installed: boolean;
  readonly partial: number;
};

export type Progress = {
  readonly model: string;
  readonly received: number;
  readonly size: number;
};

export type ModelRefusal = 'unknown-model' | 'models-unreadable';

export class ModelRefused extends Data.TaggedError('ModelRefused')<{
  readonly code: ModelRefusal;
  readonly message: string;
}> {}

export class InstallFailed extends Data.TaggedError('InstallFailed')<{
  readonly model: string;
  readonly message: string;
}> {}

export class LocalModels extends Context.Service<
  LocalModels,
  {
    readonly list: Effect.Effect<ReadonlyArray<LocalModel>, ModelRefused>;
    install(model: string): Stream.Stream<Progress, ModelRefused | InstallFailed>;
    remove(model: string): Effect.Effect<void, ModelRefused>;
  }
>()('tagma/speech/LocalModels') {}

export type Installing = LocalModel & { readonly received: number | null; readonly failure: string | null };

export class Models extends Context.Service<
  Models,
  {
    readonly list: Effect.Effect<ReadonlyArray<Installing>, ModelRefused>;
    install(model: string): Effect.Effect<'installing' | 'installed', ModelRefused>;
    remove(model: string): Effect.Effect<void, ModelRefused>;
    readonly progress: Stream.Stream<InstallEvent>;
  }
>()('tagma/speech/Models') {}
