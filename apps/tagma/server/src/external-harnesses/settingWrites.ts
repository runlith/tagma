import { Effect, Layer, Predicate } from 'effect';
import { GraphStore } from '../platform/contract/service/store.js';
import { writes } from '../platform/contract/service/writes.js';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import type { SettingKey } from '../platform/contract/wire/setting.js';
import { session } from '../platform/store/writers.js';
import { ManagedWrite, type ManagedWriteInput } from '../settings/contract/service/managed.js';
import { setting } from '../settings/store/table.js';
import type { HarnessAdapter } from './contract/service/adapter.js';
import { HarnessAdapters } from './contract/service/adapters.js';
import { harnessProfile, harnessTransport } from './settings.js';

const choosesTransport = (row: HarnessAdapter): boolean => row.launch !== null && row.acp !== undefined && row.acp.hosts === null;

const takesProfile = (row: HarnessAdapter): boolean => row.launch !== null;

export const settingWritesLayer: Layer.Layer<never, never, ManagedWrite | GraphStore | HarnessAdapters> = Layer.effectDiscard(
  Effect.gen(function* () {
    const managed = yield* ManagedWrite;
    const store = yield* GraphStore;
    const adapters = yield* HarnessAdapters;
    const keyed = <A extends Readonly<Record<string, unknown>>>(
      key: SettingKey<A>,
      admits: (row: HarnessAdapter) => boolean,
      what: string,
    ) =>
      managed.register(key, (input: ManagedWriteInput<A>) =>
        Effect.gen(function* () {
          const named = input.declined || !Predicate.isObject(input.value) ? [] : Object.keys(input.value);
          const foreign = named.filter((id) => {
            const row = adapters.find(id);
            return row === null || !admits(row);
          });
          if (foreign.length > 0) {
            const allowed = adapters
              .all()
              .filter(admits)
              .map((row) => row.harness);
            return yield* new GateRefusal('setting-value', `${key.id} takes ${what}; ${foreign.join(', ')} is not one.`, [
              allowed.length === 0 ? `no installed harness takes ${key.id}: clear it` : `key it by one of: ${allowed.join(', ')}`,
            ]);
          }
          yield* store.transaction(writes('settings', [session, setting]), (unit) => managed.write(unit, input), {
            onCommit: (written) => written.announce,
          });
        }),
      );
    yield* keyed(harnessTransport, choosesTransport, 'installed harnesses that offer both a terminal and their own ACP agent');
    yield* keyed(harnessProfile, takesProfile, 'installed harnesses with a terminal');
  }),
);
