import { Effect, Layer } from 'effect';
import { writes } from '../../platform/contract/service/writes.js';
import { SettingReaction } from '../../settings/contract/service/reaction.js';
import { CommitEffects } from '../contract/service/acts.js';
import { Tags } from '../contract/service/vocabulary.js';
import { ActState } from '../contract/service/transaction.js';
import { unitState, withUnit } from '../acts/state.js';

export const settingReactionLayer: Layer.Layer<SettingReaction, never, Tags> = Layer.effect(
  SettingReaction,
  Effect.gen(function* () {
    const vocabulary = yield* Tags;
    return SettingReaction.of({
      reach: writes('settings', []),
      open: () => {
        const held = unitState();
        return {
          within: (unit, _key, _projectId, landing) => Effect.provideService(landing, ActState, withUnit(held, unit)),
          committed: Effect.fnUntraced(function* (announce) {
            yield* vocabulary.publish(held);
            for (const hook of yield* CommitEffects) yield* hook;
            yield* announce;
          }),
        };
      },
    });
  }),
);
