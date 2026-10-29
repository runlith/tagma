import { Context, Data, type Effect } from 'effect';

export type TagmaAppLaunchRequest = {
  readonly app: string;
  readonly contributes: Readonly<Record<string, unknown>>;
};

export type TagmaAppLaunchEnvironment = {
  readonly env: Readonly<Record<string, string>>;
  readonly redact: readonly string[];
};

export class TagmaAppLaunchRefused extends Data.TaggedError('TagmaAppLaunchRefused')<{ readonly reason: string }> {}

export type TagmaAppLaunchProvider = (request: TagmaAppLaunchRequest) => Effect.Effect<TagmaAppLaunchEnvironment, TagmaAppLaunchRefused>;

export class TagmaAppLaunches extends Context.Service<
  TagmaAppLaunches,
  {
    provide(provider: TagmaAppLaunchProvider): Effect.Effect<() => void>;
    changed(app: string): Effect.Effect<void>;
  }
>()('tagma/tagma-apps/TagmaAppLaunches') {}
