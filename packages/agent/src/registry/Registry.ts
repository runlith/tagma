import { Data, Deferred, Effect, type Scope } from 'effect';

export class RegistryCollision extends Data.TaggedError('RegistryCollision')<{
  readonly registry: string;
  readonly id: string;
  readonly holder: string;
  readonly claimant: string;
}> {
  override get message(): string {
    return `${this.registry} ${this.id} is registered by both ${this.holder} and ${this.claimant}.`;
  }
}

export class RegistryAbsent extends Data.TaggedError('RegistryAbsent')<{
  readonly registry: string;
  readonly id: string;
}> {
  override get message(): string {
    return `contributor-absent: no ${this.registry} ${this.id} is registered here.`;
  }
}

type Entry<T> = { readonly owner: string; readonly value: T; readonly removed: Deferred.Deferred<void> };

export class Registry<T> {
  private readonly entries = new Map<string, Entry<T>>();
  private moved = 0;

  constructor(
    readonly name: string,
    seed: readonly { readonly id: string; readonly owner: string; readonly value: T }[] = [],
  ) {
    for (const { id, owner, value } of seed) {
      const holder = this.entries.get(id);
      if (holder !== undefined) throw new RegistryCollision({ registry: name, id, holder: holder.owner, claimant: owner });
      this.entries.set(id, { owner, value, removed: Deferred.makeUnsafe<void>() });
    }
  }

  register(id: string, owner: string, value: T): Effect.Effect<() => void, RegistryCollision> {
    return Effect.suspend(() => {
      const holder = this.entries.get(id);
      if (holder !== undefined)
        return Effect.fail(new RegistryCollision({ registry: this.name, id, holder: holder.owner, claimant: owner }));
      const entry = { owner, value, removed: Deferred.makeUnsafe<void>() };
      this.entries.set(id, entry);
      this.moved += 1;
      return Effect.succeed(() => {
        if (this.entries.get(id) !== entry) return;
        this.entries.delete(id);
        this.moved += 1;
        Deferred.doneUnsafe(entry.removed, Effect.void);
      });
    });
  }

  hold(id: string, owner: string, value: T): Effect.Effect<void, RegistryCollision, Scope.Scope> {
    return Effect.asVoid(Effect.acquireRelease(this.register(id, owner, value), (dispose) => Effect.sync(dispose)));
  }

  get revision(): number {
    return this.moved;
  }

  get(id: string): Effect.Effect<T, RegistryAbsent> {
    return Effect.suspend(() => {
      const entry = this.entries.get(id);
      return entry === undefined ? Effect.fail(new RegistryAbsent({ registry: this.name, id })) : Effect.succeed(entry.value);
    });
  }

  find(id: string): T | undefined {
    return this.entries.get(id)?.value;
  }

  values(): readonly T[] {
    return [...this.entries.values()].map((entry) => entry.value);
  }

  registrations(): readonly {
    readonly id: string;
    readonly value: T;
    readonly standing: () => boolean;
    readonly removed: Effect.Effect<void>;
  }[] {
    return [...this.entries].map(([id, entry]) => ({
      id,
      value: entry.value,
      standing: () => this.entries.get(id) === entry,
      removed: Deferred.await(entry.removed),
    }));
  }
}
