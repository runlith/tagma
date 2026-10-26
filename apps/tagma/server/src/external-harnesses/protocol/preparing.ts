import { Effect, type Exit, FiberMap, Option } from 'effect';
import type { HarnessFailure } from '../../threads/contract/service/failure.js';
import type { ProtocolLinks } from './links.js';

export class ProtocolPreparing<A> {
  private readonly held = new Map<string, Map<string, Exit.Exit<A, HarnessFailure>>>();
  private readonly fresh = new Set<string>();

  constructor(
    private readonly links: ProtocolLinks,
    private readonly fibers: FiberMap.FiberMap<string, void, never>,
    private readonly kind: string,
  ) {}

  ready(threadId: string, key: string, work: Effect.Effect<A, HarnessFailure>): Effect.Effect<Option.Option<A>, HarnessFailure> {
    return Effect.suspend(() => {
      const done = this.held.get(threadId)?.get(key);
      if (done !== undefined) return Effect.map(done, Option.some);
      const landed = Effect.flatMap(Effect.exit(work), (exit) =>
        Effect.sync(() => {
          const standing = this.held.get(threadId) ?? new Map<string, Exit.Exit<A, HarnessFailure>>();
          standing.set(key, exit);
          this.held.set(threadId, standing);
          this.fresh.add(threadId);
          this.links.raise(threadId);
        }),
      );
      return Effect.as(FiberMap.run(this.fibers, `${this.kind}|${threadId}|${key}`, landed, { onlyIfMissing: true }), Option.none());
    });
  }

  taken(threadId: string, key: string): void {
    this.held.get(threadId)?.delete(key);
  }

  kept(threadId: string, keep: (key: string) => boolean): void {
    const standing = this.held.get(threadId);
    if (standing === undefined) return;
    for (const key of [...standing.keys()]) if (!keep(key)) standing.delete(key);
    if (standing.size === 0) this.held.delete(threadId);
  }

  due(threadId: string): boolean {
    return this.fresh.has(threadId);
  }

  pumped(threadId: string): void {
    this.fresh.delete(threadId);
  }
}
