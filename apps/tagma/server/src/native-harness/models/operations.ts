import { Effect } from 'effect';
import { body, type OperationPair, pair } from '../../platform/contract/service/body.js';
import { CurrentProject } from '../../projects/contract/service/caller.js';
import { ProviderRegistry, servedTextModel } from '../../providers/contract/service/registry.js';
import { wireSnapshotPayload } from '../../threads/list/wire.js';
import { stateThreads, threadBasis } from '../../threads/list/basis.js';
import { ModelPreferences } from '../contract/service/models.js';
import { declaredRefusals } from '../../threads/refusalAnswers.js';
import { MODEL_OPERATIONS as OPS, type ModelOperationId } from '../contract/wire/operations/models.js';

export const MODEL_PAIRS: { readonly [K in ModelOperationId]: OperationPair<(typeof OPS)[K]> } = {
  read_model_defaults: pair(
    OPS.read_model_defaults,
    body(OPS.read_model_defaults, {
      execute: () =>
        declaredRefusals(OPS.read_model_defaults)(
          Effect.map(
            Effect.flatMap(ModelPreferences, (models) => models.modelDefaults()),
            (answer) =>
              answer.status === 'unconnected'
                ? { status: 'unconnected' as const, plans: answer.plans }
                : { status: 'read' as const, ...answer.defaults, remembered: answer.remembered },
          ),
        ),
    }),
  ),
  read_model_connection: pair(
    OPS.read_model_connection,
    body(OPS.read_model_connection, {
      execute: () =>
        declaredRefusals(OPS.read_model_connection)(
          Effect.map(
            Effect.flatMap(ModelPreferences, (models) => models.modelConnection()),
            (connection) => ({ status: 'read' as const, ...connection }),
          ),
        ),
    }),
  ),
  set_model_defaults: pair(
    OPS.set_model_defaults,
    body(OPS.set_model_defaults, {
      execute: Effect.fnUntraced(function* (input) {
        const { models } = yield* (yield* ProviderRegistry).catalog;
        const selected = yield* servedTextModel(models, input.provider, input.model);
        const saved = yield* (yield* ModelPreferences).setModelDefaults({
          account: input.account,
          provider: selected.provider,
          model: selected.id,
          reasoning: input.reasoning,
          switches: input.switches,
        });
        return { status: 'set' as const, ...saved };
      }, declaredRefusals(OPS.set_model_defaults)),
    }),
  ),
  read_model_favorites: pair(
    OPS.read_model_favorites,
    body(OPS.read_model_favorites, {
      execute: () =>
        declaredRefusals(OPS.read_model_favorites)(
          Effect.map(
            Effect.flatMap(ModelPreferences, (models) => models.favoriteModels()),
            (favorites) => ({ status: 'read' as const, ...favorites }),
          ),
        ),
    }),
  ),
  set_model_favorites: pair(
    OPS.set_model_favorites,
    body(OPS.set_model_favorites, {
      execute: Effect.fnUntraced(function* (input) {
        const catalog = yield* (yield* ProviderRegistry).catalog;
        const models = yield* Effect.forEach(input.models, (named) =>
          Effect.map(servedTextModel(catalog.models, named.provider, named.model), (selected) => ({
            provider: selected.provider,
            model: selected.id,
          })),
        );
        const saved = yield* (yield* ModelPreferences).setFavoriteModels({ models });
        return { status: 'set' as const, ...saved };
      }, declaredRefusals(OPS.set_model_favorites)),
    }),
  ),
  set_thread_model: pair(
    OPS.set_thread_model,
    body(OPS.set_thread_model, {
      execute: Effect.fnUntraced(function* (input) {
        const call = yield* yield* CurrentProject;
        const { models } = yield* (yield* ProviderRegistry).catalog;
        const selected = yield* servedTextModel(models, input.provider, input.model);
        const snapshot = yield* (yield* ModelPreferences).setModelSettings(input.threadId, call.project.id, {
          account: input.account,
          provider: selected.provider,
          model: selected.id,
          reasoning: input.reasoning,
          switches: input.switches,
        });
        const basis = yield* threadBasis(stateThreads(snapshot, call.project.id));
        return wireSnapshotPayload(snapshot, basis);
      }, declaredRefusals(OPS.set_thread_model)),
    }),
  ),
};
