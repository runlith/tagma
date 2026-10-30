import { Effect, Layer } from 'effect';
import { OPERATOR_PRINCIPAL } from '../../platform/contract/wire/actor.js';
import { DefaultSelection } from '../../providers/contract/service/asks.js';
import { makeModelPreferenceRows } from './preferences.js';

export const defaultSelectionLayer = Layer.effect(
  DefaultSelection,
  Effect.map(makeModelPreferenceRows, (rows) =>
    DefaultSelection.of({
      saved: rows.memory(OPERATOR_PRINCIPAL).pipe(
        Effect.map((memory) => (memory.selection === null ? null : { provider: memory.selection.provider, model: memory.selection.model })),
        Effect.orDie,
      ),
    }),
  ),
);
