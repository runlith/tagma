import { afterAll, beforeAll, describe, it as bunIt, onTestFinished } from 'bun:test';
import { Context, Duration, Effect, Layer, Scope } from 'effect';
import { makeFixture, runTest, testServices } from './runtime';

export interface Test<R> {
  <A, E>(name: string, body: () => Effect.Effect<A, E, R>, timeout?: number): void;
}

type TestArgs<T> = T extends readonly unknown[] ? [...T] : [T];

export interface Tester<R> extends Test<R> {
  readonly skip: Test<R>;
  readonly only: Test<R>;
  readonly failing: Test<R>;
  readonly each: <const T>(
    cases: readonly T[],
  ) => <A, E>(name: string, body: (...args: TestArgs<T>) => Effect.Effect<A, E, R>, timeout?: number) => void;
}

export interface GroupOptions {
  readonly timeout?: Duration.Input;
}

export interface LayerOptions extends GroupOptions {
  readonly testTimeout?: Duration.Input;
  readonly memoMap?: Layer.MemoMap;
  readonly excludeTestServices?: boolean;
}

export interface LayerGroup<R> {
  (name: string, body: (it: LayerMethods<R>) => void): void;
}

export type LayerMethods<R> = typeof bunIt & {
  readonly effect: Tester<R | Scope.Scope>;
  readonly layer: <R2, E>(layer: Layer.Layer<R2, E, R>, options?: GroupOptions) => LayerGroup<R | R2>;
};

export type Methods = LayerMethods<never> & {
  readonly live: Tester<Scope.Scope>;
};

function makeTester<R>(provide: <A, E>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E>, fallback?: number): Tester<R> {
  const run = <A, E>(body: () => Effect.Effect<A, E, R>): Promise<void> => runTest(provide(Effect.suspend(body)), onTestFinished);

  const register =
    (test: typeof bunIt): Test<R> =>
    (name, body, timeout) => {
      test.serial(name, () => run(body), timeout ?? fallback);
    };

  const each =
    <const T>(cases: readonly T[]) =>
    <A, E>(name: string, body: (...args: TestArgs<T>) => Effect.Effect<A, E, R>, timeout?: number) => {
      bunIt.serial.each([...cases])(name, (...args) => run(() => body(...(args as unknown as TestArgs<T>))), timeout ?? fallback);
    };

  return Object.assign(register(bunIt), {
    skip: register(bunIt.skip),
    only: register(bunIt.only),
    failing: register(bunIt.failing),
    each,
  });
}

function withMethods<T extends object>(methods: T): typeof bunIt & T {
  return new Proxy(bunIt as typeof bunIt & T, {
    get(target, key) {
      return Object.hasOwn(methods, key) ? Reflect.get(methods, key) : Reflect.get(target, key);
    },
  });
}

function makeLayer<R>(parent: Effect.Effect<Context.Context<R>>, parentMemo?: Layer.MemoMap) {
  return <R2, E>(source: Layer.Layer<R2, E, R>, options?: LayerOptions): LayerGroup<R | R2> =>
    (name, body) => {
      describe.serial(name, () => {
        const fixture = makeFixture(parent, source, parentMemo, options?.memoMap);
        const timeout = options?.timeout === undefined ? undefined : Duration.toMillis(Duration.fromInputUnsafe(options.timeout));
        const testTimeout =
          options?.testTimeout === undefined ? undefined : Duration.toMillis(Duration.fromInputUnsafe(options.testTimeout));
        beforeAll(fixture.acquire, timeout);
        const effect = makeTester<R | R2 | Scope.Scope>(
          (effect) => Effect.flatMap(fixture.services, (context) => Effect.provide(Effect.scoped(effect), context)),
          testTimeout,
        );
        afterAll(fixture.release, timeout);
        body(withMethods({ effect, layer: makeLayer(fixture.services, fixture.memo) }));
      });
    };
}

export const layer = <R, E>(source: Layer.Layer<R, E>, options?: LayerOptions): LayerGroup<R> => {
  return makeLayer(Effect.succeed(Context.empty()))(
    options?.excludeTestServices ? source : Layer.provideMerge(source, testServices),
    options,
  );
};

export const it: Methods = withMethods({
  effect: makeTester<Scope.Scope>((effect) => Effect.provide(Effect.scoped(effect), testServices)),
  live: makeTester<Scope.Scope>(Effect.scoped),
  layer,
});
