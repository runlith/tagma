import { afterAll, afterEach, describe, expect } from 'bun:test';
import { Clock, Console, Context, Effect, Fiber, Layer } from 'effect';
import { TestClock, TestConsole } from 'effect/testing';
import { it, layer } from './testing';

describe('test scope', () => {
  let held = false;
  const holding = Effect.acquireRelease(
    Effect.sync(() => {
      held = true;
    }),
    () =>
      Effect.sync(() => {
        held = false;
      }),
  );
  afterEach(() => expect(held).toBe(false));
  const body = () =>
    Effect.andThen(
      holding,
      Effect.sync(() => {
        expect(held).toBe(true);
      }),
    );
  it.effect('releases a resource after its body', body);
  it.live('releases a live resource after its body', body);
});

it.effect('time advances only when the test clock is adjusted', () =>
  Effect.gen(function* () {
    const start = yield* Clock.currentTimeMillis;
    let awake = false;
    const sleeper = yield* Effect.forkChild(
      Effect.andThen(
        Effect.sleep('1 hour'),
        Effect.sync(() => {
          awake = true;
        }),
      ),
    );
    yield* Effect.yieldNow;
    expect(awake).toBe(false);
    expect(yield* Clock.currentTimeMillis).toBe(start);
    yield* TestClock.adjust('59 minutes');
    expect(awake).toBe(false);
    yield* TestClock.adjust('1 minute');
    yield* Fiber.join(sleeper);
    expect(awake).toBe(true);
    expect(yield* Clock.currentTimeMillis).toBe(start + 3_600_000);
  }),
);

it.effect('console output is captured by the test console', () =>
  Effect.gen(function* () {
    yield* Console.log('record', 42);
    yield* Console.error('failure');
    expect(yield* TestConsole.logLines).toEqual(['record', 42]);
    expect(yield* TestConsole.errorLines).toEqual(['failure']);
  }),
);

it.live('sleep completes on the real clock', () =>
  Effect.gen(function* () {
    const start = yield* Clock.currentTimeMillis;
    yield* Effect.sleep('2 millis');
    expect(yield* Clock.currentTimeMillis).toBeGreaterThan(start);
  }),
);

it.effect.each([
  [1, 2, 3],
  [2, 3, 5],
] as const)('%i + %i = %i', (a, b, sum) =>
  Effect.gen(function* () {
    expect(a + b).toBe(sum);
    expect(yield* Clock.currentTimeMillis).toBe(0);
    yield* TestClock.adjust('1 second');
    expect(yield* Clock.currentTimeMillis).toBe(1000);
  }),
);
it.live.each([{ value: 7 }])('a row is passed as data', ({ value }) =>
  Effect.sync(() => {
    expect(value).toBe(7);
  }),
);

class Resource extends Context.Service<Resource, { readonly id: number; readonly active: () => boolean }>()('Resource') {}
class Child extends Context.Service<Child, Resource['Service']>()('Child') {}

describe('shared layer', () => {
  let acquired = 0;
  let active = false;
  let testHeld = false;
  const releases: string[] = [];
  const source = Layer.effect(
    Resource,
    Effect.acquireRelease(
      Effect.sync(() => {
        active = true;
        return { id: ++acquired, active: () => active };
      }),
      () =>
        Effect.sync(() => {
          active = false;
          releases.push('parent');
        }),
    ),
  );

  layer(source)('resource group', (it) => {
    it.effect('acquires its resource once', () =>
      Effect.gen(function* () {
        yield* Effect.acquireRelease(
          Effect.sync(() => {
            testHeld = true;
          }),
          () =>
            Effect.sync(() => {
              testHeld = false;
            }),
        );
        expect(testHeld).toBe(true);
        const resource = yield* Resource;
        expect(resource.id).toBe(1);
        expect(resource.active()).toBe(true);
        yield* TestClock.adjust('1 second');
      }),
    );
    it.effect('keeps its resource between tests', () =>
      Effect.gen(function* () {
        expect(testHeld).toBe(false);
        expect((yield* Resource).id).toBe(1);
        expect(active).toBe(true);
        expect(acquired).toBe(1);
      }),
    );
    it.layer(
      Layer.effect(
        Child,
        Effect.acquireRelease(Resource, () =>
          Effect.sync(() => {
            releases.push('child');
          }),
        ),
      ),
    )('nested resource', (it) => {
      it.effect('builds with its parent service', () =>
        Effect.gen(function* () {
          expect(yield* Child).toBe(yield* Resource);
          expect((yield* Child).active()).toBe(true);
        }),
      );
    });
  });
  afterAll(() => {
    expect(active).toBe(false);
    expect(releases).toEqual(['child', 'parent']);
  });
});

describe('supplied memo map', () => {
  const memo = Layer.makeMemoMapUnsafe();
  let acquired = 0;
  let released = 0;
  const source = Layer.effect(
    Resource,
    Effect.acquireRelease(
      Effect.sync(() => ({ id: ++acquired, active: () => released === 0 })),
      () =>
        Effect.sync(() => {
          released++;
        }),
    ),
  );
  const existing = Layer.effectContext(Effect.flatMap(Effect.scope, (scope) => Layer.buildWithMemoMap(source, memo, scope)));
  layer(existing, { memoMap: memo })('external owner', (it) => {
    it.layer(source)('shared external resource', (it) => {
      it.effect('uses the callers existing resource and retains its external lifetime', () =>
        Effect.gen(function* () {
          expect((yield* Resource).id).toBe(1);
          expect((yield* Resource).active()).toBe(true);
        }),
      );
      afterAll(() => expect(released).toBe(0));
    });
  });
  afterAll(() => expect(released).toBe(1));
});

layer(Layer.empty, { excludeTestServices: true })('live layer', (it) => {
  it.effect('uses the real clock when test services are excluded', () =>
    Effect.gen(function* () {
      const start = yield* Clock.currentTimeMillis;
      yield* Effect.sleep('2 millis');
      expect(yield* Clock.currentTimeMillis).toBeGreaterThan(start);
    }),
  );
});
