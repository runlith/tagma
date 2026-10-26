import { Context, Effect } from 'effect';
import { ModelPreferences } from '../../native-harness/contract/service/models.js';
import { ProviderRegistry } from '../../providers/contract/service/registry.js';
import type { ServerRuntime } from '../runtime.js';

export const chosenModel = Effect.fnUntraced(function* (runtime: Pick<ServerRuntime, 'owners'>) {
  const { defaultModel } = yield* Context.get(runtime.owners, ProviderRegistry).catalog;
  if (defaultModel === null) return yield* Effect.die(new Error('the test world serves no model to choose'));
  yield* Context.get(runtime.owners, ModelPreferences).setModelDefaults({ ...defaultModel, account: null });
});
