import { Context, type Effect, type Stream } from 'effect';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import type { PluginsUnreadable } from '../../../plugins/contract/service/plugins.js';
import type { ActionRefusalCode, PluginActionState } from '../wire/actions.js';

type ActionFailure = StoreFailure | GateRefusal<ActionRefusalCode>;

export class PluginActions extends Context.Service<
  PluginActions,
  {
    readonly sets: Stream.Stream<PluginActionState, PluginsUnreadable | StoreFailure>;
    run(projectId: number, plugin: string, action: string): Effect.Effect<string | null, ActionFailure>;
  }
>()('tagma/views/PluginActions') {}
