import { Effect } from 'effect';
import { Registry, type RegistryAbsent, type RegistryCollision } from '../../registry/Registry';
import type { ThreadCompactionStrategy } from './strategy';

export const COMPACTION_OFF = 'off';

export type CompactionChoice = typeof COMPACTION_OFF | ThreadCompactionStrategy;

export class CompactionStrategies {
  private readonly registry: Registry<ThreadCompactionStrategy>;

  constructor(standing: readonly { readonly id: string; readonly owner: string; readonly strategy: ThreadCompactionStrategy }[] = []) {
    this.registry = new Registry(
      'compaction strategy',
      standing.map(({ id, owner, strategy }) => ({ id, owner, value: strategy })),
    );
  }

  register(owner: string, id: string, strategy: ThreadCompactionStrategy): Effect.Effect<() => void, RegistryCollision> {
    return Effect.suspend(() =>
      id === COMPACTION_OFF
        ? Effect.die(new RangeError(`${COMPACTION_OFF} is the name of no compaction, so no strategy can take it.`))
        : this.registry.register(id, owner, strategy),
    );
  }

  choose(id: string | undefined, standing: ThreadCompactionStrategy): Effect.Effect<CompactionChoice, RegistryAbsent> {
    if (id === undefined) return Effect.succeed(standing);
    if (id === COMPACTION_OFF) return Effect.succeed(COMPACTION_OFF);
    return this.registry.get(id);
  }
}
