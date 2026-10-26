import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Deferred, Effect, Fiber, Schema } from 'effect';
import { Tool } from '../agent/tool';
import { threadToolSources, type ThreadToolSource, type ThreadToolSourceRequest } from './ThreadPorts';
import { ASKS_NEVER } from '../permissions/vocabulary';
import { makeAggregateStorage } from './storage/InMemoryAggregateStorage';
const sourceOf = (id: string, said: string): ThreadToolSource => ({
  id,
  tools: {
    [`${id}_say`]: Tool.make({
      display: () => ({ form: 'none' }),
      approval: ASKS_NEVER,
      description: 'Says.',
      parameters: Schema.Struct({}),
      execute: () => Effect.succeed(said),
    }),
  },
});
const standing = (source: ThreadToolSource): boolean => Object.values(source.tools).every((tool) => tool.contributor?.standing() === true);
it.effect(
  'an offer stamped before replacement cannot regain standing through the replacement',
  Effect.fnUntraced(function* () {
    const registry = threadToolSources();
    const holding = yield* Deferred.make<void>();
    const entered = yield* Deferred.make<void>();
    const request: ThreadToolSourceRequest = { thread: makeAggregateStorage().row('thread-1'), context: null };
    const first = { id: 'notes', owner: 'a', names: ['notes_say'], offer: () => Effect.succeed(sourceOf('notes', 'first')) };
    const disposeFirst = yield* registry.register(first);
    yield* registry.register({
      id: 'slow',
      owner: 'b',
      names: ['slow_say'],
      offer: () => Effect.andThen(Deferred.succeed(entered, undefined), Effect.as(Deferred.await(holding), sourceOf('slow', 'slow'))),
    });
    const pass = yield* Effect.forkScoped(registry.offers(request));
    yield* Deferred.await(entered);
    disposeFirst();
    yield* registry.register(first);
    yield* Deferred.succeed(holding, undefined);
    const offered = yield* Fiber.join(pass);
    const stale = offered.find((source) => source.id === 'notes');
    if (!stale) return yield* Effect.die('Expected the original contribution');
    expect(standing(stale)).toBe(false);
    const again = yield* registry.offers(request);
    const current = again.find((source) => source.id === 'notes');
    if (!current) return yield* Effect.die('Expected the replacement contribution');
    expect(standing(current)).toBe(true);
  }),
);
