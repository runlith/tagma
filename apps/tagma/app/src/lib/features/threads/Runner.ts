import { Cause, Clock, Context, Effect, Exit, Fiber, FiberSet, Scope as Lifetime } from 'effect';

export class Runner {
  readonly life: Lifetime.Closeable = Lifetime.makeUnsafe();
  readonly clock: Clock.Clock;
  private readonly fibers: FiberSet.FiberSet<unknown, never>;

  constructor(private readonly services: Context.Context<never> = Context.empty()) {
    this.clock = Context.get(services, Clock.Clock);
    this.fibers = Effect.runSync(FiberSet.make<unknown, never>().pipe(Lifetime.provide(this.life)));
  }

  guard<A, E>(work: Effect.Effect<A, E>): Effect.Effect<A, E> {
    return Effect.suspend(() => Effect.flatMap(Fiber.join(this.fork(work)), (exit) => exit));
  }

  start(work: Effect.Effect<void>): () => void {
    const fiber = this.fork(work);
    return () => fiber.interruptUnsafe();
  }

  async settle<A, E>(work: Effect.Effect<A, E>): Promise<Exit.Exit<A, E>> {
    const outer = await Effect.runPromise(Fiber.await(this.fork(work)));
    return Exit.isSuccess(outer) ? outer.value : Exit.failCause(outer.cause);
  }

  async run<A>(work: Effect.Effect<A>): Promise<A | undefined> {
    const exit = await this.settle(work);
    if (Exit.isSuccess(exit)) return exit.value;
    if (!Cause.hasInterruptsOnly(exit.cause)) await Effect.runPromise(Effect.logError(exit.cause));
    return undefined;
  }

  close(): Promise<void> {
    return Effect.runPromise(Lifetime.close(this.life, Exit.void));
  }

  private fork<A, E>(work: Effect.Effect<A, E>): Fiber.Fiber<Exit.Exit<A, E>> {
    return Effect.runSync(FiberSet.run(this.fibers, Effect.exit(Effect.provideContext(work, this.services))));
  }
}
