import { afterAll, afterEach, describe, expect } from 'vitest';
import { Clock, Console, Context, Data, Effect, Fiber, Layer } from 'effect';
import { TestClock, TestConsole } from 'effect/testing';
import { it, layer } from '../vitest';

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

it.effect('owns its resources and exposes controlled time and captured console output', () =>
  Effect.gen(function* () {
    yield* holding;
    expect(held).toBe(true);
    expect(yield* Clock.currentTimeMillis).toBe(0);
    const sleeper = yield* Effect.forkChild(Effect.sleep('1 hour'));
    yield* TestClock.adjust('1 hour');
    yield* Fiber.join(sleeper);
    expect(yield* Clock.currentTimeMillis).toBe(3_600_000);
    yield* Console.log('record', 42);
    expect(yield* TestConsole.logLines).toEqual(['record', 42]);
  }),
);

class Refused extends Data.TaggedError('Refused') {}
it.effect.failing('fails on typed refusal after releasing the body scope', () => Effect.andThen(holding, new Refused()));
it.effect.failing('fails on a defect after releasing the body scope', () => Effect.andThen(holding, Effect.die('broken')));
it.effect.failing('captures a throwing body factory', () => {
  throw new Error('body threw');
});
it.live('uses the live clock and closes its body scope', () =>
  Effect.gen(function* () {
    yield* holding;
    const start = yield* Clock.currentTimeMillis;
    yield* Effect.sleep(2);
    expect(yield* Clock.currentTimeMillis).toBeGreaterThan(start);
  }),
);
it.effect.each([
  [1, 2],
  [3, 4],
] as const)('starts each row at a fresh clock: %i, %i', (first, second) =>
  Effect.gen(function* () {
    expect(second).toBe(first + 1);
    expect(yield* Clock.currentTimeMillis).toBe(0);
    yield* TestClock.adjust(1);
  }),
);

class Resource extends Context.Service<Resource, { readonly id: number }>()('vitest/Resource') {}
class Child extends Context.Service<Child, Resource['Service']>()('vitest/Child') {}
describe('shared fixtures', () => {
  const released: string[] = [];
  let acquired = 0;
  const source = Layer.effect(
    Resource,
    Effect.acquireRelease(
      Effect.sync(() => ({ id: ++acquired })),
      () =>
        Effect.sync(() => {
          released.push('parent');
        }),
    ),
  );
  layer(source)('parent', (it) => {
    it.effect('holds the group resource', () =>
      Effect.gen(function* () {
        expect((yield* Resource).id).toBe(1);
        yield* TestClock.adjust(10);
      }),
    );
    it.effect('retains the shared services and clock between bodies', () =>
      Effect.gen(function* () {
        expect((yield* Resource).id).toBe(1);
        expect(yield* Clock.currentTimeMillis).toBe(10);
      }),
    );
    it.layer(
      Layer.effect(
        Child,
        Effect.acquireRelease(Resource, () =>
          Effect.sync(() => {
            released.push('child');
          }),
        ),
      ),
    )('child', (it) => {
      it.effect('reads its parent without rebuilding it', () =>
        Effect.gen(function* () {
          expect(yield* Child).toBe(yield* Resource);
          expect(acquired).toBe(1);
        }),
      );
    });
  });
  afterAll(() => expect(released).toEqual(['child', 'parent']));
});

layer(Layer.empty, { excludeTestServices: true })('live fixture', (it) => {
  it.effect('keeps real time when test services are excluded', () =>
    Effect.gen(function* () {
      const start = yield* Clock.currentTimeMillis;
      yield* Effect.sleep(2);
      expect(yield* Clock.currentTimeMillis).toBeGreaterThan(start);
    }),
  );
});

it.effect('starts with an isolated DOM for its file', () =>
  Effect.sync(() => {
    expect(document.body.children.length).toBe(0);
    document.body.append(document.createElement('article'));
  }),
);
