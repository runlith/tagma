import { Context, Deferred, Effect, Fiber, Scope } from 'effect';
export type ReadClass = 'point' | 'bulk';

type Waiter = { readonly ready: Deferred.Deferred<number>; lane?: number };
export type ReaderLane = { readonly lane: number; readonly release: () => void };

export class ReaderLanes {
  private readonly free: number[] = [];
  private readonly waiting: Record<ReadClass, Set<Waiter>> = { point: new Set(), bulk: new Set() };
  private next = 0;
  private bulk = 0;
  private readonly bulkCap: number;

  constructor(readonly ceiling: number) {
    this.bulkCap = ceiling < 2 ? ceiling : ceiling - Math.max(1, Math.floor(ceiling / 4));
  }

  take(kind: ReadClass): Effect.Effect<ReaderLane> {
    return Effect.uninterruptibleMask((restore) => {
      const scope = Context.getUnsafe(Fiber.getCurrent()!.context, Scope.Scope);
      return Effect.suspend(() => {
        if (
          this.waiting.point.size === 0 &&
          (kind === 'point' || (this.waiting.bulk.size === 0 && this.bulk < this.bulkCap)) &&
          (this.free.length > 0 || this.next < this.ceiling)
        ) {
          const lane = this.free.pop() ?? this.next++;
          if (kind === 'bulk') this.bulk += 1;
          return this.leased(scope, lane, kind);
        }
        const waiter: Waiter = { ready: Deferred.makeUnsafe<number>() };
        this.waiting[kind].add(waiter);
        this.drain();
        const waiting =
          waiter.lane === undefined
            ? Deferred.await(waiter.ready).pipe(
                Effect.withSpan('sqlite.reader.shared.wait', {
                  attributes: {
                    'db.readers.queued': this.waiting.point.size + this.waiting.bulk.size,
                    'db.readers.busy': this.next - this.free.length,
                    'db.readers.class': kind,
                  },
                }),
              )
            : Deferred.await(waiter.ready);
        return Effect.flatMap(
          Effect.onInterrupt(restore(waiting), () =>
            Effect.sync(() => {
              if (waiter.lane === undefined) this.waiting[kind].delete(waiter);
              else this.release(waiter.lane, kind);
            }),
          ),
          (lane) => this.leased(scope, lane, kind),
        );
      });
    });
  }

  private leased(scope: Scope.Scope, lane: number, kind: ReadClass): Effect.Effect<ReaderLane> {
    let held = true;
    const release = () => {
      if (!held) return;
      held = false;
      this.release(lane, kind);
    };
    return Effect.as(Scope.addFinalizer(scope, Effect.sync(release)), { lane, release });
  }

  private release(lane: number, kind: ReadClass): void {
    if (kind === 'bulk') this.bulk -= 1;
    this.free.push(lane);
    this.drain();
  }

  private drain(): void {
    while (this.free.length > 0 || this.next < this.ceiling) {
      const kind = this.waiting.point.size > 0 ? 'point' : 'bulk';
      if (kind === 'bulk' && this.bulk >= this.bulkCap) return;
      const waiter = this.waiting[kind].values().next().value;
      if (waiter === undefined) return;
      this.waiting[kind].delete(waiter);
      waiter.lane = this.free.pop() ?? this.next++;
      if (kind === 'bulk') this.bulk += 1;
      Deferred.doneUnsafe(waiter.ready, Effect.succeed(waiter.lane));
    }
  }
}
