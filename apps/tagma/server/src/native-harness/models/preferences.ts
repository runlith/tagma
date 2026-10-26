import { Clock, Effect } from 'effect';
import { eq } from 'drizzle-orm';
import type { ModelSwitches } from '@runlith/llm/models/description';
import type { ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import type { FavoriteModels, ModelDefaultsWrite, RememberedSwitches } from '../contract/wire/modelSelection.js';
import type { ModelPreference } from '../../threads/contract/wire/birth.js';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits, type Unit, type WriteUnit } from '../../platform/contract/service/units.js';
import { modelPreference } from '../store/preferences.js';
import { writes } from '../../platform/contract/service/writes.js';
import { stored } from '../../platform/store/crossing.js';

export type ModelMemory = {
  readonly selection: Omit<ModelPreference, 'account'> | null;
  readonly switches: RememberedSwitches;
};

export type ModelPreferenceRows = Effect.Success<typeof makeModelPreferenceRows>;

export const makeModelPreferenceRows = Effect.gen(function* () {
  const { db } = yield* MachineStore;
  const units = yield* MachineUnits;

  const memory = (ownerId: string, within?: Unit<'machine'>): Effect.Effect<ModelMemory, ThreadStorageFailed> => {
    const read = (unit: Unit<'machine'>) =>
      Effect.map(
        unit.run(
          db
            .select({
              provider: modelPreference.provider,
              model: modelPreference.model,
              reasoning: modelPreference.reasoning,
              defaultSwitches: modelPreference.defaultSwitches,
            })
            .from(modelPreference)
            .where(eq(modelPreference.principalId, ownerId))
            .get(),
        ),
        (row) => ({
          selection: row?.model
            ? {
                provider: row.provider!,
                model: row.model,
                reasoning: row.reasoning,
                switches: row.defaultSwitches[row.provider!]?.[row.model] ?? {},
              }
            : null,
          switches: row?.defaultSwitches ?? {},
        }),
      );
    return stored('memory')(within === undefined ? units.read(read) : read(within));
  };

  return {
    memory,
    modelSelection: (ownerId: string, within?: Unit<'machine'>) => Effect.map(memory(ownerId, within), (held) => held.selection),
    defaultSwitches: (ownerId: string, provider: string, model: string): Effect.Effect<ModelSwitches, ThreadStorageFailed> =>
      stored('defaultSwitches')(
        units.read((unit) =>
          Effect.map(
            unit.run(
              db
                .select({ defaultSwitches: modelPreference.defaultSwitches })
                .from(modelPreference)
                .where(eq(modelPreference.principalId, ownerId))
                .get(),
            ),
            (row) => row?.defaultSwitches[provider]?.[model] ?? {},
          ),
        ),
      ),
    saveModelSelection: (
      ownerId: string,
      selection: Omit<ModelDefaultsWrite, 'account'>,
      within?: WriteUnit<'machine'>,
    ): Effect.Effect<Omit<ModelPreference, 'account'>, ThreadStorageFailed> => {
      const save = Effect.fnUntraced(function* (unit: WriteUnit<'machine'>) {
        const existing = yield* unit.run(
          db
            .select({ defaultSwitches: modelPreference.defaultSwitches })
            .from(modelPreference)
            .where(eq(modelPreference.principalId, ownerId))
            .get(),
        );
        const defaultSwitches = { ...(existing?.defaultSwitches ?? {}) };
        if (selection.switches !== undefined) {
          defaultSwitches[selection.provider] = { ...defaultSwitches[selection.provider], [selection.model]: selection.switches };
        }
        const row = yield* unit.run(
          db
            .insert(modelPreference)
            .values({
              principalId: ownerId,
              provider: selection.provider,
              model: selection.model,
              reasoning: selection.reasoning,
              defaultSwitches,
            })
            .onConflictDoUpdate({
              target: modelPreference.principalId,
              set: {
                provider: selection.provider,
                model: selection.model,
                reasoning: selection.reasoning,
                defaultSwitches,
                updatedAt: new Date(yield* Clock.currentTimeMillis),
              },
            })
            .returning({
              provider: modelPreference.provider,
              model: modelPreference.model,
              reasoning: modelPreference.reasoning,
              defaultSwitches: modelPreference.defaultSwitches,
            })
            .get(),
        );
        if (!row?.model) {
          return yield* Effect.die(new Error('Thread owner model selection update returned no row.'));
        }
        return {
          provider: row.provider!,
          model: row.model,
          reasoning: row.reasoning,
          switches: row.defaultSwitches[row.provider!]?.[row.model] ?? {},
        };
      });
      return stored('saveModelSelection')(
        within === undefined ? units.write(writes('ModelPreferenceRows.saveModelSelection', [modelPreference]), save) : save(within),
      );
    },
    favoriteModels: (ownerId: string): Effect.Effect<FavoriteModels, ThreadStorageFailed> =>
      stored('favoriteModels')(
        units.read((unit) =>
          Effect.map(
            unit.run(
              db
                .select({ favoriteModels: modelPreference.favoriteModels })
                .from(modelPreference)
                .where(eq(modelPreference.principalId, ownerId))
                .get(),
            ),
            (row) => ({ models: row?.favoriteModels ?? [] }),
          ),
        ),
      ),
    saveFavoriteModels: (ownerId: string, favorites: FavoriteModels): Effect.Effect<FavoriteModels, ThreadStorageFailed> => {
      const favoriteModels = favorites.models.map((pair) => ({ provider: pair.provider, model: pair.model }));
      return stored('saveFavoriteModels')(
        units.write(writes('ModelPreferenceRows.saveFavoriteModels', [modelPreference]), (unit) =>
          Effect.gen(function* () {
            const row = yield* unit.run(
              db
                .insert(modelPreference)
                .values({ principalId: ownerId, favoriteModels })
                .onConflictDoUpdate({
                  target: modelPreference.principalId,
                  set: { favoriteModels, updatedAt: new Date(yield* Clock.currentTimeMillis) },
                })
                .returning({ favoriteModels: modelPreference.favoriteModels })
                .get(),
            );
            if (!row) return yield* Effect.die(new Error('Thread owner favorite models update returned no row.'));
            return { models: row.favoriteModels };
          }),
        ),
      );
    },
  };
});
