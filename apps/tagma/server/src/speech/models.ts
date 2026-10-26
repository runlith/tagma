import { Deferred, Effect, Fiber, PubSub, Semaphore, Stream } from 'effect';
import { type Installing, LocalModels, ModelRefused, Models } from './contract/service/models.js';
import type { InstallEvent, InstallProgress } from './contract/wire/feeds.js';

const PROGRESS_CAPACITY = 64;

export const makeModels = Effect.gen(function* () {
  const local = yield* LocalModels;

  const home = yield* Effect.scope;
  const standing = new Map<string, InstallProgress>();
  const moved = yield* Effect.acquireRelease(PubSub.sliding<InstallEvent>(PROGRESS_CAPACITY), PubSub.shutdown);
  const running = new Map<string, Fiber.Fiber<void>>();
  const turns = yield* Semaphore.make(1);

  const told = (progress: InstallProgress): Effect.Effect<void> =>
    Effect.suspend(() => {
      if (progress.failure === null && progress.received >= progress.total && progress.total > 0) standing.delete(progress.model);
      else standing.set(progress.model, progress);
      return Effect.asVoid(PubSub.publish(moved, { kind: 'progress', ...progress }));
    });

  const list: Effect.Effect<ReadonlyArray<Installing>, ModelRefused> = Effect.map(local.list, (models) =>
    models.map((model) => ({
      ...model,
      received: standing.get(model.id)?.received ?? null,
      failure: standing.get(model.id)?.failure ?? null,
    })),
  );

  const pulled = (model: string, total: number): Effect.Effect<void> =>
    Stream.runForEach(local.install(model), (progress) =>
      told({ model, received: progress.received, total: progress.size, failure: null }),
    ).pipe(
      Effect.matchEffect({
        onFailure: (refused) => told({ model, received: standing.get(model)?.received ?? 0, total, failure: refused.message }),
        onSuccess: () => told({ model, received: total, total, failure: null }),
      }),
      Effect.ensuring(Effect.sync(() => running.delete(model))),
    );

  const progress: Stream.Stream<InstallEvent> = Stream.unwrap(
    Effect.map(PubSub.subscribe(moved), (subscription) =>
      Stream.concat(
        Stream.succeed<InstallEvent>({ kind: 'snapshot', installs: [...standing.values()] }),
        Stream.fromSubscription(subscription),
      ),
    ),
  );

  return Models.of({
    list,
    install: Effect.fn('Models.install')(function* (model) {
      const found = (yield* local.list).find((offered) => offered.id === model);
      if (found === undefined) return yield* new ModelRefused({ code: 'unknown-model', message: `no local model ${model} is offered` });
      if (found.installed) return 'installed' as const;
      if (running.has(model)) return 'installing' as const;
      yield* told({ model, received: found.partial, total: found.size, failure: null });
      const held = yield* Deferred.make<void>();
      running.set(model, yield* Effect.forkIn(Effect.andThen(Deferred.await(held), pulled(model, found.size)), home));
      yield* Deferred.succeed(held, undefined);
      return 'installing' as const;
    }, turns.withPermit),
    remove: Effect.fn('Models.remove')(function* (model) {
      const install = running.get(model);
      if (install !== undefined) {
        yield* Fiber.interrupt(install);
        const last = standing.get(model);
        if (last !== undefined) yield* told({ ...last, failure: 'the install was cancelled to remove the model' });
      }
      yield* local.remove(model);
      standing.delete(model);
      yield* PubSub.publish(moved, { kind: 'removed', model });
    }, turns.withPermit),
    progress,
  });
});
