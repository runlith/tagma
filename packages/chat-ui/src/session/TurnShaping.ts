import { Deferred, Effect } from 'effect';

export class TurnShaping {
  private readonly writes = new Map<string, Set<Deferred.Deferred<void>>>();

  hold(key: string): () => void {
    const done = Deferred.makeUnsafe<void>();
    const standing = this.writes.get(key) ?? new Set();
    standing.add(done);
    this.writes.set(key, standing);
    return () => {
      if (!standing.delete(done)) return;
      if (standing.size === 0 && this.writes.get(key) === standing) this.writes.delete(key);
      Deferred.doneUnsafe(done, Effect.void);
    };
  }

  shape<A, E>(key: string, write: Effect.Effect<A, E>): Effect.Effect<A, E> {
    return Effect.suspend(() => {
      const release = this.hold(key);
      return Effect.ensuring(write, Effect.sync(release));
    });
  }

  settled(key: string): Effect.Effect<void> {
    const standing = [...(this.writes.get(key) ?? [])];
    return Effect.forEach(standing, (done) => Deferred.await(done), { discard: true });
  }
}
