import { afterAll, setDefaultTimeout } from 'bun:test';
import { Context, Effect, Layer } from 'effect';
import { layer } from '../testing';

setDefaultTimeout(200);
class Resource extends Context.Service<Resource, boolean>()('Resource') {}
let buildRan = false;
let buildReleased = false;
let teardownRan = false;
let teardownReleased = false;
const waiting = Layer.effect(
  Resource,
  Effect.gen(function* () {
    yield* Effect.acquireRelease(Effect.void, () =>
      Effect.sync(() => {
        buildReleased = true;
      }),
    );
    yield* Effect.sleep('60 millis');
    return true;
  }),
);
layer(waiting, { timeout: '20 millis', excludeTestServices: true })('build deadline', (it) => {
  it.effect('does not run after the build deadline', () =>
    Effect.sync(() => {
      buildRan = true;
    }),
  );
});
const releasing = Layer.effect(
  Resource,
  Effect.acquireRelease(Effect.succeed(true), () =>
    Effect.andThen(
      Effect.sleep('60 millis'),
      Effect.sync(() => {
        teardownReleased = true;
      }),
    ),
  ),
);
layer(releasing, { timeout: '20 millis', excludeTestServices: true })('release deadline', (it) => {
  it.effect('runs before the release deadline', () =>
    Effect.sync(() => {
      teardownRan = true;
    }),
  );
});
afterAll(() => console.log(JSON.stringify({ buildRan, buildReleased, teardownRan, teardownReleased })));
