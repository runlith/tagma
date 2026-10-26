import { afterAll } from 'vitest';
import { Context, Data, Effect, Layer } from 'effect';
import { it, layer } from '../vitest';

class Refused extends Data.TaggedError('Refused') {}
class Resource extends Context.Service<Resource, object>()('vitest/FailingResource') {}
const released: string[] = [];
const hold = (name: string) =>
  Effect.acquireRelease(Effect.succeed({}), () =>
    Effect.sync(() => {
      released.push(name);
    }),
  );

it.effect('typed failure', () => Effect.andThen(hold('body'), new Refused()));
it.live('timeout', () => Effect.andThen(hold('timeout'), Effect.never), 10);
layer(Layer.effect(Resource, Effect.andThen(hold('build'), new Refused())))('failed acquisition', (it) => {
  it.effect('cannot read a failed layer', () => Resource);
});
layer(
  Layer.effect(
    Resource,
    Effect.acquireRelease(Effect.succeed({}), () => Effect.die('group release failed')),
  ),
)('failed release', (it) => {
  it.effect('has a built resource', () => Resource);
});
afterAll(() => {
  console.log(JSON.stringify({ released }));
});
