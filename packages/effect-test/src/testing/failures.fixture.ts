import { afterAll } from 'bun:test';
import { Context, Effect, Layer } from 'effect';
import { it, layer } from '../testing';

let released = 0;
let shared = false;
class Resource extends Context.Service<Resource, boolean>()('Resource') {}
const acquire = Effect.acquireRelease(Effect.void, () =>
  Effect.sync(() => {
    released++;
  }),
);

layer(
  Layer.effect(
    Resource,
    Effect.acquireRelease(
      Effect.sync(() => {
        shared = true;
        return true;
      }),
      () =>
        Effect.sync(() => {
          shared = false;
        }),
    ),
  ),
)('failed tests', (it) => {
  it.effect('typed failure', () => Effect.andThen(acquire, Effect.fail({ _tag: 'Refused', reason: 'closed' })));
  it.effect('defect', () => Effect.andThen(acquire, Effect.die(new Error('broken resource'))));
  it.effect('timeout', () => Effect.andThen(acquire, Effect.never), 30);
});
it.effect('throwing body', () => {
  throw new Error('body threw');
});
it.effect('release failure', () => Effect.acquireRelease(Effect.void, () => Effect.die(new Error('release failed'))));
let buildReleased = 0;
const build = (ending: Effect.Effect<never, string>) =>
  Layer.effect(
    Resource,
    Effect.andThen(
      Effect.acquireRelease(Effect.void, () =>
        Effect.sync(() => {
          buildReleased++;
        }),
      ),
      ending,
    ),
  );
layer(build(Effect.fail('build refused')))('failed build', (it) => {
  it.effect('cannot run without its layer', () => Resource);
});
layer(build(Effect.never), { timeout: '30 millis' })('timed out build', (it) => {
  it.effect('cannot run with an unfinished layer', () => Resource);
});
layer(
  Layer.effectDiscard(
    Effect.gen(function* () {
      yield* Effect.addFinalizer(() => Effect.die(new Error('first group release')));
      yield* Effect.addFinalizer(() => Effect.die(new Error('second group release')));
    }),
  ),
)('failed group releases', (it) => {
  it.effect('finishes before both group releases fail', () => Effect.void);
});
afterAll(() => {
  console.log(JSON.stringify({ released, shared, buildReleased }));
});
