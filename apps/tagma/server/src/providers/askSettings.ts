import type { AskKind } from '@runlith/llm/models/description';
import { Effect, Layer } from 'effect';
import { GraphStore } from '../platform/contract/service/store.js';
import { writes } from '../platform/contract/service/writes.js';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import type { AskChoice, SettingKey } from '../platform/contract/wire/setting.js';
import { session } from '../platform/store/writers.js';
import { DeclaredSettings } from '../settings/contract/service/declarations.js';
import { ManagedWrite } from '../settings/contract/service/managed.js';
import { setting } from '../settings/store/table.js';
import { ModelAsks } from './contract/service/asks.js';

type AskRole = { readonly kind: AskKind; readonly choices: (value: unknown) => readonly AskChoice[] };

const roleOf = (key: SettingKey<unknown>): AskRole | null => {
  const control = key.control;
  if (control?.kind === 'ask') return { kind: control.of, choices: (value) => (value === null ? [] : [value as AskChoice]) };
  if (control?.kind !== 'rows') return null;
  const field = control.fields.find((one) => one.kind === 'ask');
  return field?.kind === 'ask' ? { kind: field.of, choices: (value) => value as readonly AskChoice[] } : null;
};

export const askSettingsLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const managed = yield* ManagedWrite;
    const store = yield* GraphStore;
    const asks = yield* ModelAsks;
    for (const key of (yield* DeclaredSettings).keys) {
      const role = roleOf(key);
      if (role === null) continue;
      yield* managed.register(key, (input) =>
        Effect.gen(function* () {
          const offered = input.value === undefined ? [] : role.choices(input.value);
          yield* Effect.forEach(offered, (choice) => asks.choose(role.kind, choice), { discard: true }).pipe(
            Effect.mapError(
              (refused) =>
                new GateRefusal('setting-value', `${refused.message}.`, [
                  `name a model that answers ${role.kind} asks in ${key.id}, on a rung it offers`,
                ]),
            ),
          );
          yield* store.transaction(writes('settings', [session, setting]), (unit) => managed.write(unit, input), {
            onCommit: (written) => written.announce,
          });
        }),
      );
    }
  }),
);
