import type { AskKind } from '@runlith/llm/models/description';
import { Effect } from 'effect';
import { GraphStore } from '../platform/contract/service/store.js';
import { writes } from '../platform/contract/service/writes.js';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import type { SettingKey } from '../platform/contract/wire/setting.js';
import { session } from '../platform/store/writers.js';
import { ManagedWrite } from '../settings/contract/service/managed.js';
import { setting } from '../settings/store/table.js';
import { ModelAsks } from './contract/service/asks.js';

export type NamedModel = { readonly provider: string; readonly model: string };

export const keyedModel = (key: string): readonly NamedModel[] => {
  if (key === '') return [];
  const split = key.indexOf(':');
  return [split === -1 ? { provider: key, model: '' } : { provider: key.slice(0, split), model: key.slice(split + 1) }];
};

export const askSetting = Effect.fnUntraced(function* <A>(key: SettingKey<A>, kind: AskKind, named: (value: A) => readonly NamedModel[]) {
  const managed = yield* ManagedWrite;
  const store = yield* GraphStore;
  const asks = yield* ModelAsks;
  yield* managed.register(key, (input) =>
    Effect.gen(function* () {
      const offered = input.value === undefined ? [] : named(input.value as A);
      const silent = offered.find((model) => !asks.answers(model, kind));
      if (silent !== undefined)
        return yield* new GateRefusal('setting-value', `${silent.provider}:${silent.model} cannot answer a ${kind} ask here.`, [
          `name a model that answers ${kind} asks in ${key.id}`,
        ]);
      yield* store.transaction(writes('settings', [session, setting]), (unit) => managed.write(unit, input), {
        onCommit: (written) => written.announce,
      });
    }),
  );
});
