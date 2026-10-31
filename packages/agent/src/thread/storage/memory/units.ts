import { Clock, Data, Cause, Effect, Exit, Semaphore } from 'effect';

type Swap = () => () => void;

const NO_TAILS: readonly Effect.Effect<void>[] = [];

export class MemoryUnitEndedError extends Data.TaggedError('MemoryUnitEnded')<{ readonly message: string }> {
  constructor() {
    super({ message: 'A tail was queued on a write unit after it ended, from a fiber that outlived it.' });
    this.name = 'MemoryUnitEndedError';
  }
}

export type MemoryTxInput = {
  readonly clock: Clock.Clock;
  readonly reads?: boolean;
};

export class MemoryTx {
  private readonly changes: Swap[] = [];
  private tails: Effect.Effect<void>[] | null = null;
  private ended = false;

  readonly reads: boolean;
  private readonly clock: Clock.Clock;

  constructor({ clock, reads = false }: MemoryTxInput) {
    this.clock = clock;
    this.reads = reads;
  }

  now(): Date {
    return new Date(this.clock.currentTimeMillisUnsafe());
  }

  afterCommit(effect: Effect.Effect<void>): Effect.Effect<void> {
    return Effect.suspend(() => {
      if (this.ended) return Effect.die(new MemoryUnitEndedError());
      (this.tails ??= []).push(effect);
      return Effect.void;
    });
  }

  end(): readonly Effect.Effect<void>[] {
    this.ended = true;
    return this.tails ?? NO_TAILS;
  }

  changed(): boolean {
    return this.changes.length > 0;
  }

  rollback(): void {
    for (let at = this.changes.length - 1; at >= 0; at -= 1) this.changes[at]!();
    this.changes.length = 0;
  }

  committed<T>(work: () => T): T {
    const reinstate: (() => void)[] = [];
    for (let at = this.changes.length - 1; at >= 0; at -= 1) reinstate.push(this.changes[at]!());
    try {
      return work();
    } finally {
      for (let at = reinstate.length - 1; at >= 0; at -= 1) reinstate[at]!();
    }
  }

  keep<T extends object>(target: T): void {
    const saved = snapshot(target);
    this.changes.push(() => {
      const live = snapshot(target);
      Object.assign(target, saved);
      return () => void Object.assign(target, live);
    });
  }

  put<K, V>(into: Map<K, V>, key: K, value: V): void {
    const had = into.has(key);
    const was = into.get(key);
    this.changes.push(() => {
      const hasNow = into.has(key);
      const now = into.get(key);
      if (had) into.set(key, was as V);
      else into.delete(key);
      return () => void (hasNow ? into.set(key, now as V) : into.delete(key));
    });
    into.set(key, value);
  }

  remove<K, V>(from: Map<K, V>, key: K): void {
    if (!from.has(key)) return;
    const was = from.get(key) as V;
    this.changes.push(() => {
      const hasNow = from.has(key);
      const now = from.get(key);
      from.set(key, was);
      return () => void (hasNow ? from.set(key, now as V) : from.delete(key));
    });
    from.delete(key);
  }
}

function snapshot(target: object): Record<string, unknown> {
  const saved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(target)) saved[key] = copied(value);
  return saved;
}

function copied(value: unknown): unknown {
  if (Array.isArray(value)) return [...value];
  if (value instanceof Map) return new Map(value);
  if (value instanceof Set) return new Set(value);
  return value;
}

const tailed = Effect.fnUntraced(function* <T>(tails: readonly Effect.Effect<void>[], value: T): Effect.fn.Return<T> {
  let lost = Cause.empty as Cause.Cause<never>;
  for (const tail of tails) {
    const ended = yield* Effect.exit(tail);
    if (Exit.isFailure(ended)) lost = Cause.combine(lost, ended.cause);
  }
  if (lost.reasons.length > 0) return yield* Effect.failCause(lost);
  return value;
});

export class MemoryUnits {
  private readonly gate = Semaphore.makeUnsafe(1);
  private active: MemoryTx | null = null;
  private viewing = false;
  private commits = 0;

  revision(): number {
    return this.commits;
  }

  commit<T, E>(work: (tx: MemoryTx) => Effect.Effect<T, E>, joined?: MemoryTx): Effect.Effect<T, E> {
    if (joined) return work(joined);
    return Effect.uninterruptibleMask((restore) => {
      let tails = NO_TAILS;
      return Effect.flatMap(
        restore(
          this.gate.withPermits(1)(
            Effect.flatMap(Clock.Clock, (clock) => {
              const own = new MemoryTx({ clock });
              this.active = own;
              return work(own).pipe(
                Effect.onExit((exit) =>
                  Effect.sync(() => {
                    tails = own.end();
                    if (Exit.isFailure(exit)) own.rollback();
                    else if (own.changed()) this.commits += 1;
                    this.active = null;
                  }),
                ),
              );
            }),
          ),
        ),
        (value) => (tails.length === 0 ? Effect.succeed(value) : tailed(tails, value)),
      );
    });
  }

  committed<T>(work: () => T): T {
    if (this.active === null || this.viewing) return work();
    this.viewing = true;
    try {
      return this.active.committed(work);
    } finally {
      this.viewing = false;
    }
  }

  read<T>(tx: MemoryTx | undefined, work: () => T): T {
    return tx !== undefined && !tx.reads ? work() : this.committed(work);
  }
}
