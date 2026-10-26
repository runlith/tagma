import { Context, Data, type Effect } from 'effect';

export type PluginLaunchRequest = {
  readonly plugin: string;
  readonly contributes: Readonly<Record<string, unknown>>;
};

export type PluginLaunchEnvironment = {
  readonly env: Readonly<Record<string, string>>;
  readonly redact: readonly string[];
};

export class PluginLaunchRefused extends Data.TaggedError('PluginLaunchRefused')<{ readonly reason: string }> {}

export type PluginLaunchProvider = (request: PluginLaunchRequest) => Effect.Effect<PluginLaunchEnvironment, PluginLaunchRefused>;

export class PluginLaunches extends Context.Service<
  PluginLaunches,
  {
    provide(provider: PluginLaunchProvider): Effect.Effect<() => void>;
    changed(plugin: string): Effect.Effect<void>;
  }
>()('tagma/plugins/PluginLaunches') {}
