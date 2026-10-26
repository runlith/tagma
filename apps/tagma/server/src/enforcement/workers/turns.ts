import { Effect } from 'effect';

export type Want = { readonly seat: number } | { readonly prefer?: number };

type Waiter = {
  readonly want: Want;
  seat: number | undefined;
  wake: ((seat: number) => void) | undefined;
  left: boolean;
};

const pinned = (want: Want): number | undefined => ('seat' in want ? want.seat : undefined);

export class Turns {
  private readonly busy: boolean[];
  private readonly holds: number[];
  private readonly queue: Waiter[] = [];

  constructor(readonly size: number) {
    this.busy = Array.from({ length: size }, () => false);
    this.holds = Array.from({ length: size }, () => 0);
  }

  within<A, E, R>(want: Want, use: (seat: number) => Effect.Effect<A, E, R>): Effect.Effect<A, E, R> {
    return Effect.uninterruptibleMask((restore) =>
      Effect.suspend(() => {
        const waiter: Waiter = { want, seat: undefined, wake: undefined, left: false };
        this.queue.push(waiter);
        this.pump();
        return restore(this.seated(waiter)).pipe(
          Effect.flatMap((seat) => restore(use(seat))),
          Effect.ensuring(Effect.sync(() => this.leave(waiter))),
        );
      }),
    );
  }

  load(seat: number): number {
    return (this.busy[seat] === true ? 1 : 0) + (this.holds[seat] ?? 0) + this.queue.filter((one) => pinned(one.want) === seat).length;
  }

  wanted(seat: number): boolean {
    return (
      (this.holds[seat] ?? 0) > 0 ||
      this.queue.some((one) => {
        const at = pinned(one.want);
        return at === undefined || at === seat;
      })
    );
  }

  least(prefer?: number): number {
    let best = prefer ?? 0;
    for (let seat = 0; seat < this.size; seat += 1) if (this.load(seat) < this.load(best)) best = seat;
    return best;
  }

  hold(seat: number): () => void {
    this.holds[seat] = (this.holds[seat] ?? 0) + 1;
    let held = true;
    return () => {
      if (!held) return;
      held = false;
      this.holds[seat] = (this.holds[seat] ?? 1) - 1;
    };
  }

  private seated(waiter: Waiter): Effect.Effect<number> {
    return Effect.callback<number>((resume) => {
      if (waiter.seat !== undefined) return resume(Effect.succeed(waiter.seat));
      waiter.wake = (seat) => resume(Effect.succeed(seat));
    });
  }

  private leave(waiter: Waiter): void {
    if (waiter.left) return;
    waiter.left = true;
    if (waiter.seat === undefined) this.queue.splice(this.queue.indexOf(waiter), 1);
    else this.busy[waiter.seat] = false;
    this.pump();
  }

  private pump(): void {
    for (let at = 0; at < this.queue.length && this.busy.includes(false);) {
      const waiter = this.queue[at]!;
      const seat = this.free(waiter.want);
      if (seat === undefined) {
        at += 1;
        continue;
      }
      this.queue.splice(at, 1);
      this.busy[seat] = true;
      waiter.seat = seat;
      waiter.wake?.(seat);
    }
  }

  private free(want: Want): number | undefined {
    const at = pinned(want);
    if (at !== undefined) return this.busy[at] === true ? undefined : at;
    const prefer = 'prefer' in want ? want.prefer : undefined;
    if (prefer !== undefined && this.busy[prefer] === false) return prefer;
    let best: number | undefined;
    for (let seat = 0; seat < this.size; seat += 1)
      if (this.busy[seat] === false && (best === undefined || (this.holds[seat] ?? 0) < (this.holds[best] ?? 0))) best = seat;
    return best;
  }
}
