import type { Effect, Scope as Lifetime } from 'effect';
import { Service } from '@runlith/layer/key';
import { Scope } from '@runlith/layer/Scope';
import { Runner } from '../Runner.js';

export class ThreadEffects extends Service<ThreadEffects>()('ThreadEffects', { tier: 'thread' }) {
  static *make() {
    return new ThreadEffects(yield* Scope, new Runner());
  }

  constructor(
    scope: Scope,
    private readonly runner: Runner,
  ) {
    super();
    scope.defer(() => this.runner.close());
  }

  get life(): Lifetime.Closeable {
    return this.runner.life;
  }

  run<A>(work: Effect.Effect<A>): Promise<A | undefined> {
    return this.runner.run(work);
  }

  guard<A, E>(work: Effect.Effect<A, E>): Effect.Effect<A, E> {
    return this.runner.guard(work);
  }
}
