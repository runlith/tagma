import { Effect } from 'effect';
import { writes, type WriteSet } from '../../platform/contract/service/writes.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { HarnessId } from '../../platform/contract/wire/session.js';
import { type Harness, HarnessRegistry, HarnessMissing } from '../contract/service/harness.js';

export function harnessRegistry(): HarnessRegistry['Service'] {
  const bound = new Map<HarnessId, Harness['Service']>();
  const joined = new Map<WriteSet, WriteSet>();
  return HarnessRegistry.of({
    register: (harness, implementation) =>
      Effect.suspend(() => {
        if (bound.has(harness)) return Effect.die(new Error(`harness ${harness} is registered twice`));
        bound.set(harness, implementation);
        joined.clear();
        return Effect.void;
      }),
    resolve: (harness) => {
      const found = bound.get(harness);
      return found === undefined ? Effect.fail(new HarnessMissing({ harness })) : Effect.succeed(found);
    },
    list: () => [...bound.keys()],
    seating: (to, models) => {
      for (const [name, harness] of bound) {
        const serves = harness.serves;
        if (serves?.provider === to.provider) return Effect.succeed({ name, seat: (agent: string) => serves.seat(to, agent) });
      }
      if (!models.registered(to.provider) || models.named(to.provider).auth !== 'cli') return Effect.succeed(null);
      const label = models.providerLabel(to.provider);
      const own = [...bound].find(([, harness]) => harness.provider === to.provider)?.[0];
      return Effect.fail(
        new GateRefusal(
          'model-unavailable',
          `${label} models run in its own CLI, and no harness on this machine hosts a Tagma agent on them.`,
          [
            own === undefined
              ? `install the ${label} CLI, then ask again`
              : `start a harness:${own} agent, which runs ${label} models itself`,
            'choose a model of another provider',
          ],
        ),
      );
    },
    writes: (base) => {
      const standing = joined.get(base);
      if (standing !== undefined) return standing;
      const declared = [...bound.values()].flatMap((harness) => (harness.birthWrites === undefined ? [] : [harness.birthWrites]));
      const combined = writes(base.operation, [], base, ...declared);
      joined.set(base, combined);
      return combined;
    },
  });
}
